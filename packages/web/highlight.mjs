// Syntax highlighting for the workbench's read-only views (Problem, Solution,
// Diff). Tokens come from the same Shiki highlighter, themes and contrast
// colour replacements as lesson code (markdown.mjs). The browser gets tokens,
// never HTML: each token is [text, light colour, dark colour, style flags].
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { codeHighlighter } from "./markdown.mjs";
import { compileIgnore, ignorePatterns, parseSide, sideDirectory, validateRelativePath } from "./diff.mjs";
import { assertSafePath, isQuestionLessonFile, validateFile } from "./files.mjs";
import { HIGHLIGHT_MAX_CHARS, plainTextReason } from "./src/ux/code-limits.js";

export const HIGHLIGHT_CACHE_LIMIT = 100;
export const ITALIC = 1,
  BOLD = 2,
  UNDERLINE = 4;

// File names and extensions Shiki does not know by its own names or aliases.
const BY_NAME = { dockerfile: "docker", makefile: "makefile", gnumakefile: "makefile", "cmakelists.txt": "cmake", ".gitignore": "ini", ".editorconfig": "ini", ".npmrc": "ini", ".env": "dotenv" };
const BY_EXTENSION = { h: "c", hpp: "cpp", hh: "cpp", cc: "cpp", cxx: "cpp", csproj: "xml", fsproj: "xml", props: "xml", targets: "xml", sln: "ini", cshtml: "razor", htm: "html", ipynb: "json", webmanifest: "json", map: "json", cfg: "ini", conf: "ini", env: "dotenv", pyi: "python", pyw: "python", markdown: "markdown", bash: "bash", zsh: "bash", gradle: "groovy", plist: "xml", svg: "xml", txt: null, log: null };

/** The Shiki language for a file name, from its extension; null for plain text. */
export function languageForFile(name, bundledLanguages) {
  const base = String(name ?? "").split("/").pop().toLowerCase();
  if (!base) return null;
  const known = (lang) => (lang && Object.hasOwn(bundledLanguages, lang) ? lang : null);
  if (Object.hasOwn(BY_NAME, base)) return known(BY_NAME[base]);
  if (base.startsWith(".env.")) return known("dotenv");
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = base.slice(dot + 1);
  if (Object.hasOwn(BY_EXTENSION, extension)) return known(BY_EXTENSION[extension]);
  return known(extension);
}

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const colour = (value) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : "");
function flags(style) {
  let out = 0;
  if (style["--shiki-light-font-style"] === "italic") out |= ITALIC;
  if (style["--shiki-light-font-weight"] === "bold") out |= BOLD;
  if (String(style["--shiki-light-text-decoration"] ?? "").includes("underline")) out |= UNDERLINE;
  return out;
}

const cache = new Map();
export const highlightCacheSize = () => cache.size;

/**
 * Tokens for one file: `{ lang, lines }`, or `{ plain: reason }` when the
 * file is too large, has no known language, or cannot be tokenised.
 */
export async function highlightText(name, code) {
  const reason = plainTextReason(code);
  if (reason) return { plain: reason };
  const { shiki, hl, colorReplacements } = await codeHighlighter();
  const lang = languageForFile(name, shiki.bundledLanguages);
  if (!lang) return { plain: "No highlighting for this file type" };
  const key = createHash("sha256").update(lang + "\0" + code).digest("hex");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let result;
  try {
    if (!hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(lang);
    const { tokens } = hl.codeToTokens(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
      colorReplacements,
    });
    const lines = tokens.map((line) => {
      const out = [];
      for (const token of line) {
        const style = token.htmlStyle || {};
        const next = [token.content, colour(style["--shiki-light"]), colour(style["--shiki-dark"]), flags(style)];
        const last = out[out.length - 1];
        // Neighbours drawn the same way become one token.
        // Whitespace takes its neighbour's style (unless that underlines).
        if (last && ((last[1] === next[1] && last[2] === next[2] && last[3] === next[3]) || (!next[0].trim() && !(last[3] & UNDERLINE)))) last[0] += next[0];
        else out.push(next);
      }
      return out;
    });
    result = { lang, lines };
  } catch (error) {
    return { plain: "Highlighting failed: " + String(error?.message ?? error).slice(0, 200) };
  }
  cache.set(key, result);
  if (cache.size > HIGHLIGHT_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
}

/** Tokens for a file of one side (`01.problem`, `01.playground`, `01.saved.<id>`). */
export async function highlightSideFile(root, sideSpec, path) {
  const side = parseSide(sideSpec);
  validateRelativePath(path);
  const dir = await sideDirectory(root, side);
  // Only files the workbench already shows: the editor's file rule, or a
  // file the diff of this side lists.
  let listed = true;
  try {
    validateFile(path);
  } catch {
    listed = !compileIgnore(await ignorePatterns(root, [dir], [side.step]))(path, false);
  }
  if (!listed) throw new Error("File is not part of this view");
  const absolute = await assertSafePath(join(dir, ...path.split("/")));
  const info = await lstat(absolute);
  if (!info.isFile()) throw new Error("Not a file");
  // Lesson files that hold check questions stay out of every code view.
  if (!path.includes("/") && isQuestionLessonFile(absolute, path)) throw new Error("This lesson file holds check questions: read it in the lesson");
  // Bytes are at least characters: a file over the limit is never read.
  if (info.size > HIGHLIGHT_MAX_CHARS * 4) return { plain: plainTextReason("x".repeat(HIGHLIGHT_MAX_CHARS + 1)) };
  const buffer = await readFile(absolute);
  if (buffer.subarray(0, 8000).includes(0)) return { plain: "Binary file" };
  return highlightText(path, buffer.toString("utf8"));
}
