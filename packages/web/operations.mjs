// Course-declared operations: actions (npm scripts the learner may run from the
// UI), indicators (banners shown while a file exists) and sidecars (long-lived
// npm scripts started with the workshop). Only scripts that already exist in
// the course root package.json can ever be run; learners cannot supply
// commands.
import { readFile, lstat } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { startProcess } from "../adapter-api/node.mjs";
import { courseEnvironment, npmCLI } from "./setup.mjs";
import { assertSafePath } from "./files.mjs";
import { registerProcess } from "./processes.mjs";

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
// Must start with a letter or digit so a script name can never become an npm flag.
const SCRIPT = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,79}$/;
const LEVELS = ["info", "warning", "danger"];
// Protocol line: ::icode-confirm:<ICODE_CONFIRM_TOKEN>::{"expected":…,"message":…}
export const CONFIRM_TAG = "::icode-confirm";
/** Control, format and line/paragraph separator characters are refused in prompts. */
const UNSAFE_TEXT = /[\p{C}\p{Zl}\p{Zp}]/u;
export const DEFAULT_CANCEL_GRACE_SECONDS = 30;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw new Error("Could not read " + path + ": " + e.message);
  }
}
const text = (value, max, field) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid " + field);
  return value;
};
const optionalText = (value, max, field) =>
  value === undefined ? undefined : text(value, max, field);

export function validateIndicatorPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 240 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-zA-Z]:/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid indicator path: " + path);
  return path;
}

/** Validate operations against the course package scripts. Pure; exported for tests. */
/** Indicators are validated on their own so a broken action never hides a cost banner. */
export function validateIndicators(list) {
  const indicators = [];
  if (list === undefined) return indicators;
  if (!Array.isArray(list)) throw new Error("indicators must be a list");
  for (const indicator of list) {
    if (!indicator || typeof indicator !== "object")
      throw new Error("Invalid indicator");
    const level = indicator.level ?? "warning";
    if (!LEVELS.includes(level)) throw new Error("Invalid indicator level");
    indicators.push({
      path: validateIndicatorPath(indicator.path),
      message: text(indicator.message, 500, "indicator message"),
      level,
    });
  }
  return indicators;
}
export function validateOperations(course = {}, scripts = {}) {
  const requireScript = (script, where) => {
    if (typeof script !== "string" || !SCRIPT.test(script))
      throw new Error("Invalid script name in " + where);
    if (!Object.hasOwn(scripts, script))
      throw new Error(
        where + " uses script '" + script + "' which is not in package.json",
      );
    return script;
  };
  const actions = [];
  if (course.actions !== undefined) {
    if (!Array.isArray(course.actions))
      throw new Error("actions must be a list");
    const seen = new Set();
    for (const action of course.actions) {
      if (
        !action ||
        typeof action !== "object" ||
        !ID.test(action.id ?? "") ||
        seen.has(action.id)
      )
        throw new Error("Invalid or duplicate action id");
      seen.add(action.id);
      if (
        action.destructive !== undefined &&
        typeof action.destructive !== "boolean"
      )
        throw new Error("Invalid destructive flag for action " + action.id);
      const grace = action.cancelGraceSeconds ?? DEFAULT_CANCEL_GRACE_SECONDS;
      if (!Number.isInteger(grace) || grace < 1 || grace > 3600)
        throw new Error("Invalid cancelGraceSeconds for action " + action.id);
      actions.push({
        id: action.id,
        label: text(action.label, 80, "action label"),
        script: requireScript(action.script, "action " + action.id),
        group: optionalText(action.group, 60, "action group"),
        description: optionalText(
          action.description,
          500,
          "action description",
        ),
        destructive: Boolean(action.destructive),
        cancelGraceSeconds: grace,
      });
    }
  }
  const indicators = validateIndicators(course.indicators);
  const sidecars = [];
  if (course.sidecars !== undefined) {
    if (
      !course.sidecars ||
      typeof course.sidecars !== "object" ||
      Array.isArray(course.sidecars)
    )
      throw new Error("sidecars must be an object");
    for (const [name, sidecar] of Object.entries(course.sidecars)) {
      if (!ID.test(name)) throw new Error("Invalid sidecar name: " + name);
      if (!sidecar || typeof sidecar !== "object")
        throw new Error("Invalid sidecar " + name);
      sidecars.push({
        name,
        script: requireScript(sidecar.script, "sidecar " + name),
      });
    }
  }
  return { actions, indicators, sidecars };
}

