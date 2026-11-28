// Stage 4 units: preferences schema (including hostile input), shortcut
// grammar, matcher and conflicts, fuzzy search, theme contrast, OG image and
// the palette's "no API client" rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_UI, safePreferences, validatePreferences } from "./src/ux/preferences.js";
import {
  COMMANDS,
  COMMAND_IDS,
  checkBinding,
  createMatcher,
  eventToBinding,
  findConflicts,
  formatBinding,
  isReserved,
  normalizeBinding,
  parseBinding,
  resolveBindings,
} from "./src/ux/shortcuts.js";
import { fuzzyMatch, highlightParts, parseQuery, search } from "./src/ux/fuzzy.js";
import { contrast, parseColor } from "./src/ux/contrast.js";
import { ogSvg, xmlText } from "./ux-routes.mjs";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("preferences: defaults, valid partial updates and full validation", () => {
  assert.deepEqual(validatePreferences({}), { ...DEFAULT_UI, dismissedWarnings: [], shortcuts: {} });
  assert.deepEqual(validatePreferences({ theme: "light", uiScale: 125 }, { partial: true }), { theme: "light", uiScale: 125 });
  const full = validatePreferences({
    theme: "high-contrast",
    uiScale: 87.5,
    editorFont: "consolas",
    editorFontSize: 18,
    motion: "reduce",
    restoreScroll: false,
    dismissedWarnings: ["exercises-changed", "exercises-changed"],
    shortcuts: { "palette.open": "mod+p", "nav.next": "j j", "theme.cycle": "" },
  });
  assert.equal(full.theme, "high-contrast");
  assert.deepEqual(full.dismissedWarnings, ["exercises-changed"]);
  assert.equal(full.shortcuts["nav.next"], "j j");
});

test("preferences: hostile input is refused (injection, prototype keys, types, size)", () => {
  const bad = [
    null,
    [],
    "theme=dark",
    { theme: "dark; background:url(javascript:alert(1))" },
    { theme: "<img src=x onerror=alert(1)>" },
    { theme: ["dark"] },
    { uiScale: "100" },
    { uiScale: 101 },
    { editorFont: "Comic Sans'; } body { display:none" },
    { editorFontSize: 12.5 },
    { editorFontSize: 1000 },
    { restoreScroll: "true" },
    { motion: "fast" },
    { dismissedWarnings: ["../../etc/passwd"] },
    { dismissedWarnings: "exercises-changed" },
    { shortcuts: { "palette.open": "<script>" } },
    { shortcuts: { "not.a.command": "g x" } },
    { shortcuts: { "palette.open": 42 } },
    { shortcuts: { "palette.open": "shift+a" } },
    { shortcuts: [] },
    { unknown: 1 },
    { style: "body{}" },
    JSON.parse('{"__proto__": {"polluted": true}}'),
    JSON.parse('{"shortcuts": {"__proto__": "g x"}}'),
    { constructor: { prototype: { polluted: true } } },
    Object.create({ theme: "dark" }),
    { theme: "dark", shortcuts: Object.fromEntries(COMMAND_IDS.map((id) => [id, "x".repeat(41)])) },
  ];
  for (const value of bad) assert.throws(() => validatePreferences(value, { partial: true }), /Invalid preferences/, JSON.stringify(value));
  assert.equal({}.polluted, undefined, "no prototype pollution");
  assert.equal(Object.prototype.polluted, undefined);
});

test("preferences: stored values are salvaged key by key, never applied when invalid", () => {
  const ui = safePreferences({ theme: "light", uiScale: "huge", editorFont: "x;}", restoreScroll: false, extra: 1 });
  assert.equal(ui.theme, "light");
  assert.equal(ui.uiScale, 100);
  assert.equal(ui.editorFont, "system-mono");
  assert.equal(ui.restoreScroll, false);
  assert.equal("extra" in ui, false);
  assert.deepEqual(safePreferences("garbage"), validatePreferences({}));
  assert.deepEqual(safePreferences(JSON.parse('{"__proto__":{"theme":"light"}}')), validatePreferences({}));
});

test("shortcuts: binding grammar", () => {
  assert.deepEqual(parseBinding("mod+shift+p"), { type: "chord", mod: true, ctrl: false, alt: false, shift: true, key: "p" });
  assert.deepEqual(parseBinding("g n"), { type: "sequence", keys: ["g", "n"] });
  assert.deepEqual(parseBinding("?"), { type: "sequence", keys: ["?"] });
  assert.equal(normalizeBinding("Shift+Mod+P"), "mod+shift+p");
  assert.equal(normalizeBinding("g ,"), "g ,");
  for (const bad of ["", "shift+a", "mod+ctrl+a", "mod+", "+", "a b c d", "G", "mod+shift+shift+p", "hyper+x", "mod+<script>", 5, null, "x".repeat(41)])
    assert.equal(parseBinding(bad), null, String(bad));
  assert.ok(isReserved("mod+w") && isReserved("ctrl+t") && !isReserved("alt+w"));
});

