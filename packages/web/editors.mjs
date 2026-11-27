// Detect local editors and open a file at a line/column. Editors are always
// spawned with an argument array and shell: false; file names are never
// interpreted by a shell. The vscode:// URI remains available as a fallback.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

const goto = (file, line, column) => ["--goto", `${file}:${line}:${column}`];
const jetbrains = (file, line, column) => [
  "--line",
  String(line),
  "--column",
  String(column),
  file,
];
export const KNOWN_EDITORS = {
  code: {
    label: "VS Code",
    bins: ["code", "code-insiders"],
    windowsExe: "Code.exe",
    args: goto,
  },
  cursor: {
    label: "Cursor",
    bins: ["cursor"],
    windowsExe: "Cursor.exe",
    args: goto,
  },
  webstorm: {
    label: "WebStorm",
    bins: ["webstorm", "webstorm64", "webstorm.sh"],
    args: jetbrains,
  },
  idea: {
    label: "IntelliJ IDEA",
    bins: ["idea", "idea64", "idea.sh"],
    args: jetbrains,
  },
  subl: {
    label: "Sublime Text",
    bins: ["subl", "sublime_text"],
    args: (f, l, c) => [`${f}:${l}:${c}`],
  },
};
const TERMINAL = {
  vim: (f, l, c) => [`+call cursor(${l}, ${c})`, f],
  nvim: (f, l, c) => [`+call cursor(${l}, ${c})`, f],
  vi: (f, l) => [`+${l}`, f],
  nano: (f, l, c) => [`+${l},${c}`, f],
  emacs: (f, l, c) => [`+${l}:${c}`, f],
};

/** Map an executable path/name to an editor kind. */
export function editorKind(command) {
  const name = command
    .split(/[\\/]/)
    .pop()
    .replace(/\.(exe|cmd|bat|sh)$/i, "")
    .toLowerCase();
  for (const [kind, editor] of Object.entries(KNOWN_EDITORS))
    if (editor.bins.some((bin) => bin.replace(/\.sh$/, "") === name))
      return kind;
  if (TERMINAL[name]) return name;
  return "generic";
}
export function isTerminalKind(kind) {
  return Boolean(TERMINAL[kind]);
}
/** Arguments that open `file` at line/column for an editor kind. */
export function editorArgs(kind, file, line = 1, column = 1) {
  const clamp = (value) =>
    Math.min(10_000_000, Math.max(1, Math.floor(Number(value) || 1)));
  line = clamp(line);
  column = clamp(column);
  if (KNOWN_EDITORS[kind]) return KNOWN_EDITORS[kind].args(file, line, column);
  if (TERMINAL[kind]) return TERMINAL[kind](file, line, column);
  return [file];
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
/** Resolve an executable on PATH without a shell. */
export function findExecutable(
  name,
  { env = process.env, platform = process.platform } = {},
) {
  // On Windows only PATHEXT candidates run: an extensionless file is a shell
  // script for Git Bash/WSL (for example VS Code's bin\code beside bin\code.cmd).
  const pathext = (env.PATHEXT || ".EXE;.CMD;.BAT")
    .split(";")
    .filter(Boolean)
    .map((e) => e.toLowerCase());
  const extensions =
    platform !== "win32"
      ? [""]
      : pathext.some((ext) => name.toLowerCase().endsWith(ext))
        ? [""]
        : pathext;
  const candidates = (dir) => extensions.map((ext) => join(dir, name + ext));
  if (
    isAbsolute(name) ||
    name.includes("/") ||
    (platform === "win32" && name.includes("\\"))
  )
    return extensions.map((ext) => name + ext).find(isFile) || null;
  for (const dir of (env.PATH || env.Path || "").split(
    platform === "win32" ? ";" : delimiter,
  )) {
    if (!dir) continue;
    const found = candidates(dir).find(isFile);
    if (found) return found;
  }
  return null;
}
/**
 * On Windows, .cmd/.bat launchers need a shell. Map known launchers to their
 * executable instead (for example …\bin\code.cmd → …\Code.exe), otherwise
 * report the editor as unavailable.
 */
// Batch launchers → the executable they start, by launcher name. VS Code puts
// bin\code.cmd one level below Code.exe; Cursor puts its launcher in
// resources\app\bin\cursor.cmd, three levels below Cursor.exe.
const WINDOWS_LAUNCHERS = {
  code: ["Code.exe"],
  "code-insiders": ["Code - Insiders.exe"],
  cursor: ["Cursor.exe"],
};
function windowsCommand(path) {
  const lower = path.toLowerCase();
  // Only real executables can be spawned without a shell (.js/.vbs/.ps1
  // PATHEXT hits cannot).
  if (lower.endsWith(".exe") || lower.endsWith(".com"))
    return { command: path };
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const launcher = path
      .split(/[\\/]/)
      .pop()
      .replace(/\.(cmd|bat)$/i, "")
      .toLowerCase();
    for (const exe of WINDOWS_LAUNCHERS[launcher] || [])
      for (const up of [[".."], ["..", "..", ".."]]) {
        const candidate = join(dirname(path), ...up, exe);
        if (existsSync(candidate)) return { command: candidate };
      }
    return {
      reason: "launcher is a batch file and cannot be run without a shell",
    };
  }
  return { reason: "launcher is a script and cannot be run without a shell" };
}
/** Parse ICODE_EDITOR: a JSON array of strings or a single executable. */
export function parseEditorSetting(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (
      !Array.isArray(parsed) ||
      !parsed.length ||
      parsed.some((x) => typeof x !== "string" || !x)
    )
      throw new Error("ICODE_EDITOR must be a JSON array of strings");
    return parsed;
  }
  return [trimmed];
}
/** $EDITOR/$VISUAL are conventionally whitespace-separated (no quoting). */
const splitWords = (value) =>
  value ? value.trim().split(/\s+/).filter(Boolean) : [];