async function readManifest(root) {
  return (await readJson(join(resolve(root), "course.json"))) ?? {};
}
export async function courseOperations(root) {
  const course = await readManifest(root);
  const pkg = (await readJson(join(resolve(root), "package.json"))) ?? {};
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return validateOperations(course, scripts);
}

/**
 * Active banners. Fails closed: if the manifest or an indicator cannot be
 * checked, a "cost status unknown" banner is returned instead of nothing. A
 * running action is also reported, since it may be changing what is deployed.
 */
export async function indicatorStatus(root) {
  const active = [];
  const errors = [];
  let indicators = [];
  try {
    indicators = validateIndicators((await readManifest(root)).indicators);
  } catch (e) {
    errors.push(e.message);
  }
  for (const indicator of indicators) {
    try {
      const path = await assertSafePath(join(resolve(root), indicator.path));
      await lstat(path);
      active.push(indicator);
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR")
        errors.push(indicator.path + ": " + e.message);
    }
  }
  for (const error of errors)
    active.push({
      path: "error:" + error,
      level: "danger",
      message:
        "Cost status unknown: course indicators could not be checked (" +
        error +
        "). Resources may still be running.",
    });
  if (current)
    active.push({
      path: "action:" + current.runId,
      level: "warning",
      message:
        "Course action “" +
        current.action.label +
        "” is " +
        current.status +
        "; what is deployed may be changing.",
    });
  return { indicators: active, ...(errors.length ? { errors } : {}) };
}

/** Run a course script through npm in the course root. */
export function startScript(
  root,
  script,
  { env, stdin, emit, onSpawn, outputLimit = Infinity } = {},
) {
  return startProcess(process.execPath, [npmCLI(), "run", script], {
    workspaceRoot: resolve(root),
    env: { ...courseEnvironment(root), ...env },
    stdin,
    outputLimit,
    emit,
    onSpawn,
  });
}

