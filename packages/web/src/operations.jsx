// Run-and-operate UI: course actions with typed confirmation, indicator and
// setup banners, the Processes view (including sidecars) and ANSI output.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ansiToHtml } from "./ansi.js";
import { useFocusTrap } from "./palette.jsx";

async function request(path, options) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? "Request failed"), { data });
  return data;
}
const post = (path, body) =>
  request(path, { method: "POST", body: JSON.stringify(body) });

/** Process output with ANSI colours. ansiToHtml escapes all text first. */
export function AnsiOutput({ text, ...props }) {
  return (
    <pre
      {...props}
      dangerouslySetInnerHTML={{ __html: ansiToHtml(text || "") }}
    />
  );
}

/**
 * Modal confirmation. With `expected`, the confirm button stays disabled until
 * the typed text matches exactly.
 */
export function ConfirmDialog({
  title,
  message,
  expected,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  confirmDisabled = false,
  children,
}) {
  const [typed, setTyped] = useState("");
  const input = useRef(null);
  const confirmButton = useRef(null);
  const dialog = useRef(null);
  // Focus stays in the dialog and returns to the opener afterwards.
  useFocusTrap(dialog, true, expected !== undefined ? input : confirmButton);
  const matches = expected === undefined || typed === expected;
  return (
    <div className="dialog-backdrop">
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        {message && <p className="dialog-message">{message}</p>}
        {children}
        {expected !== undefined && (
          <label>
            Type <code>{expected}</code> to confirm
            <input
              ref={input}
              aria-label="Confirmation text"
              value={typed}
              autoComplete="off"
              spellCheck="false"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches) onConfirm(typed);
              }}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            ref={confirmButton}
            className="primary danger"
            disabled={!matches || confirmDisabled}
            onClick={() => onConfirm(typed)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Course action state lives in the App so a run survives panel switches. */
/** Keep the end of long output, cutting at a line start so escape sequences stay whole. */
export function tail(text, limit = 50000) {
  if (text.length <= limit) return text;
  const cut = text.slice(-limit);
  const newline = cut.indexOf("\n");
  return (
    "[earlier output truncated]\n" +
    (newline >= 0 ? cut.slice(newline + 1) : cut)
  );
}

/**
 * Course action state lives in the App. Runs are detached on the server: the
 * stream can drop (reload, closed tab) and the UI re-attaches; only an
 * explicit Cancel stops a run.
 */
export function useActions({ onFinished, onChange } = {}) {
  const [actions, setActions] = useState([]);
  const [error, setError] = useState("");
  const [run, setRun] = useState(null); // snapshot fields + action
  const [output, setOutput] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const attached = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onFinished, onChange };
  const active = run && ["running", "cancelling"].includes(run.status);

  const attach = useCallback(async (runId) => {
    if (attached.current === runId) return;
    attached.current = runId;
    try {
      const response = await fetch(
        "/api/actions/stream?runId=" + encodeURIComponent(runId),
      );
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
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "snapshot") {
            setRun(event);
            setOutput(tail(event.output || ""));
            setConfirm(event.confirm || null);
            callbacks.current.onChange?.();
          } else if (event.type === "confirm") setConfirm(event);
          else if (event.type === "answered") setConfirm(null);
          else if (event.type === "status")
            setRun(
              (previous) => previous && { ...previous, status: event.status },
            );
          else if (event.type === "result") {
            setConfirm(null);
            setRun(
              (previous) =>
                previous && {
                  ...previous,
                  status: event.status,
                  exitCode: event.exitCode,
                },
            );
            callbacks.current.onFinished?.();
          } else if (event.text)
            setOutput((previous) => tail(previous + event.text));
        }
      }
    } catch (e) {
      setOutput((previous) => previous + "\n" + e.message);
    } finally {
      if (attached.current === runId) attached.current = null;
    }
  }, []);

  const reload = useCallback(() => {
    request("/operations")
      .then((data) => {
        setActions(data.actions);
        setError("");
        const runId = data.running?.runId || data.lastRunId;
        if (runId) attach(runId);
      })
      .catch((e) => setError(e.message));
  }, [attach]);
  useEffect(reload, [reload]);

  async function start(action) {
    if (active) return;
    setOutput("");
    setConfirm(null);
    try {
      const snapshot = await post("/actions/run", { id: action.id });
      setRun(snapshot);
      callbacks.current.onChange?.();
      attach(snapshot.runId);
    } catch (e) {
      setRun({ label: action.label, status: "error" });
      setOutput(e.message);
    }
  }
  async function answer(text) {
    setConfirm(null);
    try {
      await post("/actions/input", { runId: run?.runId, text });
    } catch (e) {
      setOutput((previous) => previous + "\n" + e.message + "\n");
    }
  }
  async function cancel() {
    setCancelPrompt(false);
    try {
      // The server reports "cancelling" and the final status on the stream.
      await post("/actions/cancel", { runId: run?.runId });
    } catch (e) {
      setOutput((previous) => previous + "\n" + e.message + "\n");
    }
  }
  return {
    actions,
    error,
    run,
    output,
    confirm,
    running: Boolean(active),
    cancelPrompt,
    requestCancel: () => setCancelPrompt(true),
    dismissCancel: () => setCancelPrompt(false),
    start,
    answer,
    cancel,
    reload,
  };
}

