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
const SCRIPT = /^[a-zA-Z0-9:._-]{1,80}$/;
const LEVELS = ["info", "warning", "danger"];
export const CONFIRM_PREFIX = "::icode-confirm::";

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
      });
    }
  }
  const indicators = [];
  if (course.indicators !== undefined) {
    if (!Array.isArray(course.indicators))
      throw new Error("indicators must be a list");
    for (const indicator of course.indicators) {
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
  }
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

export async function courseOperations(root) {
  const course = (await readJson(join(resolve(root), "course.json"))) ?? {};
  const pkg = (await readJson(join(resolve(root), "package.json"))) ?? {};
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  return validateOperations(course, scripts);
}

export async function indicatorStatus(root) {
  const { indicators } = await courseOperations(root);
  const active = [];
  for (const indicator of indicators) {
    const path = await assertSafePath(join(resolve(root), indicator.path));
    try {
      await lstat(path);
      active.push(indicator);
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
    }
  }
  return { indicators: active };
}

/** Run a course script through npm in the course root. */
export function startScript(root, script, { env, stdin, emit, onSpawn } = {}) {
  return startProcess(process.execPath, [npmCLI(), "run", script], {
    workspaceRoot: resolve(root),
    env: { ...courseEnvironment(root), ...env },
    stdin,
    outputLimit: 2_000_000,
    emit,
    onSpawn,
  });
}

/**
 * Split process output into lines so protocol lines are never shown. Partial
 * lines are emitted at once unless they might still become a protocol line.
 */
export function protocolFilter(onText, onConfirm) {
  const pending = { stdout: "", stderr: "" };
  // True when part of the current line was already shown; the rest of that
  // line is then plain output, never a protocol line.
  const midLine = { stdout: false, stderr: false };
  const handleLine = (type, line, newline) => {
    const trimmed = line.replace(/\r$/, "");
    const continuation = midLine[type];
    midLine[type] = false;
    if (!continuation && trimmed.startsWith(CONFIRM_PREFIX)) {
      try {
        const data = JSON.parse(trimmed.slice(CONFIRM_PREFIX.length));
        if (
          typeof data.expected === "string" &&
          data.expected.length > 0 &&
          data.expected.length <= 200 &&
          !/[\r\n]/.test(data.expected) &&
          (data.message === undefined || typeof data.message === "string")
        ) {
          onConfirm({
            expected: data.expected,
            message: (data.message || "").slice(0, 1000),
          });
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
      if (
        buffer &&
        (midLine[type] ||
          (!CONFIRM_PREFIX.startsWith(buffer) &&
            !buffer.startsWith(CONFIRM_PREFIX)))
      ) {
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

let current = null;
export function currentAction() {
  return current
    ? {
        runId: current.runId,
        actionId: current.actionId,
        awaitingConfirmation: Boolean(current.confirm),
      }
    : null;
}
/** Run one action at a time. Events: started, stdout/stderr, confirm, result. */
export async function runAction(root, actionId, { emit, signal } = {}) {
  if (current) throw new Error("Another course action is already running");
  const { actions } = await courseOperations(root);
  const action = actions.find((item) => item.id === actionId);
  if (!action) throw new Error("Unknown course action");
  const run = {
    runId: randomUUID(),
    actionId,
    confirm: null,
    cancelled: false,
  };
  current = run;
  try {
    const filter = protocolFilter(
      (type, text) => emit?.({ type, text }),
      (confirm) => {
        run.confirm = confirm;
        emit?.({ type: "confirm", ...confirm });
      },
    );
    const session = startScript(root, action.script, {
      env: { ICODE_ACTION: "1", ICODE_ACTION_ID: action.id },
      stdin: true,
      emit: (event) => filter.push(event.type, event.text),
    });
    run.session = session;
    registerProcess({
      kind: "action",
      label: "Action: " + action.label,
      command: ["npm", "run", action.script],
      session,
      stop: () => cancelAction(run.runId),
    });
    const abort = () => cancelAction(run.runId).catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    emit?.({ type: "started", runId: run.runId, action });
    let result;
    try {
      result = await session.completion;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    filter.flush();
    const status = run.cancelled
      ? "cancelled"
      : result.exitCode === 0
        ? "passed"
        : "failed";
    return { runId: run.runId, actionId, exitCode: result.exitCode, status };
  } finally {
    if (current === run) current = null;
  }
}
/** Send the learner's typed confirmation. Only accepted while a prompt is pending. */
export function sendActionInput(runId, input) {
  if (!current || current.runId !== runId)
    throw new Error("No matching action is running");
  if (!current.confirm)
    throw new Error("The action is not waiting for confirmation");
  if (typeof input !== "string" || input.length > 200 || /[\r\n\0]/.test(input))
    throw new Error("Invalid confirmation input");
  current.confirm = null;
  current.session.write(input + "\n");
  return { sent: true };
}
export async function cancelAction(runId) {
  if (!current || current.runId !== runId)
    throw new Error("No matching action is running");
  const run = current;
  run.cancelled = true;
  run.confirm = null;
  await run.session?.stop();
  return { cancelled: true };
}