const MAX_PROTOCOL_LINE = 64 * 1024;
// eslint-disable-next-line no-control-regex
const LEADING_SGR = /^(?:\x1b\[[0-9;]*m)+/;
// An escape sequence still arriving (ESC, ESC[, ESC[3…).
// eslint-disable-next-line no-control-regex
const PARTIAL_SGR = /^\x1b(?:\[[0-9;]*)?$/;
/**
 * Split raw process output into lines so protocol lines are never shown.
 * Runs on the full stream, before any output cap. Partial lines are emitted at
 * once unless they might still become a protocol line. Only lines carrying
 * this run's token open a confirmation.
 */
export function protocolFilter(token, onText, onConfirm) {
  const pending = { stdout: "", stderr: "" };
  // True when part of the current line was already shown; the rest of that
  // line is then plain output, never a protocol line.
  const midLine = { stdout: false, stderr: false };
  const prefix = CONFIRM_TAG + ":" + token + "::";
  const handleLine = (type, line, newline) => {
    // Colour/reset codes that tools print before a line do not hide a prompt.
    const trimmed = line.replace(/\r$/, "").replace(LEADING_SGR, "");
    const continuation = midLine[type];
    midLine[type] = false;
    if (!continuation && trimmed.startsWith(CONFIRM_TAG)) {
      if (!token || !trimmed.startsWith(prefix)) {
        onText(
          type,
          "[ignored confirmation request without this run's token]\n",
        );
        return;
      }
      try {
        const data = JSON.parse(trimmed.slice(prefix.length));
        if (
          typeof data.expected === "string" &&
          data.expected.length > 0 &&
          data.expected.length <= 200 &&
          !UNSAFE_TEXT.test(data.expected) &&
          (data.message === undefined ||
            (typeof data.message === "string" &&
              data.message.length <= 1000 &&
              !UNSAFE_TEXT.test(data.message)))
        ) {
          onConfirm({ expected: data.expected, message: data.message || "" });
          return;
        }
      } catch {}
      onText(type, "[invalid confirmation request ignored]\n");
      return;
    }
    onText(type, line + newline);
  };
  return {
    push(type, chunk) {
      let buffer = pending[type] + chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        handleLine(type, buffer.slice(0, index), "\n");
        buffer = buffer.slice(index + 1);
      }
      const bare = buffer.replace(LEADING_SGR, "");
      const couldBeProtocol =
        !midLine[type] &&
        buffer.length <= MAX_PROTOCOL_LINE &&
        (PARTIAL_SGR.test(bare) ||
          CONFIRM_TAG.startsWith(bare) ||
          bare.startsWith(CONFIRM_TAG));
      if (buffer && !couldBeProtocol) {
        onText(type, buffer);
        buffer = "";
        midLine[type] = true;
      }
      pending[type] = buffer;
    },
    flush() {
      for (const type of ["stdout", "stderr"])
        if (pending[type]) {
          handleLine(type, pending[type], "");
          pending[type] = "";
        }
    },
  };
}

/** Characters of action output retained server-side for re-attaching clients. */
export let ACTION_OUTPUT_TAIL = 200_000;
export function setActionOutputTail(value) {
  ACTION_OUTPUT_TAIL = value;
}
const TRUNCATED = "[earlier output truncated]\n";

let current = null;
let lastRun = null;
const snapshot = (run) => ({
  runId: run.runId,
  actionId: run.action.id,
  label: run.action.label,
  destructive: run.action.destructive,
  cancelGraceSeconds: run.action.cancelGraceSeconds,
  status: run.status,
  exitCode: run.exitCode,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  truncated: run.truncated,
  output: (run.truncated ? TRUNCATED : "") + run.output,
  confirm: run.confirm,
});
function notify(run, event) {
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {}
  }
}
function append(run, type, text) {
  run.output += text;
  if (run.output.length > ACTION_OUTPUT_TAIL) {
    let tail = run.output.slice(-ACTION_OUTPUT_TAIL);
    const newline = tail.indexOf("\n");
    if (newline >= 0 && newline < tail.length - 1)
      tail = tail.slice(newline + 1);
    run.output = tail;
    run.truncated = true;
  }
  notify(run, { type, text });
}

export function currentAction() {
  return current
    ? {
        runId: current.runId,
        actionId: current.action.id,
        label: current.action.label,
        status: current.status,
        processId: current.processId,
        awaitingConfirmation: Boolean(current.confirm),
      }
    : null;
}
export function actionRun(runId) {
  const run = [current, lastRun].find(
    (r) => r && (!runId || r.runId === runId),
  );
  return run ? snapshot(run) : null;
}
export function lastActionRunId() {
  return lastRun?.runId ?? null;
}
/**
 * Follow a run: `listener` receives output, confirm, status and result events.
 * Returns the current snapshot and an unsubscribe function. Unsubscribing
 * (for example a closed browser tab) never affects the run.
 */
export function subscribeAction(runId, listener) {
  const run = [current, lastRun].find((r) => r && r.runId === runId);
  if (!run) throw new Error("Unknown action run");
  const state = snapshot(run);
  if (run.status === "running" || run.status === "cancelling")
    run.listeners.add(listener);
  return { snapshot: state, unsubscribe: () => run.listeners.delete(listener) };
}

/**
 * Start an action detached from any HTTP request. Resolves with the run's
 * snapshot once spawned; the run continues until it exits or is explicitly
 * cancelled.
 */
