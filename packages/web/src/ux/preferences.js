// Stage 4 (G4): UI preference schema, shared by the API (stored in
// .workshop/preferences.json) and the browser (localStorage mirror). Only
// known keys, enums and bounded integers are accepted; shortcut bindings must
// match the binding grammar and name a known command.
import { COMMAND_IDS, parseBinding } from "./shortcuts.js";

export const THEMES = ["system", "light", "dark", "high-contrast"];
export const MOTION = ["system", "reduce", "allow"];
export const EDITOR_FONTS = ["system-mono", "menlo", "consolas", "courier", "ui"];
export const UI_SCALES = [87.5, 100, 112.5, 125, 150];
export const WARNING_IDS = ["exercises-changed"];
export const MAX_SHORTCUTS = 64;
export const MAX_BYTES = 4096;

export const DEFAULT_UI = Object.freeze({
  theme: "dark",
  uiScale: 100,
  editorFont: "system-mono",
  editorFontSize: 12,
  motion: "system",
  restoreScroll: true,
  dismissedWarnings: [],
  shortcuts: {},
});

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function keysOf(value, what) {
  if (!plain(value)) throw new Error("Invalid preferences: " + what + " must be an object");
  // Own keys including non-enumerable ones; JSON.parse creates "__proto__" as
  // an own property, which must be refused, not silently ignored.
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== "string" || FORBIDDEN.has(key)) throw new Error("Invalid preferences: forbidden key in " + what);
  }
  return keys;
}
const fail = (key) => {
  throw new Error("Invalid preferences: " + key);
};

/**
 * Validate UI preferences. With `partial`, only the given keys are checked
 * and returned; otherwise missing keys take their defaults. Throws on any
 * unknown key or out-of-range value.
 */
export function validatePreferences(input, { partial = false } = {}) {
  const keys = keysOf(input, "ui");
  let size;
  try {
    size = JSON.stringify(input).length;
  } catch {
    fail("not serialisable");
  }
  if (size > MAX_BYTES) fail("too large");
  const out = partial ? {} : structuredClone({ ...DEFAULT_UI, dismissedWarnings: [], shortcuts: {} });
  for (const key of keys) {
    const value = input[key];
    switch (key) {
      case "theme":
        if (!THEMES.includes(value)) fail(key);
        break;
      case "motion":
        if (!MOTION.includes(value)) fail(key);
        break;
      case "editorFont":
        if (!EDITOR_FONTS.includes(value)) fail(key);
        break;
      case "uiScale":
        if (!UI_SCALES.includes(value)) fail(key);
        break;
      case "editorFontSize":
        if (!Number.isInteger(value) || value < 11 || value > 24) fail(key);
        break;
      case "restoreScroll":
        if (typeof value !== "boolean") fail(key);
        break;
      case "dismissedWarnings":
        if (!Array.isArray(value) || value.length > 8 || !value.every((v) => WARNING_IDS.includes(v)))
          fail(key);
        out[key] = [...new Set(value)];
        continue;
      case "shortcuts": {
        const ids = keysOf(value, "shortcuts");
        if (ids.length > MAX_SHORTCUTS) fail("shortcuts: too many");
        const shortcuts = {};
        for (const id of ids) {
          if (!COMMAND_IDS.includes(id)) fail("shortcuts: unknown command");
          const binding = value[id];
          if (typeof binding !== "string" || binding.length > 40) fail("shortcuts." + id);
          // "" disables the command's shortcut.
          if (binding !== "" && !parseBinding(binding)) fail("shortcuts." + id);
          shortcuts[id] = binding;
        }
        out[key] = shortcuts;
        continue;
      }
      default:
        fail("unknown key " + JSON.stringify(String(key).slice(0, 40)));
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read a stored value (localStorage or the preferences file). Valid keys are
 * kept, invalid ones fall back to their defaults; nothing invalid is applied.
 */
export function safePreferences(value) {
  try {
    return validatePreferences(value ?? {});
  } catch {
    const out = validatePreferences({});
    if (!plain(value)) return out;
    for (const key of Object.keys(value)) {
      if (FORBIDDEN.has(key) || !(key in DEFAULT_UI)) continue;
      try {
        Object.assign(out, validatePreferences({ [key]: value[key] }, { partial: true }));
      } catch {
        // keep the default
      }
    }
    return out;
  }
}
