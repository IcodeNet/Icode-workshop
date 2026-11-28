// Learner workspace UI: touched files, saved playgrounds, workshop
// update and hook output.
import React, { useEffect, useState } from "react";
import { AnsiOutput, ConfirmDialog, tail } from "./operations.jsx";

const request = async (path, options) => {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Request failed"), { data });
  return data;
};
const q = encodeURIComponent;

/** Console text for hook results and automatic saves of a playground operation. */
export function operationSummary(data) {
  const parts = [];
  for (const h of data?.hooks ?? [])
    parts.push("Hook " + h.hook + " (" + h.label + "): " + h.status + " in " + (h.durationMs / 1000).toFixed(1) + "s" + (h.output ? "\n" + h.output.trimEnd() : ""));
  if (data?.saved?.savedId) parts.push("Previous playground saved (Saved tab).");
  if (data?.savedSkipped) parts.push("Not saved automatically: " + data.savedSkipped);
  if (typeof data?.previewRestarted === "string") parts.push("Preview restarted.");
  else if (data?.previewRestarted?.error) parts.push("Preview could not restart: " + data.previewRestarted.error);
  return parts.join("\n");
}

const PLAYGROUND_STATE = {
  unchanged: "not started",
  edited: "edited",
  done: "matches solution",
  missing: "missing",
  "no-playground": "",
};