export async function startAction(root, actionId) {
  if (current) throw new Error("Another course action is already running");
  const { actions } = await courseOperations(root);
  const action = actions.find((item) => item.id === actionId);
  if (!action) throw new Error("Unknown course action");
  if (current) throw new Error("Another course action is already running");
  const run = {
    runId: randomUUID(),
    token: randomUUID().replaceAll("-", ""),
    action,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: "",
    truncated: false,
    confirm: null,
    cancelled: false,
    listeners: new Set(),
  };
  current = run;
  const filter = protocolFilter(
    run.token,
    (type, text) => append(run, type, text),
    (confirm) => {
      run.confirm = confirm;
      notify(run, { type: "confirm", ...confirm });
    },
  );
  let session;
  try {
    session = startScript(root, action.script, {
      env: {
        ICODE_ACTION: "1",
        ICODE_ACTION_ID: action.id,
        ICODE_CONFIRM_TOKEN: run.token,
      },
      stdin: true,
      emit: (event) => filter.push(event.type, event.text),
    });
  } catch (e) {
    current = null;
    throw e;
  }
  run.session = session;
  run.processId = registerProcess({
    kind: "action",
    label: "Action: " + action.label,
    command: ["npm", "run", action.script],
    session,
    // Stopping from the Processes view is an explicit, graceful cancel.
    stop: () => {
      cancelAction(run.runId).catch(() => {});
    },
  }).id;
  run.done = session.completion
    .then(
      (result) => {
        filter.flush();
        run.exitCode = result.exitCode;
        run.status = run.cancelled
          ? "cancelled"
          : result.exitCode === 0
            ? "passed"
            : "failed";
      },
      (error) => {
        append(run, "stderr", "\n" + error.message + "\n");
        run.status = "error";
      },
    )
    .then(() => {
      run.confirm = null;
      run.finishedAt = new Date().toISOString();
      if (current === run) current = null;
      lastRun = run;
      notify(run, {
        type: "result",
        runId: run.runId,
        actionId: action.id,
        status: run.status,
        exitCode: run.exitCode,
      });
      run.listeners.clear();
      return {
        runId: run.runId,
        actionId: action.id,
        status: run.status,
        exitCode: run.exitCode,
      };
    });
  return snapshot(run);
}
/** Convenience for tests and the CLI: start, follow and await the result. */
export async function runAction(root, actionId, { emit } = {}) {
  const started = await startAction(root, actionId);
  const run = current?.runId === started.runId ? current : lastRun;
  if (emit) {
    emit({ type: "started", runId: run.runId });
    run.listeners.add(emit);
    if (run.output) emit({ type: "stdout", text: run.output });
    if (run.confirm) emit({ type: "confirm", ...run.confirm });
  }
  return run.done;
}
/**
 * Send the learner's typed confirmation. Only accepted while a prompt is
 * pending, and only the empty string (cancel) or the exact expected text.
 */
export function sendActionInput(runId, input) {
  if (!current || current.runId !== runId)
    throw new Error("No matching action is running");
  if (!current.confirm)
    throw new Error("The action is not waiting for confirmation");
  if (
    typeof input !== "string" ||
    (input !== "" && input !== current.confirm.expected)
  )
    throw new Error("Confirmation text does not match");
  if (!current.session.write(input + "\n"))
    throw new Error("The action no longer accepts input");
  current.confirm = null;
  notify(current, { type: "answered" });
  return { sent: true };
}
/**
 * Explicit cancel: SIGINT to the process group (on Windows only a close
 * request that console scripts usually ignore — effectively a delayed force-stop),
 * then SIGKILL after the action's cancelGraceSeconds. Resolves when stopped.
 */
export async function cancelAction(runId, { graceMs } = {}) {
  if (!current || current.runId !== runId)
    throw new Error("No matching action is running");
  const run = current;
  run.cancelled = true;
  run.confirm = null;
  run.status = "cancelling";
  notify(run, { type: "status", status: "cancelling" });
  await run.session.stop({
    signal: "SIGINT",
    graceMs: graceMs ?? run.action.cancelGraceSeconds * 1000,
  });
  await run.done;
  return { cancelled: true };
}
/** Engine shutdown: stop a running action quickly. */
export async function stopActionsForShutdown() {
  const run = current;
  if (!run) return;
  run.cancelled = true;
  await run.session.stop({ signal: "SIGTERM", graceMs: 400 });
}
