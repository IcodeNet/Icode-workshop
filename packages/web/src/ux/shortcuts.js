// Keyboard shortcut registry, binding grammar and matcher.
//
// A binding is either a chord ("mod+shift+p": mod, ctrl or alt plus one key,
// optionally shift) or a sequence of one to three plain keys ("g n", "?").
// "mod" is Ctrl, or Cmd on macOS. Plain keys never fire while the learner is
// typing or while a dialog is open; chords work everywhere.

export const COMMANDS = [
  // General
  { id: "palette.open", label: "Open command palette", group: "General", keys: ["mod+shift+p", "mod+k"] },
  { id: "shortcuts.open", label: "Show keyboard shortcuts", group: "General", keys: ["?", "mod+/"] },
  { id: "preferences.open", label: "Open preferences", group: "General", keys: ["g ,"] },
  { id: "theme.cycle", label: "Cycle theme (system, light, dark, high contrast)", group: "General", keys: [] },
  { id: "connection.retry", label: "Check the workshop server connection now", group: "General", keys: [] },
  // Navigation (g-sequences)
  { id: "nav.home", label: "Go to course home", group: "Navigation", keys: ["g h"] },
  { id: "nav.next", label: "Go to next step", group: "Navigation", keys: ["g n"] },
  { id: "nav.prev", label: "Go to previous step", group: "Navigation", keys: ["g p"] },
  { id: "nav.last", label: "Go to last step", group: "Navigation", keys: ["g l"] },
  { id: "nav.incomplete", label: "Go to next incomplete step", group: "Navigation", keys: ["g i"] },
  { id: "nav.finish", label: "Go to the finish page", group: "Navigation", keys: ["g f"] },
  { id: "nav.guide", label: "Open the guide", group: "Navigation", keys: [] },
  { id: "view.diff", label: "Open the diff (playground → solution)", group: "Navigation", keys: ["g d"] },
  { id: "view.playground", label: "Show the playground editor", group: "Navigation", keys: [] },
  { id: "view.problem", label: "Show the problem files", group: "Navigation", keys: [] },
  { id: "view.solution", label: "Show the solution files", group: "Navigation", keys: [] },
  // Editor and workspace
  { id: "file.save", label: "Save the current file", group: "Editor", keys: ["mod+s"] },
  { id: "tests.run", label: "Run tests", group: "Editor", keys: ["mod+enter"] },
  { id: "file.new", label: "New file in the playground", group: "Editor", keys: [] },
  { id: "file.delete", label: "Delete the current file", group: "Editor", keys: [] },
  { id: "playground.reset", label: "Reset playground to this step's problem", group: "Editor", keys: ["s p"] },
  { id: "playground.solution", label: "Use the solution in the playground", group: "Editor", keys: [] },
  { id: "playground.previous", label: "Copy the previous step's playground", group: "Editor", keys: [] },
  { id: "playground.migrate", label: "Migrate edits from the previous step", group: "Editor", keys: [] },
  { id: "lesson.complete", label: "Mark this step complete or incomplete", group: "Editor", keys: [] },
  // Panels
  { id: "panel.preview", label: "Show the preview panel", group: "Panels", keys: [] },
  { id: "panel.console", label: "Show the console", group: "Panels", keys: [] },
  { id: "panel.tests", label: "Show test results", group: "Panels", keys: [] },
  { id: "panel.actions", label: "Show course actions", group: "Panels", keys: [] },
  { id: "panel.processes", label: "Show processes", group: "Panels", keys: [] },
  { id: "panel.saved", label: "Show saved playgrounds", group: "Panels", keys: [] },
  { id: "panel.update", label: "Show workshop update", group: "Panels", keys: [] },
  { id: "panel.tools", label: "Show tools", group: "Panels", keys: [] },
  { id: "panel.tutor", label: "Show the tutor", group: "Panels", keys: [] },
];
export const COMMAND_IDS = COMMANDS.map((c) => c.id);

/** Shown in the dialog; owned by the diff view and the browser's video player. */
export const FIXED_SHORTCUTS = [
  {
    group: "Diff (in the Diff tab)",
    items: [
      ["j / k", "next / previous file"],
      ["n / p", "next / previous change"],
      ["u", "split or unified view"],
      ["w", "ignore whitespace"],
      ["o", "open or close all files"],
      ["c", "copy a link to this diff"],
      ["?", "diff shortcuts"],
    ],
  },
  {
    group: "Dialogs and lists",
    items: [
      ["Escape", "close the dialog"],
      ["↑ / ↓", "move through results"],
      ["Enter", "run the selected result"],
      ["Tab", "move between controls (stays inside the dialog)"],
    ],
  },
  {
    group: "Video (browser player, when focused)",
    items: [
      ["Space", "play or pause"],
      ["← / →", "seek"],
      ["↑ / ↓", "volume"],
      ["f", "fullscreen (browser dependent)"],
    ],
  },
];

