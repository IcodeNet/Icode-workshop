// Course hooks: pre/post set-playground and post-update. Hooks are trusted
// course code, declared by the author (native: package.json script names in
// course.json or lab.json; apps layout: per-app and root hook files and the
// package.json settings' scripts.postupdate). They run as managed process
// trees with a timeout, are listed in the Processes view, and receive fully
// resolved, structured context (never an un-awaited Promise).
import { readFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { startProcess } from "../adapter-api/node.mjs";
import { hostConfig } from "../core/layout.mjs";
import { APPS_FORMAT, APPS_HOOK_ENV_PREFIX, APPS_SETTINGS_KEY } from "../core/apps-layout.mjs";
import { validateId } from "../core/index.mjs";
import { courseEnvironment, npmCLI } from "./setup.mjs";
import { SCRIPT_NAME } from "./operations.mjs";
import { registerProcess } from "./processes.mjs";
import { assertSafePath } from "./files.mjs";

export const HOOK_NAMES = {
  preSetPlayground: "pre-set-playground",
  postSetPlayground: "post-set-playground",
  postUpdate: "post-update",
};
export const DEFAULT_HOOK_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL = 20_000;
// Characters a split command line may not contain: they would need a shell.
const SHELL_OPERATORS = /[|&;<>$`\n\r]/;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return undefined;
    throw new Error("Could not read " + path + ": " + e.message);
  }
}

/**
 * Validate a `hooks` block (course.json or lab.json). Pure; exported for tests.
 * Returns script-name specs and the timeout.
 */
export function validateHooks(hooks, scripts = {}, where = "course.json") {
  const result = {};
  if (hooks === undefined) return result;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    throw new Error("hooks in " + where + " must be an object");
  for (const key of Object.keys(hooks))
    if (!(key in HOOK_NAMES) && key !== "timeoutSeconds")
      throw new Error("Unknown hook '" + key + "' in " + where);
  for (const key of Object.keys(HOOK_NAMES)) {
    const script = hooks[key];
    if (script === undefined) continue;
    if (typeof script !== "string" || !SCRIPT_NAME.test(script))
      throw new Error("Invalid script name for hook " + key + " in " + where);
    if (!Object.hasOwn(scripts, script))
      throw new Error(
        "hook " + key + " uses script '" + script + "' which is not in package.json",
      );
    result[key] = { kind: "script", script, label: "npm run " + script };
  }
  if (hooks.timeoutSeconds !== undefined) {
    const t = hooks.timeoutSeconds;
    if (!Number.isInteger(t) || t < 1 || t > 1800)
      throw new Error("Invalid hooks.timeoutSeconds in " + where + " (1–1800)");
    result.timeoutSeconds = t;
  }
  return result;
}

/** Split an apps-layout `scripts.postupdate` command line into words, without a shell. */
export function splitCommand(line) {
  if (typeof line !== "string" || !line.trim() || line.length > 1000)
    throw new Error("Invalid postupdate command");
  if (SHELL_OPERATORS.test(line))
    throw new Error(
      "postupdate uses shell syntax, which Icode does not run; use an npm script",
    );
  const words = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === " ") {
      current += " ";
      i++;
    } else if (c === " " || c === "\t") {
      if (current) words.push(current);
      current = "";
    } else current += c;
  }
  if (current) words.push(current);
  return words;
}

function npxCLI() {
  const npm = npmCLI();
  const npx = join(dirname(npm), "npx-cli.js");
  if (!existsSync(npx)) throw new Error("npx CLI not found next to npm");
  return npx;
}
/** Resolve argv[0] for node/npm/npx to the running Node.js (no shell, portable). */
export function resolveCommand(argv) {
  const [bin, ...rest] = argv;
  if (bin === "node") return [process.execPath, rest];
  if (bin === "npm") return [process.execPath, [npmCLI(), ...rest]];
  if (bin === "npx") return [process.execPath, [npxCLI(), ...rest]];
  return [bin, rest];
}

async function courseScripts(root) {
  const pkg = (await readJson(join(resolve(root), "package.json"))) ?? {};
  return {
    pkg,
    scripts: pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {},
  };
}

/**
 * Hooks that apply to `stepId` (optional) for a source directory (apps-layout
 * per-app hook files take precedence over workshop-root ones). Throws on an
 * invalid declaration, so a broken hook never silently becomes "no hook".
 */
export async function resolveHooks(root, { stepId, srcDir } = {}) {
  root = resolve(root);
  const { pkg, scripts } = await courseScripts(root);
  const course = (await readJson(join(root, "course.json"))) ?? {};
  const resolved = validateHooks(course.hooks, scripts, "course.json");
  if (stepId !== undefined) {
    validateId(stepId);
    const lab = await readJson(join(root, "exercises", stepId, "lab.json"));
    if (lab?.hooks !== undefined) {
      const local = validateHooks(lab.hooks, scripts, "lab.json of " + stepId);
      if (local.postUpdate) throw new Error("postUpdate is a course-level hook");
      Object.assign(resolved, local);
    }
  }
  if (hostConfig(root).format === APPS_FORMAT) {
    for (const [key, file] of [
      ["preSetPlayground", "pre-set-playground.js"],
      ["postSetPlayground", "post-set-playground.js"],
    ]) {
      if (resolved[key]) continue;
      for (const base of [srcDir, root].filter(Boolean)) {
        const path = join(base, APPS_SETTINGS_KEY, file);
        try {
          await assertSafePath(path);
          if ((await lstat(path)).isFile()) {
            resolved[key] = { kind: "file", file: path, label: "node " + APPS_SETTINGS_KEY + "/" + file };
            break;
          }
        } catch (e) {
          if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
        }
      }
    }
    const command = pkg[APPS_SETTINGS_KEY]?.scripts?.postupdate;
    if (!resolved.postUpdate && command !== undefined)
      resolved.postUpdate = {
        kind: "command",
        argv: splitCommand(command),
        label: command,
      };
  }
  resolved.timeoutSeconds ??= DEFAULT_HOOK_TIMEOUT_SECONDS;
  return resolved;
}

const flag = (value) => (value ? "true" : "false");
/** Environment for a hook. Every value is a resolved string. Exported for tests. */
export function hookEnvironment(name, context = {}) {
  const env = {
    ICODE_HOOK: name,
    ICODE_HOOK_CONTEXT: JSON.stringify(context),
  };
  if (context.operation) env.ICODE_PLAYGROUND_OPERATION = context.operation;
  if (context.step) env.ICODE_PLAYGROUND_STEP = context.step;
  if (context.source) {
    env.ICODE_PLAYGROUND_SOURCE_STEP = context.source.step ?? "";
    env.ICODE_PLAYGROUND_SOURCE_VARIANT = context.source.variant ?? "";
  }
  if ("srcDir" in context) {
    const values = {
      TIMESTAMP: String(context.timestamp ?? ""),
      SRC_DIR: context.srcDir ?? "",
      DEST_DIR: context.destDir ?? "",
      WAS_RUNNING: flag(context.wasRunning),
    };
    if ("isStillRunning" in context) {
      values.IS_STILL_RUNNING = flag(context.isStillRunning);
      values.RESTART_PLAYGROUND = flag(context.restartPlayground);
    }
    for (const [key, value] of Object.entries(values)) {
      env["ICODE_PLAYGROUND_" + key] = value;
      env[APPS_HOOK_ENV_PREFIX + key] = value;
    }
  }
  if (context.operation === "update") {
    env.ICODE_UPDATE_FROM = context.from ?? "";
    env.ICODE_UPDATE_TO = context.to ?? "";
  }
  return env;
}

/**
 * Run one hook to completion. Never throws for a failing hook: the result
 * says passed/failed/timeout/stopped. `onSpawn(processId)` lets the caller
 * allow stopping it while a request holds the mutation gate.
 */
export async function runHook(
  root,
  spec,
  { name, context = {}, timeoutSeconds = DEFAULT_HOOK_TIMEOUT_SECONDS, onSpawn, emit } = {},
) {
  root = resolve(root);
  const started = Date.now();
  let output = "";
  const collect = (event) => {
    output = (output + event.text).slice(-OUTPUT_TAIL);
    emit?.({ ...event, hook: name });
  };
  let command, args;
  if (spec.kind === "script") [command, args] = [process.execPath, [npmCLI(), "run", "--silent", spec.script]];
  else if (spec.kind === "file") [command, args] = [process.execPath, [spec.file]];
  else if (spec.kind === "command") [command, args] = resolveCommand(spec.argv);
  else throw new Error("Unknown hook kind");
  let session;
  try {
    session = startProcess(command, args, {
      workspaceRoot: root,
      env: { ...courseEnvironment(root), ...hookEnvironment(name, context) },
      outputLimit: Infinity,
      emit: collect,
    });
  } catch (e) {
    return { hook: name, label: spec.label, status: "failed", exitCode: null, output: e.message, durationMs: 0 };
  }
  let stopped = false,
    timedOut = false;
  const registration = registerProcess({
    kind: "hook",
    label: "Hook " + name + " (" + spec.label + ")",
    command: [spec.label],
    session,
    stop: () => {
      stopped = true;
      return session.stop({ graceMs: 2000 });
    },
  });
  onSpawn?.(registration.id);
  const timer = setTimeout(() => {
    timedOut = true;
    session.stop({ graceMs: 2000 }).catch(() => {});
  }, timeoutSeconds * 1000);
  let result;
  try {
    result = await session.completion;
  } catch (e) {
    result = { exitCode: null };
    collect({ type: "stderr", text: "\n" + e.message + "\n" });
  } finally {
    clearTimeout(timer);
  }
  const status = timedOut
    ? "timeout"
    : stopped
      ? "stopped"
      : result.exitCode === 0
        ? "passed"
        : "failed";
  if (timedOut)
    collect({ type: "stderr", text: "\n[hook timed out after " + timeoutSeconds + "s and was stopped]\n" });
  return {
    hook: name,
    label: spec.label,
    status,
    exitCode: result.exitCode,
    output,
    durationMs: Date.now() - started,
  };
}

/** Format hook results for the console. */
export function describeHooks(hooks = []) {
  return hooks
    .map(
      (h) =>
        "Hook " + h.hook + " (" + h.label + "): " + h.status +
        " in " + (h.durationMs / 1000).toFixed(1) + "s" +
        (h.output ? "\n" + h.output.trimEnd() : ""),
    )
    .join("\n");
}