export function detectEditors({
  env = process.env,
  platform = process.platform,
  tty,
} = {}) {
  const interactive =
    tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const editors = [];
  const add = (id, label, argv, source) => {
    const [bin, ...extra] = argv;
    const kind = editorKind(bin);
    let path = findExecutable(bin, { env, platform });
    let reason = path ? "" : "not found on PATH";
    if (path && platform === "win32") {
      const resolved = windowsCommand(path);
      path = resolved.command || null;
      reason = resolved.reason || "";
    }
    const terminal = isTerminalKind(kind);
    if (path && terminal && !interactive)
      reason = "terminal editor; the workshop is not attached to a terminal";
    editors.push({
      id,
      label,
      kind,
      source,
      terminal,
      available: Boolean(path) && !reason,
      reason: reason || undefined,
      command: path || bin,
      extraArgs: extra,
    });
  };
  try {
    const override = parseEditorSetting(env.ICODE_EDITOR);
    if (override)
      add(
        "override",
        "ICODE_EDITOR (" + basename(override[0]) + ")",
        override,
        "ICODE_EDITOR",
      );
  } catch (e) {
    editors.push({
      id: "override",
      label: "ICODE_EDITOR",
      available: false,
      reason: e.message,
      extraArgs: [],
    });
  }
  for (const variable of ["VISUAL", "EDITOR"]) {
    const words = splitWords(env[variable]);
    if (words.length)
      add(
        variable.toLowerCase(),
        "$" + variable + " (" + basename(words[0]) + ")",
        words,
        variable,
      );
  }
  for (const [id, editor] of Object.entries(KNOWN_EDITORS)) {
    if (editors.some((e) => e.available && e.kind === id)) continue;
    const bin =
      editor.bins.find((b) => findExecutable(b, { env, platform })) ||
      editor.bins[0];
    add(id, editor.label, [bin], "PATH");
  }
  return editors;
}
export function publicEditors(editors) {
  return editors.map(({ command, extraArgs, ...rest }) => rest);
}
/** Default: first available editor in detection order (override, VISUAL, EDITOR, GUI editors). */
export function chooseEditor(editors, id) {
  const pick = id
    ? editors.find((e) => e.id === id)
    : editors.find((e) => e.available);
  if (!pick)
    throw new Error(
      id
        ? "Unknown editor"
        : "No local editor detected; use the VS Code link instead",
    );
  if (!pick.available)
    throw new Error(pick.label + " is unavailable: " + pick.reason);
  return pick;
}
let terminalEditor = null;
/** Launch an editor. Resolves once the process has spawned. */
export async function launchEditor(
  file,
  { line, column, editor: id, env, platform, tty, spawnImpl = spawn } = {},
) {
  if (!isAbsolute(file)) throw new Error("Editor file must be absolute");
  if (!existsSync(file)) throw new Error("File not found");
  const editor = chooseEditor(detectEditors({ env, platform, tty }), id);
  // Terminal editors share the engine's terminal: one at a time.
  if (editor.terminal && terminalEditor)
    throw new Error(
      "A terminal editor is already open in the workshop terminal",
    );
  const args = [
    ...editor.extraArgs,
    ...editorArgs(editor.kind, file, line, column),
  ];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(editor.command, args, {
      shell: false,
      detached: !editor.terminal,
      stdio: editor.terminal ? "inherit" : "ignore",
      windowsHide: false,
    });
    child.once("error", (error) =>
      reject(
        new Error("Could not start " + editor.label + ": " + error.message),
      ),
    );
    child.once("spawn", () => {
      if (!editor.terminal) child.unref();
      else {
        terminalEditor = child;
        child.once("exit", () => (terminalEditor = null));
      }
      resolve({ launched: true, editor: editor.id, label: editor.label });
    });
  });
}