const NAMED = new Set([
  "enter", "escape", "tab", "space", "backspace", "delete", "home", "end", "pageup", "pagedown",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  ...Array.from({ length: 12 }, (_, i) => "f" + (i + 1)),
]);
// One printable, non-space character other than "+" (the separator).
const PRINTABLE = /^[\x21-\x2a\x2c-\x7e]$/;
const RESERVED = new Set(["w", "t", "n", "q", "l", "r", "tab"]);

function validKey(key) {
  return NAMED.has(key) || PRINTABLE.test(key);
}

/** Parse one binding. Returns null when it does not fit the grammar. */
export function parseBinding(text) {
  if (typeof text !== "string") return null;
  const value = text.trim();
  if (!value || value.length > 40) return null;
  if (value.includes("+") && value.length > 1) {
    const parts = value.toLowerCase().split("+");
    const key = parts.pop();
    if (!validKey(key) || !parts.length) return null;
    const mods = new Set(parts);
    if (mods.size !== parts.length || ![...mods].every((m) => ["mod", "ctrl", "alt", "shift"].includes(m))) return null;
    if (mods.has("mod") && mods.has("ctrl")) return null;
    // Shift alone is not a chord: it would fire while typing capitals.
    if (!mods.has("mod") && !mods.has("ctrl") && !mods.has("alt")) return null;
    return { type: "chord", mod: mods.has("mod"), ctrl: mods.has("ctrl"), alt: mods.has("alt"), shift: mods.has("shift"), key };
  }
  const keys = value.split(/\s+/);
  if (keys.length > 3) return null;
  for (const key of keys) {
    const k = key.length === 1 ? key : key.toLowerCase();
    if (!validKey(k)) return null;
    if (key.length === 1 && /[A-Z]/.test(key)) return null; // lower-case letters only
  }
  return { type: "sequence", keys: keys.map((k) => (k.length === 1 ? k : k.toLowerCase())) };
}

export function normalizeBinding(text) {
  const b = parseBinding(text);
  if (!b) return null;
  if (b.type === "sequence") return b.keys.join(" ");
  return [b.mod && "mod", b.ctrl && "ctrl", b.alt && "alt", b.shift && "shift", b.key].filter(Boolean).join("+");
}

export function isReserved(text) {
  const b = parseBinding(text);
  return Boolean(b && b.type === "chord" && (b.mod || b.ctrl) && !b.alt && RESERVED.has(b.key));
}

/** Effective bindings per command: overrides replace the defaults ("" disables). */
export function resolveBindings(overrides = {}) {
  const out = {};
  for (const command of COMMANDS) {
    const custom = Object.prototype.hasOwnProperty.call(overrides, command.id) ? overrides[command.id] : undefined;
    const list = custom === undefined ? command.keys : custom === "" ? [] : [custom];
    out[command.id] = list.map(normalizeBinding).filter(Boolean);
  }
  return out;
}

/** Conflicts between effective bindings (same binding, or a sequence prefix). */
export function findConflicts(bindings) {
  const entries = [];
  for (const [id, list] of Object.entries(bindings)) for (const b of list) entries.push([id, b]);
  const conflicts = [];
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const [a, x] = entries[i];
      const [b, y] = entries[j];
      if (a === b) continue;
      const px = parseBinding(x), py = parseBinding(y);
      const same = x === y;
      const prefix =
        px.type === "sequence" && py.type === "sequence" &&
        (px.keys.every((k, n) => py.keys[n] === k) || py.keys.every((k, n) => px.keys[n] === k));
      if (same || prefix) conflicts.push({ a, b, binding: same ? x : px.keys.length < py.keys.length ? x : y });
    }
  return conflicts;
}

/** Check one proposed override against the rest. Returns an error message or "". */
export function checkBinding(id, text, overrides = {}) {
  if (!COMMAND_IDS.includes(id)) return "Unknown command";
  if (text === "") return "";
  const normal = normalizeBinding(text);
  if (!normal) return "Use mod, ctrl or alt with one key (mod+shift+p), or up to three plain keys (g n).";
  if (isReserved(normal)) return "The browser reserves " + formatBinding(normal).join("+") + ".";
  const conflict = findConflicts(resolveBindings({ ...overrides, [id]: normal })).find((c) => c.a === id || c.b === id);
  if (conflict) {
    const other = conflict.a === id ? conflict.b : conflict.a;
    return "Already used by “" + COMMANDS.find((c) => c.id === other).label + "”.";
  }
  return "";
}