test("shortcuts: defaults have no conflicts and every command is known", () => {
  assert.equal(new Set(COMMAND_IDS).size, COMMAND_IDS.length);
  assert.deepEqual(findConflicts(resolveBindings({})), []);
  for (const c of COMMANDS) for (const k of c.keys) assert.ok(parseBinding(k), c.id + " " + k);
  assert.deepEqual(resolveBindings({ "nav.next": "" })["nav.next"], []);
  assert.deepEqual(resolveBindings({ "nav.next": "j j" })["nav.next"], ["j j"]);
});

test("shortcuts: remapping checks duplicates, prefixes and reserved keys", () => {
  assert.match(checkBinding("nav.next", "g p"), /Already used by “Go to previous step”/);
  assert.match(checkBinding("nav.next", "g"), /Already used/); // prefix of g-sequences
  assert.match(checkBinding("nav.next", "g p x"), /Already used/); // extends "g p"
  assert.equal(checkBinding("nav.next", "g n x"), "", "replaces its own g n");
  assert.match(checkBinding("theme.cycle", "mod+w"), /reserves/);
  assert.match(checkBinding("theme.cycle", "shift+t"), /Use mod/);
  assert.equal(checkBinding("theme.cycle", "alt+t"), "");
  assert.equal(checkBinding("nav.next", "g p", { "nav.prev": "" }), "", "a freed binding can be reused");
  assert.equal(checkBinding("nav.next", ""), "");
  assert.equal(checkBinding("bogus", "x"), "Unknown command");
});

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
test("shortcuts: matcher handles chords, sequences, typing and dialogs", () => {
  let now = 0;
  const m = createMatcher(resolveBindings({}), { now: () => now });
  assert.equal(m.handle(key("P", { ctrlKey: true, shiftKey: true })), "palette.open");
  assert.equal(m.handle(key("p", { metaKey: true, shiftKey: true })), "palette.open");
  assert.equal(m.handle(key("k", { ctrlKey: true })), "palette.open");
  assert.equal(m.handle(key("s", { ctrlKey: true }), { typing: true }), "file.save", "chords work while typing");
  assert.equal(m.handle(key("Enter", { metaKey: true })), "tests.run");
  assert.equal(m.handle(key("g")), null);
  assert.equal(m.handle(key("n")), "nav.next");
  assert.equal(m.handle(key("?", { shiftKey: true })), "shortcuts.open");
  assert.equal(m.handle(key("g"), { typing: true }), null);
  assert.equal(m.handle(key("n"), { typing: true }), null, "no sequences while typing");
  assert.equal(m.handle(key("g"), { dialog: true }), null);
  assert.equal(m.handle(key("n")), null, "dialog reset the buffer");
  assert.equal(m.handle(key("g")), null);
  now += 2000;
  assert.equal(m.handle(key("n")), null, "sequence timed out");
  assert.equal(m.handle(key("s")), null);
  assert.equal(m.handle(key("p")), "playground.reset");
  assert.equal(m.handle(key("x")), null);
  assert.equal(m.handle(key("g")), null);
  assert.equal(m.handle(key("g")), null);
  assert.equal(m.handle(key("h")), "nav.home", "a repeated first key restarts the sequence");
  assert.equal(m.handle(key("n", { ctrlKey: true })), null, "unbound chord");
  const custom = createMatcher(resolveBindings({ "nav.next": "j j", "palette.open": "alt+space" }));
  assert.equal(custom.handle(key(" ", { altKey: true })), "palette.open");
  assert.equal(custom.handle(key("P", { ctrlKey: true, shiftKey: true })), null, "default replaced");
  assert.equal(custom.handle(key("j")), null);
  assert.equal(custom.handle(key("j")), "nav.next");
  assert.equal(eventToBinding(key("P", { ctrlKey: true, shiftKey: true })), "mod+shift+p");
  assert.equal(eventToBinding(key("Shift", { shiftKey: true })), null);
  assert.equal(eventToBinding(key("g")), "g");
  assert.deepEqual(formatBinding("mod+shift+p"), ["Ctrl", "Shift", "P"]);
  assert.deepEqual(formatBinding("mod+shift+p", true), ["⌘", "Shift", "P"]);
  assert.deepEqual(formatBinding("g n"), ["g", "then", "n"]);
});

