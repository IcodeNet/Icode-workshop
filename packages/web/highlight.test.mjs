import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { highlightSideFile, highlightText, languageForFile } from "./highlight.mjs";
import { codeHighlighter, CODE_BACKGROUNDS, CODE_CONTRAST } from "./markdown.mjs";
import { contrast, parseColor } from "./src/ux/contrast.js";
import { HIGHLIGHT_MAX_CHARS, HIGHLIGHT_MAX_LINE_CHARS, plainTextReason } from "./src/ux/code-limits.js";
import { nativeCourse } from "./test-support/workspace-course.mjs";

const spelled = (result) => result.lines.map((line) => line.map((t) => t[0]).join("")).join("\n");

test("highlight: language comes from the file extension or name", async () => {
  const { shiki } = await codeHighlighter();
  const langs = shiki.bundledLanguages;
  const cases = { "a.ts": "ts", "src/b.js": "js", "c.json": "json", "d.py": "py", "E.cs": "cs", "README.md": "md", "ci.yaml": "yaml", "x.yml": "yml", Dockerfile: "docker", "a.h": "c", "notes.txt": null, LICENSE: null, ".env.local": "dotenv" };
  for (const [name, lang] of Object.entries(cases)) assert.equal(languageForFile(name, langs), lang, name);
});

test("highlight: tokens spell the code exactly and every colour passes AA", async () => {
  const samples = {
    "a.ts": "export function f(x: number): string {\n  return `v${x}`; // note\n}\n",
    "a.js": "const a = [1, 2];\nconsole.log(a.map((n) => n * 2));\n",
    "a.json": '{ "a": 1, "b": [true, null] }\n',
    "a.py": "def f(x):\n    # comment\n    return x + 1\n",
    "a.cs": "public class A { public int B => 1; }\n",
    "a.md": "# Title\n\nSome *text* and `code`.\n",
    "a.yaml": "name: ci\non: [push]\n",
  };
  for (const [name, code] of Object.entries(samples)) {
    const result = await highlightText(name, code);
    assert.ok(result.lines, name + " is highlighted");
    assert.equal(spelled(result), code, name + " tokens spell the code");
    assert.ok(result.lines.flat().some((t) => t[1] || t[2]), name + " has coloured tokens");
    for (const [, light, dark] of result.lines.flat()) {
      if (light) for (const bg of CODE_BACKGROUNDS["github-light"]) assert.ok(contrast(parseColor(light), parseColor(bg)) >= CODE_CONTRAST - 0.01, name + " " + light + " on " + bg);
      if (dark) for (const bg of CODE_BACKGROUNDS["github-dark"]) assert.ok(contrast(parseColor(dark), parseColor(bg)) >= CODE_CONTRAST - 0.01, name + " " + dark + " on " + bg);
    }
  }
});

test("highlight: large files and very long lines stay plain text", async () => {
  assert.equal(plainTextReason("a\n".repeat(10)), "");
  assert.match(plainTextReason("x".repeat(HIGHLIGHT_MAX_CHARS + 1)), /Large file/);
  assert.match(plainTextReason("a\n" + "x".repeat(HIGHLIGHT_MAX_LINE_CHARS + 1)), /long lines/);
  assert.match((await highlightText("big.ts", "const a = 1;\n".repeat(6000))).plain, /Large file/);
  assert.match((await highlightText("notes.txt", "hello")).plain, /No highlighting/);
});

test("highlight: side files are limited to what the workbench shows", async () => {
  const root = await nativeCourse({ files: { "exercises/01/problem/README.md": "# Hi\n", "exercises/01/problem/blob.bin": Buffer.from([1, 0, 2]) } });
  try {
    const result = await highlightSideFile(root, "01.problem", "index.mjs");
    assert.equal(spelled(result), "export const value = 1;\n// TODO\n");
    assert.equal((await highlightSideFile(root, "01.problem", "blob.bin")).plain, "Binary file");
    await assert.rejects(() => highlightSideFile(root, "01.problem", "../../package.json"));
    await assert.rejects(() => highlightSideFile(root, "01.problem", "missing.mjs"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