export function TouchedFiles({ selected, refreshKey, busy, canLaunch, onOpen, onLaunch, onReset, onDiff }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setError("");
    request("/touched?id=" + q(selected))
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected, refreshKey]);
  if (error) return <p className="touched-error">Files for this step unavailable: {error}</p>;
  if (!data) return null;
  const done = data.files.filter((f) => f.playground === "done").length;
  return (
    <details className="touched-files" open>
      <summary>
        Files for this step ({data.files.length}){data.playgroundExists && data.files.length ? " · " + done + " match the solution" : ""}
      </summary>
      {!data.files.length && <p>This step does not change any files.</p>}
      <ul aria-label="Files for this step">
        {data.files.map((file) => (
          <li key={file.path} data-state={file.playground}>
            <button
              className="touched-open"
              disabled={busy || file.status === "deleted" || file.playground === "missing"}
              title={"Open at line " + file.line}
              onClick={() => onOpen(file.path, file.line)}
            >
              {file.path}
            </button>
            <span className={"diff-status " + file.status}>{file.status === "renamed" ? "renamed from " + file.from : file.status}</span>
            {PLAYGROUND_STATE[file.playground] && <span className={"touched-state " + file.playground}>{PLAYGROUND_STATE[file.playground]}</span>}
            <span className="touched-actions">
              <button disabled={busy} aria-label={"Diff " + file.path} onClick={() => onDiff(file.path)}>
                Diff
              </button>
              {canLaunch && file.playground !== "missing" && file.status !== "deleted" && (
                <button disabled={busy} aria-label={"Open " + file.path + " in editor"} onClick={() => onLaunch(file.path, file.line)}>
                  Editor
                </button>
              )}
              {file.playground === "edited" && file.status !== "added" && (
                <button disabled={busy} aria-label={"Reset " + file.path + " to problem"} onClick={() => onReset(file.from ?? file.path)}>
                  Reset
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {data.extra.length > 0 && (
        <p className="touched-extra">
          You also changed: {data.extra.map((f) => f.path + " (" + f.status + ")").join(", ")}
        </p>
      )}
    </details>
  );
}

const size = (bytes) => (bytes < 1024 ? bytes + " B" : bytes < 1048576 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1048576).toFixed(1) + " MB");
export function SavedPanel({ selected, refreshKey, busy, setBusy, onRestored, onDiff }) {
  const [saved, setSaved] = useState([]);
  const [preferences, setPreferences] = useState({ savePlaygrounds: true });
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const refresh = () =>
    request("/saved-playgrounds?id=" + q(selected))
      .then((d) => {
        setSaved(d.saved);
        setPreferences(d.preferences);
      })
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    refresh();
  }, [selected, refreshKey]);
  async function act(work, done) {
    setBusy(true);
    setMessage("");
    try {
      const result = await work();
      setMessage(done(result));
      await refresh();
      return result;
    } catch (e) {
      setMessage(e.message + (e.data?.hooks ? "\n" + operationSummary(e.data) : ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tools-panel saved-panel">
      <p>
        Saved playgrounds are exact copies of this lesson’s playground (dependencies excluded). They are kept automatically before a reset, replace, migrate, restore or single-file sync, and you can save one yourself.
      </p>
      <label>
        <input
          type="checkbox"
          checked={preferences.savePlaygrounds}
          disabled={busy}
          onChange={(e) => {
            const savePlaygrounds = e.target.checked;
            setPreferences({ savePlaygrounds });
            act(
              () => request("/preferences", { method: "PUT", body: JSON.stringify({ savePlaygrounds }) }),
              (p) => (p.savePlaygrounds ? "Automatic saves on." : "Automatic saves off."),
            );
          }}
        />{" "}
        Save automatically before replacing the playground
      </label>
      <div className="file-tools">
        <input aria-label="Saved playground label" placeholder="Label (optional)" maxLength={80} value={label} disabled={busy} onChange={(e) => setLabel(e.target.value)} />
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            act(
              () => request("/saved-playgrounds", { method: "POST", body: JSON.stringify({ id: selected, label }) }),
              (s) => {
                setLabel("");
                return "Saved playground " + (s.label || s.savedId) + "." + (s.pruned?.length ? " Oldest removed: " + s.pruned.length : "");
              },
            )
          }
        >
          Save playground
        </button>
      </div>
      {message && <AnsiOutput className="notice" role="status" aria-label="Saved playground status" text={message} />}
      {!saved.length ? (
        <p>No saved playgrounds for this lesson yet.</p>
      ) : (
        <table className="saved-table" aria-label="Saved playgrounds">
          <thead>
            <tr>
              <th>Saved</th>
              <th>Label</th>
              <th>Why</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {saved.map((s) => (
              <tr key={s.savedId}>
                <td>
                  {s.pinned ? "📌 " : ""}
                  {new Date(s.createdAt).toLocaleString()}
                </td>
                <td>{s.label}</td>
                <td>{s.reason}</td>
                <td>
                  {s.files} files · {size(s.bytes)}
                </td>
                <td className="saved-actions">
                  <button
                    disabled={busy}
                    aria-label={"Restore saved playground " + (s.label || s.savedId)}
                    onClick={() => {
                      if (!window.confirm("Restore this saved playground? The current playground is saved first, so you can undo this.")) return;
                      act(
                        () => request("/saved-playgrounds/restore", { method: "POST", body: JSON.stringify({ id: selected, savedId: s.savedId }) }),
                        (r) => {
                          onRestored(r);
                          return "Restored. " + operationSummary(r);
                        },
                      );
                    }}
                  >
                    Restore
                  </button>
                  <button disabled={busy} aria-label={"Diff saved playground " + (s.label || s.savedId)} onClick={() => onDiff(selected + ".saved." + s.savedId)}>
                    Diff
                  </button>
                  <button
                    disabled={busy}
                    aria-label={(s.pinned ? "Unpin " : "Pin ") + (s.label || s.savedId)}
                    onClick={() =>
                      act(
                        () => request("/saved-playgrounds", { method: "PATCH", body: JSON.stringify({ id: selected, savedId: s.savedId, pinned: !s.pinned }) }),
                        () => (s.pinned ? "Unpinned." : "Pinned: kept when older saves are removed."),
                      )
                    }
                  >
                    {s.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    disabled={busy}
                    aria-label={"Delete saved playground " + (s.label || s.savedId)}
                    onClick={() => {
                      if (!window.confirm("Delete this saved playground permanently?")) return;
                      act(
                        () => request("/saved-playgrounds", { method: "DELETE", body: JSON.stringify({ id: selected, savedId: s.savedId }) }),
                        () => "Deleted.",
                      );
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Banner when the last fetch (the server checks once at startup) found updates. */
export function UpdateBanner({ onOpen }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const load = () => request("/update").then(setStatus).catch(() => {});
    const first = setTimeout(load, 1500);
    const timer = setInterval(load, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (!status?.behind) return null;
  return (
    <div className="indicator-banners" role="region" aria-label="Workshop update">
      <p className="indicator info">
        <strong>Workshop update available.</strong> {status.message}{" "}
        <button onClick={onOpen}>Review update</button>
      </p>
    </div>
  );
}

export function UpdatePanel({ busy, setBusy, onUpdated }) {
  const [status, setStatus] = useState(null);
  const [output, setOutput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [stash, setStash] = useState(false);
  const [backupOverwritten, setBackupOverwritten] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    request("/update").then(setStatus).catch((e) => setError(e.message));
  }, []);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus(await request("/update/check", { method: "POST", body: "{}" }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setConfirming(false);
    setBusy(true);
    setOutput("");
    setResult(null);
    setError("");
    try {
      const response = await fetch("/api/update/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "update", stash, backupOverwritten }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === "result") setResult(event);
          else if (event.text) setOutput((o) => tail(o + event.text));
        }
      }
      setStatus(await request("/update"));
      onUpdated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!status) return <div className="tools-panel">{error || "Checking the course repository…"}</div>;
  return (
    <div className="tools-panel update-panel">
      <h3>Workshop updates</h3>
      <p aria-label="Update status">{status.message}</p>
      {status.git && (
        <>
          <p>
            Branch <code>{status.branch}</code> at <code>{status.head}</code>
            {status.upstream ? <> · upstream <code>{status.upstream}</code></> : null}
            {status.lastFetch ? " · last checked " + new Date(status.lastFetch).toLocaleString() : ""}
          </p>
          {status.offline && <p role="alert">Offline: nothing was changed.</p>}
          {status.dirtyCount > 0 && (
            <p className="diff-note">
              Uncommitted changes in the course ({status.dirtyCount}): {status.dirty.slice(0, 8).join(", ")}
              {status.dirtyCount > 8 ? ", …" : ""}. Your playgrounds in .workshop are not affected.
            </p>
          )}
          {status.commits?.length > 0 && (
            <ul aria-label="Incoming commits">
              {status.commits.map((c) => (
                <li key={c.hash}>
                  <code>{c.hash}</code> {c.subject}
                </li>
              ))}
            </ul>
          )}
          {status.protectedPaths?.length > 0 && (
            <p role="alert">
              This update would change the workshop's own state in .workshop/ ({status.protectedPaths.slice(0, 5).join(", ")}). It is refused to protect your playgrounds; ask the course author to stop tracking .workshop/.
            </p>
          )}
          {status.overwrites?.length > 0 && (
            <p className="diff-note" aria-label="Files the update would overwrite">
              The update would overwrite {status.overwrites.length} local file(s) that git does not track: {status.overwrites.slice(0, 8).join(", ")}
              {status.overwrites.length > 8 ? ", …" : ""}. You can back them up during the update.
            </p>
          )}
          {status.changedSteps?.length > 0 && <p>Lessons changed by this update: {status.changedSteps.join(", ")}. Your playgrounds keep your work; use Migrate or the Diff tab to pick up changes.</p>}
          <div className="file-tools">
            <button disabled={busy || !status.upstream} onClick={check}>
              Check for updates
            </button>
            <button className="primary" disabled={busy || !status.behind || status.protectedPaths?.length > 0} onClick={() => setConfirming(true)}>
              Update workshop
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status" aria-label="Update result">
          {result.ok ? result.message : "Update failed: " + result.error}
          {result.ok && result.stash && !result.stash.restored ? " " + result.stash.message : ""}
          {result.ok && result.backedUp ? " Backed up " + result.backedUp.paths.length + " file(s) to " + result.backedUp.dir + "." : ""}
          {result.ok && result.hooks?.length ? " Post-update hook: " + result.hooks[0].status + "." : ""}
          {result.ok && result.install?.status && result.install.status !== "skipped" ? " Dependencies: " + result.install.status + "." : ""}
        </p>
      )}
      {output && <AnsiOutput className="notice" role="log" aria-label="Update output" text={output} />}
      {confirming && (
        <ConfirmDialog
          title="Update the workshop"
          message={"Fast-forward the course to " + status.upstream + " (" + status.behind + " commit(s)), reinstall dependencies if they changed, then run the post-update hook. Local commits are never rewritten."}
          expected="update"
          confirmLabel="Update"
          onConfirm={apply}
          onCancel={() => setConfirming(false)}
        >
          {status.overwrites?.length > 0 && (
            <label>
              <input type="checkbox" checked={backupOverwritten} onChange={(e) => setBackupOverwritten(e.target.checked)} /> Back up the {status.overwrites.length} local file(s) the update would overwrite (to .workshop/update-backups)
            </label>
          )}
          {status.dirtyCount > 0 && (
            <label>
              <input type="checkbox" checked={stash} onChange={(e) => setStash(e.target.checked)} /> Stash my {status.dirtyCount} uncommitted change(s) during the update and re-apply them afterwards
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
