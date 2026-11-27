// Long-lived course processes (for example a local database or mock API)
// declared in course.json `sidecars` and started with the workshop.
import { courseOperations, startScript } from "./operations.mjs";
import { registerProcess } from "./processes.mjs";

export const SIDECAR_LOG_LINES = 500;
const sidecars = new Map();

function appendLog(state, type, text) {
  const pieces = (state.partial[type] + text).split("\n");
  state.partial[type] = pieces.pop();
  for (const line of pieces) state.logs.push(`[${state.name}] ${line}`);
  if (state.logs.length > SIDECAR_LOG_LINES)
    state.logs.splice(0, state.logs.length - SIDECAR_LOG_LINES);
}

function launch(root, state) {
  state.partial = { stdout: "", stderr: "" };
  state.status = "running";
  state.startedAt = new Date().toISOString();
  let session;
  try {
    session = startScript(root, state.script, {
      env: { ICODE_SIDECAR: state.name },
      emit: (event) => appendLog(state, event.type, event.text),
    });
  } catch (error) {
    state.status = "failed";
    state.session = null;
    state.logs.push(`[${state.name}] failed to start: ${error.message}`);
    return;
  }
  state.session = session;
  registerProcess({
    kind: "sidecar",
    label: "Sidecar: " + state.name,
    command: ["npm", "run", state.script],
    session,
    stop: () => stopSidecar(state.name),
  });
  session.completion.then(
    (result) => {
      if (state.session !== session) return;
      for (const type of ["stdout", "stderr"])
        if (state.partial[type]) appendLog(state, type, "\n");
      state.exitCode = result.exitCode;
      state.status = state.stopping ? "stopped" : "exited";
      state.logs.push(
        `[${state.name}] process ${state.stopping ? "stopped" : "exited with code " + result.exitCode}`,
      );
      state.stopping = false;
      state.session = null;
    },
    (error) => {
      if (state.session !== session) return;
      state.status = "failed";
      state.logs.push(`[${state.name}] failed to start: ${error.message}`);
      state.session = null;
    },
  );
}

/** Start every configured sidecar not already running. */
export async function startSidecars(root) {
  const { sidecars: configured } = await courseOperations(root);
  for (const { name, script } of configured) {
    const existing = sidecars.get(name);
    if (existing?.session) continue;
    const state = existing || { name, script, logs: [], exitCode: null };
    state.script = script;
    sidecars.set(name, state);
    launch(root, state);
  }
  return listSidecars();
}
export function listSidecars() {
  return [...sidecars.values()].map((s) => ({
    name: s.name,
    script: s.script,
    status: s.status,
    pid: s.session?.pid ?? null,
    startedAt: s.startedAt,
    exitCode: s.exitCode,
  }));
}
export function sidecarLogs(name) {
  const state = sidecars.get(name);
  if (!state) throw new Error("Unknown sidecar");
  return { name, logs: [...state.logs] };
}
export async function stopSidecar(name) {
  const state = sidecars.get(name);
  if (!state) throw new Error("Unknown sidecar");
  if (state.session) {
    state.stopping = true;
    await state.session.stop();
  }
  return { stopped: true };
}
export async function restartSidecar(root, name) {
  const { sidecars: configured } = await courseOperations(root);
  const config = configured.find((s) => s.name === name);
  if (!config) throw new Error("Unknown sidecar");
  await stopSidecar(name).catch(() => {});
  const state = sidecars.get(name) || { name, logs: [], exitCode: null };
  state.script = config.script;
  sidecars.set(name, state);
  state.logs.push(`[${name}] restarting`);
  launch(root, state);
  return { restarted: true };
}
export async function stopAllSidecars() {
  await Promise.allSettled([...sidecars.keys()].map(stopSidecar));
}
/** Synchronous last-resort cleanup for process exit. */
export function killAllSidecarsNow() {
  for (const state of sidecars.values()) state.session?.killNow?.();
}