test("fuzzy: ranking, ranges and prefixes", () => {
  assert.equal(fuzzyMatch("xyz", "Approval filtering"), null);
  assert.deepEqual(fuzzyMatch("appr", "Approval filtering").ranges, [[0, 4]]);
  const m = fuzzyMatch("apf", "Approval filtering");
  assert.ok(m && m.ranges.length >= 2);
  const items = [
    { label: "Show the console", kind: "command" },
    { label: "Open command palette", kind: "command" },
    { label: "03 Live preview", kind: "lesson", keywords: ["Live applications"] },
    { label: "src/preview.mjs", kind: "file" },
  ];
  assert.equal(search("live", items)[0].item.label, "03 Live preview");
  assert.equal(search("console", items)[0].item.label, "Show the console");
  assert.equal(search("live app", items)[0].item.label, "03 Live preview", "keywords match");
  assert.equal(search("", items).length, 4);
  assert.deepEqual(parseQuery(">theme"), { kind: "command", query: "theme" });
  assert.deepEqual(parseQuery("#03"), { kind: "lesson", query: "03" });
  assert.deepEqual(parseQuery("@src"), { kind: "file", query: "src" });
  assert.deepEqual(parseQuery("plain"), { kind: null, query: "plain" });
  // Highlight parts are plain strings: crafted labels stay text.
  const label = '<img src=x onerror="alert(1)">';
  const parts = highlightParts(label, fuzzyMatch("img", label).ranges);
  assert.equal(parts.map((p) => p.text).join(""), label);
  assert.ok(parts.every((p) => typeof p.text === "string"));
});

// Pull the custom properties of one theme block out of styles.css.
function tokens(css, selector) {
  const start = css.lastIndexOf("\n" + selector + " {");
  assert.ok(start !== -1, selector);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
test("theme: WCAG AA contrast for every theme's text, links, focus and borders", async () => {
  const css = await read("./src/styles.css");
  const dark = tokens(css, ".app");
  const themes = { dark, light: { ...dark, ...tokens(css, ".app.theme-light") }, hc: { ...dark, ...tokens(css, ".app.theme-hc") } };
  const textPairs = [
    ["ink", "bg"], ["soft", "bg"], ["muted", "bg"], ["ink", "panel"], ["soft", "panel"], ["control-ink", "panel"], ["control-ink", "panel-2"],
    ["accent", "bg"], ["accent-ink", "panel-2"], ["link", "bg"], ["on-accent", "accent"], ["ink", "wall"], ["soft", "wall"],
    ["danger-ink", "bg"], ["success", "bg"], ["add-ink", "bg"], ["del-ink", "bg"], ["accent", "panel"], ["soft", "panel-2"],
  ];
  const uiPairs = [["focus", "bg"], ["focus", "panel"], ["control-border", "bg"], ["accent", "bg"], ["warning", "bg"], ["danger", "bg"], ["info", "bg"]];
  for (const [name, t] of Object.entries(themes)) {
    const min = name === "hc" ? 7 : 4.5;
    for (const [fg, bg] of textPairs) {
      assert.ok(parseColor(t[fg]) && parseColor(t[bg]), `${name}: --${fg}/--${bg} must be solid colours`);
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= min, `${name}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
    for (const [fg, bg] of uiPairs) {
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= 3, `${name}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs 3:1`);
    }
  }
  assert.ok(Math.abs(contrast("#000", "#fff") - 21) < 1e-9);
});

test("theme: Stage 3 hard-coded colours are gone outside the theme blocks", async () => {
  const css = await read("./src/styles.css");
  const stage3 = css.slice(css.indexOf("/* Icode Workshop dark visual system"), css.indexOf("/* ---------- Stage 4: theme tokens"));
  const hex = stage3
    .split("\n")
    .filter((l) => !l.startsWith(".ansi-"))
    .join("\n")
    .match(/#[0-9a-f]{3,8}\b/gi);
  // Only the white backgrounds behind embedded third-party pages remain.
  assert.deepEqual([...new Set(hex)], ["#fff"]);
});

test("OG image: offline SVG with escaped, bounded text", () => {
  const svg = ogSvg({ title: '</text><script>alert(1)</script><text>"\'&', subtitle: "\u0000\u0007sub", product: "P<x>" });
  assert.ok(svg.startsWith("<?xml"));
  assert.equal(/<script/i.test(svg), false);
  assert.ok(svg.includes("&lt;/text&gt;&lt;script&gt;"));
  assert.equal(/[\u0000-\u0008]/.test(svg), false);
  assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(svg), false, "no network references");
  assert.equal(xmlText("a".repeat(500)).length, 120);
  assert.equal(xmlText("\ud800x"), " x");
  const long = ogSvg({ title: "word ".repeat(100) });
  assert.ok((long.match(/font-size="72"/g) || []).length <= 3);
});

test("palette module has no API client; mutating commands reuse the button handlers", async () => {
  const palette = await read("./src/palette.jsx");
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//.test(palette), false);
  const main = await read("./src/main.jsx");
  // The palette's course-action entry goes through useActions().start, the
  // same entry point as the Actions panel (the server then asks for the
  // typed confirmation); reset/replace go through the confirming functions.
  assert.match(main, /run: \(\) => \(setPage\(null\), setPanel\("actions"\), actions\.start\(action\)\)/);
  assert.match(main, /"playground\.reset": lessonOnly\(reset\)/);
  assert.match(main, /"playground\.solution": lessonOnly\(\(\) => replaceFrom\(selected, "solution"\)\)/);
  const confirms = main.match(/async function (reset|replaceFrom|migrate)\([^)]*\) \{[\s\S]*?window\.confirm/g) || [];
  assert.equal(confirms.length, 3, "reset, replaceFrom and migrate confirm first");
});