export function ActionsPanel({ state }) {
  const groups = new Map();
  for (const action of state.actions) {
    const group = action.group || "Course actions";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(action);
  }
  return (
    <div className="tools-panel actions-panel">
      {state.error && <p role="alert">{state.error}</p>}
      {!state.actions.length && !state.error && (
        <p>
          This course defines no actions. Authors can declare them in
          course.json.
        </p>
      )}
      {[...groups].map(([group, actions]) => (
        <section key={group} aria-label={group}>
          <h3>{group}</h3>
          {actions.map((action) => (
            <div key={action.id} className="action-row">
              <button
                className={action.destructive ? "danger" : undefined}
                disabled={state.running}
                onClick={() => state.start(action)}
              >
                {action.label}
              </button>
              {action.destructive && (
                <span className="badge danger">Destructive</span>
              )}
              {action.description && <span>{action.description}</span>}
            </div>
          ))}
        </section>
      ))}
      {state.run && (
        <section aria-label="Action run">
          <p className="execution-summary">
            <strong>{state.run.label}</strong> · {state.run.status}
            {state.run.exitCode !== undefined && state.run.exitCode !== null
              ? " · exit " + state.run.exitCode
              : ""}
            {state.running && state.run.status !== "cancelling" && (
              <button onClick={state.requestCancel}>Cancel action</button>
            )}
          </p>
          {state.running && (
            <p className="action-note">
              This action keeps running if you reload or close this tab; come
              back to follow it. Only Cancel stops it.
            </p>
          )}
          <AnsiOutput
            className="notice"
            role="log"
            aria-label="Action output"
            text={state.output || "Starting…"}
          />
        </section>
      )}
      {state.cancelPrompt && (
        <ConfirmDialog
          title={"Cancel “" + (state.run?.label || "action") + "”?"}
          message={
            "Cancelling interrupts the script (Ctrl+C; on Windows the script is usually force-stopped instead), then force-stops it after " +
            (state.run?.cancelGraceSeconds ?? 30) +
            " seconds. Cancelling a deployment part-way can leave cloud resources running and billing; check your cloud account or run the course's tear-down action afterwards."
          }
          confirmLabel="Cancel action"
          onConfirm={state.cancel}
          onCancel={state.dismissCancel}
        />
      )}
    </div>
  );
}