/** Turn a keydown into a binding string ("mod+shift+p", or a plain key), for recording. */
export function eventToBinding(event) {
  const key = keyName(event);
  if (!key || ["control", "meta", "alt", "shift", "os"].includes(key)) return null;
  const mod = event.ctrlKey || event.metaKey;
  if (mod || event.altKey) return [mod && "mod", event.altKey && "alt", event.shiftKey && "shift", key].filter(Boolean).join("+");
  return key;
}

function keyName(event) {
  const k = event.key;
  if (!k) return null;
  if (k === " ") return "space";
  if (k.length === 1) {
    // With a chord, Shift changes the reported key ("P", "?"); compare the base.
    if ((event.ctrlKey || event.metaKey || event.altKey) && /^[A-Z]$/.test(k)) return k.toLowerCase();
    return k;
  }
  return k.toLowerCase();
}

function chordMatches(b, event) {
  const key = keyName(event);
  const base = key && key.length === 1 ? key.toLowerCase() : key;
  if (base !== b.key) return false;
  const mod = event.ctrlKey || event.metaKey;
  if (b.mod && !mod) return false;
  if (b.ctrl && !event.ctrlKey) return false;
  if (!b.mod && !b.ctrl && mod) return false;
  if (b.alt !== Boolean(event.altKey)) return false;
  if (b.shift !== Boolean(event.shiftKey)) return false;
  return true;
}

/**
 * Create a matcher over effective bindings. `handle(event, { typing, dialog })`
 * returns the command id to run, or null. Plain-key sequences are ignored
 * while typing, while a dialog is open or when Ctrl/Cmd/Alt is held.
 */
export function createMatcher(bindings, { timeout = 1500, now = () => Date.now() } = {}) {
  const chords = [];
  const sequences = [];
  for (const [id, list] of Object.entries(bindings))
    for (const text of list) {
      const b = parseBinding(text);
      if (b?.type === "chord") chords.push([id, b]);
      else if (b) sequences.push([id, b.keys]);
    }
  let buffer = [];
  let last = 0;
  return {
    reset() {
      buffer = [];
    },
    pending: () => buffer.slice(),
    handle(event, { typing = false, dialog = false } = {}) {
      for (const [id, b] of chords) if (chordMatches(b, event)) {
        buffer = [];
        return id;
      }
      if (typing || dialog || event.ctrlKey || event.metaKey || event.altKey) {
        buffer = [];
        return null;
      }
      const key = keyName(event);
      if (!key || ["shift", "control", "meta", "alt"].includes(key)) return null;
      if (now() - last > timeout) buffer = [];
      last = now();
      buffer.push(key);
      const exact = sequences.find(([, keys]) => keys.length === buffer.length && keys.every((k, i) => k === buffer[i]));
      if (exact) {
        buffer = [];
        return exact[0];
      }
      const prefix = sequences.some(([, keys]) => keys.length > buffer.length && buffer.every((k, i) => keys[i] === k));
      if (!prefix) {
        // Start over with this key as a possible first key.
        buffer = sequences.some(([, keys]) => keys[0] === key) ? [key] : [];
        const single = sequences.find(([, keys]) => keys.length === 1 && keys[0] === key);
        if (single) {
          buffer = [];
          return single[0];
        }
      }
      return null;
    },
  };
}

/** Key labels for display, e.g. ["Ctrl", "Shift", "P"] or ["g", "then", "n"]. */
export function formatBinding(text, mac = false) {
  const b = parseBinding(text);
  if (!b) return [];
  const label = (k) =>
    ({ enter: "Enter", escape: "Esc", tab: "Tab", space: "Space", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", backspace: "Backspace", delete: "Delete", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown" })[k] ??
    (k.length === 1 ? (b.type === "chord" ? k.toUpperCase() : k) : k.toUpperCase());
  if (b.type === "sequence") return b.keys.flatMap((k, i) => (i ? ["then", label(k)] : [label(k)]));
  return [b.mod && (mac ? "⌘" : "Ctrl"), b.ctrl && "Ctrl", b.alt && (mac ? "⌥" : "Alt"), b.shift && "Shift", label(b.key)].filter(Boolean);
}
