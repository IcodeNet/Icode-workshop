// Rich diff view: any two sides (problem, solution, playground or a saved
// playground of any lesson), side-by-side or unified, with word highlights,
// deep links, keyboard shortcuts and per-file sync into a playground.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TokenLine, lineTokens, useTokens } from "./highlighted.jsx";

const request = async (path, options) => {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Request failed"), { data });
  return data;
};
const VARIANTS = ["playground", "problem", "solution"];
const q = encodeURIComponent;

/** Split "01.saved.<id>" / "01.problem" into {step, version}. */
export function splitSide(spec) {
  const [step, variant, savedId] = String(spec || "").split(".");
  return { step, version: variant === "saved" ? "saved." + savedId : variant };
}
const joinSide = (step, version) => step + "." + version;

/** Resolve a lesson-link or URL value to [a, b] (validated again by the server). */
export function resolveDiffLink(value, { selected, ids }) {
  const index = ids.indexOf(selected);
  if (value === "step") return [selected + ".problem", selected + ".solution"];
  if (value === "next" && ids[index + 1]) return [selected + ".solution", ids[index + 1] + ".problem"];
  if (value === "prev" && index > 0) return [ids[index - 1] + ".solution", selected + ".problem"];
  const [left, right] = String(value).split("..");
  if (right === undefined) {
    if (/^\d{2}$/.test(left)) return [left + ".problem", left + ".solution"];
    if (/^\d{2}\.[a-z]+/.test(left)) return [left, left.slice(0, 2) + ".solution"];
    return null;
  }
  if (/^\d{2}$/.test(left) && /^\d{2}$/.test(right)) return [left + ".solution", right + ".problem"];
  return [left, right];
}

/** Character-level change between two paired lines (common prefix/suffix). */
export function wordChange(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { start, endA: a.length - end, endB: b.length - end };
}
function Highlighted({ text, range, tokens }) {
  if (tokens && text) return <TokenLine tokens={tokens} range={range} />;
  if (!range || range.start >= range.end) return text || " ";
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="word-change">{text.slice(range.start, range.end)}</mark>
      {text.slice(range.end)}
    </>
  );
}
/** Pair runs of deletions and additions into side-by-side rows. */
export function splitRows(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].t === " ") {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels = [],
      adds = [];
    while (i < lines.length && lines[i].t === "-") dels.push(lines[i++]);
    while (i < lines.length && lines[i].t === "+") adds.push(lines[i++]);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
      const left = dels[j] ?? null,
        right = adds[j] ?? null;
      let ranges = null;
      if (left && right) {
        const w = wordChange(left.text, right.text);
        ranges = { left: { start: w.start, end: w.endA }, right: { start: w.start, end: w.endB } };
      }
      rows.push({ left, right, ranges });
    }
  }
  return rows;
}

function Hunks({ file, view, sideA, sideB }) {
  // Both sides are highlighted from their files; a line whose tokens do not
  // spell its diff text (for example with whitespace ignored) stays plain.
  const left = useTokens(file.status === "added" ? "" : sideA, file.from ?? file.path, undefined, file).lines;
  const right = useTokens(file.status === "deleted" ? "" : sideB, file.path, undefined, file).lines;
  const tokensOf = (line) =>
    line.t === "-" ? lineTokens(left, line.a, line.text) : lineTokens(right, line.b, line.text) ?? lineTokens(left, line.a, line.text);
  return file.hunks.map((hunk, index) => (
    <tbody key={index} className="diff-hunk" data-hunk="true">
      <tr className="diff-hunk-head">
        <td colSpan={view === "split" ? 4 : 3}>
          @@ -{hunk.aStart},{hunk.aLines} +{hunk.bStart},{hunk.bLines} @@
        </td>
      </tr>
      {view === "split"
        ? splitRows(hunk.lines).map((row, i) => (
            <tr key={i} className="diff-row">
              <td className="diff-num">{row.left?.a ?? ""}</td>
              <td className={"diff-code " + (!row.left ? "empty" : row.left.t === "-" ? "del" : "ctx")}>
                {row.left && <Highlighted text={row.left.text} range={row.ranges?.left} tokens={lineTokens(left, row.left.a, row.left.text)} />}
              </td>
              <td className="diff-num">{row.right?.b ?? ""}</td>
              <td className={"diff-code " + (!row.right ? "empty" : row.right.t === "+" ? "add" : "ctx")}>
                {row.right && <Highlighted text={row.right.text} range={row.ranges?.right} tokens={lineTokens(right, row.right.b, row.right.text)} />}
              </td>
            </tr>
          ))
        : hunk.lines.map((line, i) => (
            <tr key={i} className="diff-row">
              <td className="diff-num">{line.a ?? ""}</td>
              <td className="diff-num">{line.b ?? ""}</td>
              <td className={"diff-code " + (line.t === "-" ? "del" : line.t === "+" ? "add" : "ctx")}>
                <span className="diff-sign" aria-hidden="true">{line.t === " " ? " " : line.t}</span>
                <Highlighted text={line.text} tokens={tokensOf(line)} />
              </td>
            </tr>
          ))}
    </tbody>
  ));
}