export function useIndicators() {
  const [indicators, setIndicators] = useState([]);
  const refresh = useCallback(() => {
    request("/indicators")
      .then((data) => setIndicators(data.indicators))
      .catch((e) =>
        // Fail closed: an unknown cost status is shown, never hidden.
        setIndicators([
          {
            path: "error:client",
            level: "danger",
            message:
              "Cost status unknown: course indicators could not be checked (" +
              e.message +
              "). Resources may still be running.",
          },
        ]),
      );
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  return [indicators, refresh];
}
export function IndicatorBanner({ indicators }) {
  if (!indicators.length) return null;
  return (
    <div className="indicator-banners" role="region" aria-label="Course status">
      {indicators.map((item) => (
        <p key={item.path} className={"indicator " + item.level}>
          <strong>
            {item.path.startsWith("error:")
              ? "Indicator check failed"
              : item.level === "danger"
                ? "Cost alert"
                : item.level === "warning"
                  ? "Warning"
                  : "Note"}
          </strong>{" "}
          {item.message}
        </p>
      ))}
    </div>
  );
}
export function SetupBanner() {
  const [checks, setChecks] = useState([]);
  const load = useCallback(() => {
    request("/doctor")
      .then((report) =>
        setChecks(
          report.checks.filter((c) => c.name.startsWith("Course dependencies") && !c.ok),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  if (!checks.length) return null;
  return (
    <div className="indicator-banners" role="region" aria-label="Setup check">
      {checks.map((check) => (
        <p key={check.name} className="indicator warning">
          <strong>{check.name}</strong> {check.message}{" "}
          {check.fix && (
            <>
              Run <code>{check.fix}</code>{" "}
            </>
          )}
          <button onClick={load}>Check again</button>
        </p>
      ))}
    </div>
  );
}

export function ProcessesPanel() {
  const [processes, setProcesses] = useState([]);
  const [sidecars, setSidecars] = useState([]);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        request("/processes"),
        request("/sidecars"),
      ]);
      setProcesses(p.processes);
      setSidecars(s.sidecars);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  const showLogs = useCallback(async (name) => {
    try {
      setLogs(await request("/sidecars/logs?name=" + encodeURIComponent(name)));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!logs) return;
    const timer = setInterval(() => showLogs(logs.name), 2000);
    return () => clearInterval(timer);
  }, [logs?.name, showLogs]);
  async function act(path, body) {
    try {
      await post(path, body);
    } catch (e) {
      setError(e.message);
    }
    await refresh();
  }
  return (
    <div className="tools-panel processes-panel">
      {error && <p role="alert">{error}</p>}
      <h3>Running processes</h3>
      {processes.length === 0 ? (
        <p>No workshop processes are running.</p>
      ) : (
        <table aria-label="Running processes">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Process</th>
              <th>Command</th>
              <th>PID</th>
              <th>Port</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {processes.map((item) => (
              <tr key={item.id}>
                <td>{item.kind}</td>
                <td>{item.label}</td>
                <td>
                  <code>{item.command.join(" ")}</code>
                </td>
                <td>{item.pid ?? "—"}</td>
                <td>{item.port ?? "—"}</td>
                <td>{new Date(item.startedAt).toLocaleTimeString()}</td>
                <td>
                  <button
                    aria-label={"Stop " + item.label}
                    onClick={() => act("/processes/stop", { id: item.id })}
                  >
                    Stop
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Sidecars</h3>
      {sidecars.length === 0 ? (
        <p>This course defines no sidecar processes.</p>
      ) : (
        sidecars.map((sidecar) => (
          <div key={sidecar.name} className="action-row">
            <strong>{sidecar.name}</strong>
            <span>
              {sidecar.status}
              {sidecar.pid ? " · pid " + sidecar.pid : ""}
            </span>
            <button
              aria-label={"Restart " + sidecar.name}
              onClick={() => act("/sidecars/restart", { name: sidecar.name })}
            >
              Restart
            </button>
            <button
              aria-label={"Stop " + sidecar.name}
              disabled={sidecar.status !== "running"}
              onClick={() => act("/sidecars/stop", { name: sidecar.name })}
            >
              Stop
            </button>
            <button
              aria-label={"Logs " + sidecar.name}
              onClick={() => showLogs(sidecar.name)}
            >
              Logs
            </button>
          </div>
        ))
      )}
      {logs && (
        <section aria-label={"Logs for " + logs.name}>
          <p>
            Last {logs.logs.length} lines of {logs.name}{" "}
            <button onClick={() => setLogs(null)}>Hide logs</button>
          </p>
          <AnsiOutput
            className="notice"
            role="log"
            aria-label="Sidecar logs"
            text={logs.logs.join("\n")}
          />
        </section>
      )}
    </div>
  );
}

/** Identify and, after confirmation, stop a foreign process on a preview port. */
export function FreePort({ port, onFreed }) {
  const [holder, setHolder] = useState(null);
  const [error, setError] = useState("");
  async function inspect() {
    setError("");
    try {
      const data = await request("/ports/holder?port=" + port);
      if (!data.holders.length)
        setError(
          "No listening process could be identified on port " + port + ".",
        );
      else setHolder(data.holders[0]);
    } catch (e) {
      setError(e.message);
    }
  }
  async function free(typed) {
    const target = holder;
    setHolder(null);
    try {
      await post("/ports/free", {
        port,
        pid: target.pid,
        confirm: true,
        ...(target.wildcard ? { confirmName: typed } : {}),
      });
      onFreed?.(
        "Stopped process " +
          target.pid +
          "; port " +
          port +
          " is being released.",
      );
    } catch (e) {
      setError(e.message);
    }
  }
  const blocked = holder?.refusal || "";
  return (
    <div className="port-conflict" role="region" aria-label="Port conflict">
      <p>Port {port} is used by another process.</p>
      <button onClick={inspect}>Free port {port}…</button>
      {error && <p role="alert">{error}</p>}
      {holder && (
        <ConfirmDialog
          title={"Stop the process on port " + port + "?"}
          message={
            blocked ||
            "This terminates a process that the workshop did not start (not its child processes). Unsaved work in it will be lost." +
              (holder.wildcard
                ? " It listens on all network interfaces, so type its name to confirm."
                : "")
          }
          expected={!blocked && holder.wildcard ? holder.name : undefined}
          confirmLabel={"Stop process " + holder.pid}
          confirmDisabled={Boolean(blocked)}
          onCancel={() => setHolder(null)}
          onConfirm={free}
        >
          <dl className="holder">
            <dt>PID</dt>
            <dd>{holder.pid}</dd>
            <dt>Command</dt>
            <dd>
              <code>{holder.command || "unknown"}</code>
            </dd>
            <dt>Listening on</dt>
            <dd>{holder.addresses.join(", ")}</dd>
          </dl>
        </ConfirmDialog>
      )}
    </div>
  );
}