function SideSelect({ label, step, version, catalog, saved, onChange, disabled }) {
  return (
    <span className="diff-side">
      <label>
        {label} lesson{" "}
        <select aria-label={"Diff " + label.toLowerCase() + " lesson"} value={step} disabled={disabled} onChange={(e) => onChange(e.target.value, version.startsWith("saved.") ? "playground" : version)}>
          {catalog.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {item.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        version{" "}
        <select aria-label={"Diff " + label.toLowerCase() + " version"} value={version} disabled={disabled} onChange={(e) => onChange(step, e.target.value)}>
          {VARIANTS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
          {saved.map((s) => (
            <option key={s.savedId} value={"saved." + s.savedId}>
              saved · {new Date(s.createdAt).toLocaleString()} {s.label ? "· " + s.label : ""}
            </option>
          ))}
        </select>
      </label>
    </span>
  );
}

const SHORTCUTS = [
  ["j / k", "next / previous file"],
  ["n / p", "next / previous change"],
  ["u", "unified or side-by-side"],
  ["w", "ignore whitespace"],
  ["o", "expand or collapse all files"],
  ["c", "copy a link to this diff"],
  ["?", "show or hide shortcuts"],
];

export function DiffView({ catalog, selected, initial, dirty, busy, onOpenFile, onSynced, onMessage }) {
  const [a, setA] = useState(() => splitSide(initial?.a ?? selected + ".playground"));
  const [b, setB] = useState(() => splitSide(initial?.b ?? selected + ".solution"));
  const [view, setView] = useState(initial?.view === "unified" ? "unified" : "split");
  const [whitespace, setWhitespace] = useState(initial?.ws === true);
  const [context, setContext] = useState("3");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(new Set());
  const [loaded, setLoaded] = useState({});
  const [saved, setSaved] = useState({});
  const [help, setHelp] = useState(false);
  const [focus, setFocus] = useState(initial?.file ?? null);
  const root = useRef(null);
  const sideA = joinSide(a.step, a.version),
    sideB = joinSide(b.step, b.version);
  const params = "a=" + q(sideA) + "&b=" + q(sideB) + (whitespace ? "&ws=ignore" : "") + "&context=" + context;
  const link = useMemo(() => {
    const search = "?diff=" + sideA + ".." + sideB + (focus ? "&file=" + q(focus) : "") + (view === "unified" ? "&view=unified" : "") + (whitespace ? "&ws=ignore" : "");
    return search;
  }, [sideA, sideB, focus, view, whitespace]);

  useEffect(() => {
    if (!initial) return;
    setA(splitSide(initial.a));
    setB(splitSide(initial.b));
    if (initial.view) setView(initial.view === "unified" ? "unified" : "split");
    if (initial.ws !== undefined) setWhitespace(initial.ws === true);
    setFocus(initial.file ?? null);
  }, [initial?.key]);
  // Saved playgrounds of the chosen lessons appear as versions.
  useEffect(() => {
    for (const step of new Set([a.step, b.step]))
      if (step && !saved[step])
        request("/saved-playgrounds?id=" + q(step))
          .then((d) => setSaved((s) => ({ ...s, [step]: d.saved })))
          .catch(() => setSaved((s) => ({ ...s, [step]: [] })));
  }, [a.step, b.step]);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await request("/diff?" + params);
      setData(result);
      setLoaded({});
      const paths = result.files.map((f) => f.path);
      setOpen(new Set(focus && paths.includes(focus) ? [focus] : paths.length <= 30 ? paths : paths.slice(0, 10)));
    } catch (e) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (a.step && b.step) load();
  }, [params]);
  useEffect(() => {
    if (data) window.history.replaceState(null, "", window.location.pathname + link);
  }, [link, data]);
  useEffect(() => {
    if (!focus || !data) return;
    const el = root.current?.querySelector('[data-path="' + CSS.escape(focus) + '"]');
    el?.scrollIntoView?.({ block: "start" });
  }, [focus, data]);

  async function loadFile(path) {
    try {
      const result = await request("/diff/file?" + params + "&path=" + q(path));
      setLoaded((l) => ({ ...l, [path]: result.file }));
      setOpen((o) => new Set(o).add(path));
    } catch (e) {
      setError(e.message);
    }
  }
  const files = data?.files ?? [];
  const playgroundSide = a.version === "playground" ? a : b.version === "playground" ? b : null;
  const sourceSide = playgroundSide === a ? sideB : sideA;
  async function sync(file) {
    if (!playgroundSide) return;
    const name = playgroundSide === a ? file.path : file.from ?? file.path;
    const absent = playgroundSide === a ? file.status === "deleted" : file.status === "added";
    const message = absent
      ? "Delete " + name + " from the " + playgroundSide.step + " playground (it does not exist in " + sourceSide + ")? The playground is saved first."
      : "Replace " + name + " in the " + playgroundSide.step + " playground with the " + sourceSide + " version? The playground is saved first.";
    if (!window.confirm(message)) return;
    try {
      await request("/file/sync", {
        method: "POST",
        body: JSON.stringify({ id: playgroundSide.step, name, from: sourceSide, remove: absent }),
      });
      onMessage?.((absent ? "Removed " : "Synced ") + name + " in the " + playgroundSide.step + " playground.");
      onSynced?.(playgroundSide.step, name);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  function move(delta) {
    if (!files.length) return;
    const index = Math.max(0, files.findIndex((f) => f.path === focus));
    const next = files[(index + delta + files.length) % files.length];
    setFocus(next.path);
    setOpen((o) => new Set(o).add(next.path));
  }
  function moveChange(delta) {
    const hunks = [...(root.current?.querySelectorAll("[data-hunk]") ?? [])];
    if (!hunks.length) return;
    let index = hunks.findIndex((h) => h.classList.contains("diff-hunk-current"));
    index = index < 0 ? (delta > 0 ? 0 : hunks.length - 1) : (index + delta + hunks.length) % hunks.length;
    for (const h of hunks) {
      h.classList.remove("diff-hunk-current");
      h.removeAttribute("aria-current");
    }
    hunks[index].classList.add("diff-hunk-current");
    hunks[index].setAttribute("aria-current", "true");
    hunks[index].scrollIntoView?.({ block: "center" });
  }
  async function copyLink() {
    const url = window.location.origin + window.location.pathname + link;
    try {
      await navigator.clipboard.writeText(url);
      onMessage?.("Copied diff link: " + url);
    } catch {
      onMessage?.("Diff link: " + url);
    }
  }
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || event.target?.isContentEditable) return;
      if (document.querySelector(".dialog-backdrop")) return;
      const actions = {
        j: () => move(1),
        k: () => move(-1),
        n: () => moveChange(1),
        p: () => moveChange(-1),
        u: () => setView((v) => (v === "split" ? "unified" : "split")),
        w: () => setWhitespace((w) => !w),
        o: () => setOpen((o) => (o.size ? new Set() : new Set(files.map((f) => f.path)))),
        c: () => copyLink(),
        "?": () => setHelp((h) => !h),
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const statusLabel = (f) => (f.status === "renamed" ? "renamed from " + f.from : f.status);
  return (
    <div className="diff-view" ref={root}>
      <div className="file-tools diff-controls">
        <SideSelect label="From" step={a.step} version={a.version} catalog={catalog} saved={saved[a.step] ?? []} disabled={loading} onChange={(step, version) => setA({ step, version })} />
        <button aria-label="Swap diff sides" disabled={loading} onClick={() => { setA(b); setB(a); }}>⇄</button>
        <SideSelect label="To" step={b.step} version={b.version} catalog={catalog} saved={saved[b.step] ?? []} disabled={loading} onChange={(step, version) => setB({ step, version })} />
      </div>
      <div className="file-tools diff-controls">
        <div role="group" aria-label="Diff layout">
          <button aria-pressed={view === "split"} onClick={() => setView("split")}>Side by side</button>
          <button aria-pressed={view === "unified"} onClick={() => setView("unified")}>Unified</button>
        </div>
        <label>
          <input type="checkbox" checked={whitespace} onChange={(e) => setWhitespace(e.target.checked)} /> Ignore whitespace changes
        </label>
        <label>
          Context{" "}
          <select aria-label="Context lines" value={context} onChange={(e) => setContext(e.target.value)}>
            <option value="3">3 lines</option>
            <option value="10">10 lines</option>
            <option value="all">Whole file</option>
          </select>
        </label>
        <button onClick={load} disabled={loading}>Refresh diff</button>
        <button onClick={copyLink}>Copy link</button>
        <button aria-expanded={help} onClick={() => setHelp((h) => !h)}>Shortcuts</button>
      </div>
      {help && (
        <dl className="diff-shortcuts" aria-label="Diff keyboard shortcuts">
          {SHORTCUTS.map(([key, text]) => (
            <React.Fragment key={key}>
              <dt><kbd>{key}</kbd></dt>
              <dd>{text}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {dirty && <p className="diff-note">The diff uses saved files. Save your changes first.</p>}
      {error && <p role="alert" className="diff-error">{error}</p>}
      {loading && <p>Loading diff…</p>}
      {data && (
        <p className="diff-summary" aria-label="Diff summary">
          {data.stats.files} changed file{data.stats.files === 1 ? "" : "s"} · <span className="add-count">+{data.stats.additions}</span> <span className="del-count">−{data.stats.deletions}</span>
          {data.stats.hiddenWhitespaceOnly ? " · " + data.stats.hiddenWhitespaceOnly + " whitespace-only file(s) hidden" : ""}
        </p>
      )}
      {data && !files.length && <p>No differences between {data.a} and {data.b}.</p>}
      {files.map((original) => {
        const file = loaded[original.path] ?? original;
        const isOpen = open.has(file.path);
        return (
          <section key={file.path} className={"diff-file" + (focus === file.path ? " focused" : "")} data-path={file.path} aria-label={"Diff of " + file.path}>
            <header className="diff-file-head">
              <button
                className="diff-toggle"
                aria-expanded={isOpen}
                onClick={() => {
                  setFocus(file.path);
                  setOpen((o) => {
                    const n = new Set(o);
                    n.has(file.path) ? n.delete(file.path) : n.add(file.path);
                    return n;
                  });
                }}
              >
                {isOpen ? "▾" : "▸"} <code>{file.path}</code>
              </button>
              <span className={"diff-status " + file.status}>{statusLabel(file)}</span>
              <span className="add-count">+{file.additions}</span> <span className="del-count">−{file.deletions}</span>
              {playgroundSide && (
                <button disabled={busy} onClick={() => sync(file)} aria-label={"Use " + sourceSide + " version of " + file.path + " in playground"}>
                  Use {sourceSide} version
                </button>
              )}
              {playgroundSide && playgroundSide.step === selected && !(playgroundSide === a ? file.status === "added" : file.status === "deleted") && (
                <button disabled={busy} onClick={() => onOpenFile?.(file.path, file.hunks?.[0]?.[playgroundSide === a ? "aStart" : "bStart"] || 1)}>
                  Open in playground
                </button>
              )}
            </header>
            {isOpen && (
              <div className="diff-body">
                {file.note && <p className="diff-note">{file.note}</p>}
                {file.approximate && <p className="diff-note">Too many changes for a line-by-line match; shown as a replacement.</p>}
                {file.truncated && <p className="diff-note">Diff truncated to keep the page responsive.</p>}
                {file.deferred && (
                  <p className="diff-note">
                    Large diff not loaded yet. <button onClick={() => loadFile(file.path)}>Load diff</button>
                  </p>
                )}
                {file.hunks?.length > 0 && (
                  <table className={"diff-table " + view}>
                    <colgroup>
                      {(view === "split" ? ["num", "code", "num", "code"] : ["num", "num", "code"]).map((kind, i) => (
                        <col key={i} className={"diff-col-" + kind} />
                      ))}
                    </colgroup>
                    <Hunks file={file} view={view} sideA={sideA} sideB={sideB} />
                  </table>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
