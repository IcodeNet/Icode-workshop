// Lesson rendering. Course content is untrusted: the MDX subset
// is rewritten, never evaluated; HTML is sanitised with an explicit allowlist;
// every URL passes an explicit policy; code is highlighted server-side with
// Shiki from text only. See docs/content.md.
import { contrast, parseColor } from "./src/ux/contrast.js";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { posix } from "node:path";
import { Worker } from "node:worker_threads";
import { parseQuestion, assignIds, isQuestionInfo, QUESTION_LIMITS } from "./questions.mjs";
import { randomBytes } from "node:crypto";
import { APPS_VIDEO_TAG } from "../core/apps-layout.mjs";

export const LIMITS = {
  renderMs: 5000,
  sourceBytes: 256 * 1024,
  nesting: 200,
  codeBytes: 100 * 1024,
  mermaidBytes: 50 * 1024,
  tocEntries: 100,
  fallbackChars: 20000,
};

const CALLOUTS = ["info", "success", "warning", "danger", "muted", "note", "tip", "important", "caution"];
const CALLOUT_LABELS = { info: "Info", success: "Success", warning: "Warning", danger: "Danger", muted: "Aside", note: "Note", tip: "Tip", important: "Important", caution: "Caution" };
const ALERTS = { NOTE: "note", TIP: "tip", IMPORTANT: "important", WARNING: "warning", CAUTION: "caution" };
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
const SIDE = /^\d{2}\.(problem|solution|playground)$/;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- 1. MDX subset → Markdown + HTML (outside code) ----------
const COMPONENT_NAMES = `InlineFile|LinkToApp|DiffLink|NextDiffLink|PrevDiffLink|${APPS_VIDEO_TAG}|VideoEmbed`;
function rewriteProse(text) {
  return (
    text
      // MDX comments and whitespace expressions.
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\{\s*(['"`])\s*\1\s*\}/g, " ")
      .replace(/\{\s*(['"`]) \1\s*\}/g, " ")
      // Self-closing components and custom elements: make them open/close
      // pairs, so the HTML parser cannot swallow the rest of the lesson.
      .replace(
        /<([A-Z][A-Za-z0-9]*|[a-z]+-[a-z0-9-]+)((?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*)\s*\/>/g,
        (_, name, attrs) => `<${name}${attrs}></${name}>`,
      )
      // JSX attribute expressions are not evaluated: drop them.
      .replace(/(<[A-Za-z][\w-]*[^<>]*?)\s+[A-Za-z_][\w-]*=\{[^{}]*\}/g, "$1")
  );
}
// Block components on their own line get blank lines around them, so their
// children are parsed as Markdown (as MDX does).
const BLOCK_LINE = /^\s*<\/?(callout-[a-z]+|details)(\s[^<>]*)?>\s*$/;
// A fence may follow blockquote and list-item markers (`> - ```js`): those
// lines are code too and are never rewritten.
const FENCE_LINE = /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*(`{3,}|~{3,})(.*)$/;
/**
 * The MDX subset rewrite, with a map from each output line to its 1-based
 * source line (blank lines are inserted around block components).
 */
export function preprocessMapped(source, { mdx = false } = {}) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const map = [];
  const push = (line, n) => {
    out.push(line);
    map.push(n);
  };
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const marker = line.match(FENCE_LINE);
    if (fence) {
      push(line, n);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = marker[1];
      push(line, n);
      continue;
    }
    if (mdx && /^(import|export)\s.+(from\s+['"][^'"]+['"]|=.*);?\s*$/.test(line)) continue;
    // Keep inline code spans literal.
    let rewritten = line
      .split(/(`+[^`]*`+)/g)
      .map((part, i) => (i % 2 ? part : rewriteProse(part)))
      .join("");
    if (BLOCK_LINE.test(rewritten) || (/<\/summary>\s*$/.test(rewritten) && /^\s*<summary/.test(rewritten))) {
      push("", n);
      push(rewritten.trim(), n);
      push("", n);
      continue;
    }
    push(rewritten, n);
  }
  return { text: out.join("\n"), lines: map };
}
export const preprocess = (source, options) => preprocessMapped(source, options).text;

// ---------- hast helpers ----------
/** Visible text of a node: the hidden new-tab hint of a link is left out. */
function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "element" && [].concat(node.properties?.className || []).includes("new-tab-hint")) return "";
  return (node.children || []).map(textOf).join("");
}
function walk(node, fn, parent = null, depth = 0) {
  if (depth > 5000) throw new RangeError("Document nested too deeply");
  const r = fn(node, parent);
  if (r === false) return;
  if (node.children) for (let i = 0; i < node.children.length; i++) walk(node.children[i], fn, node, depth + 1);
}
const el = (tagName, properties = {}, children = []) => ({ type: "element", tagName, properties, children });
const txt = (value) => ({ type: "text", value });
function classes(node) {
  const c = node.properties?.className;
  return Array.isArray(c) ? c : typeof c === "string" ? c.split(/\s+/) : [];
}

// ---------- 2. components (before sanitising) ----------
function validRelativeFile(file) {
  return typeof file === "string" && file.length <= 240 && !file.includes("\\") && file.split("/").every((p) => p && p !== "." && p !== "..");
}
function components(ctx) {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type !== "element") return;
      const name = node.tagName;
      const p = node.properties || {};
      const children = node.children?.length ? node.children : null;
      const replace = (next) => {
        for (const k of Object.keys(node)) delete node[k];
        Object.assign(node, next);
      };
      const callout = name.match(/^callout-([a-z]+)$/);
      if (callout) {
        const kind = CALLOUTS.includes(callout[1]) ? callout[1] : "info";
        return replace(el("div", { className: ["callout", "callout-" + kind], role: "note" }, [el("strong", { className: ["callout-label"] }, [txt(CALLOUT_LABELS[kind])]), ...(node.children || [])]));
      }
      if (name === "inlinefile") {
        const file = String(p.file ?? "");
        if (!validRelativeFile(file)) return replace(el("span", {}, children || [txt(file)]));
        return replace(el("a", { href: "#file=" + encodeURIComponent(file), className: ["engine-link", "inline-file"] }, children || [el("code", {}, [txt(file)])]));
      }
      if (name === "linktoapp") {
        const to = String(p.to ?? "/");
        const ok = /^\/(?!\/)[\w\-./~%?=&#]*$/.test(to) && to.length <= 500;
        return replace(
          ok
            ? el("a", { href: "#app=" + encodeURIComponent(to), className: ["engine-link"] }, children || [txt("Open the app at " + to)])
            : el("span", {}, children || [txt(to)]),
        );
      }
      if (["difflink", "nextdifflink", "prevdifflink"].includes(name)) {
        const label = children || [txt(name === "nextdifflink" ? "Diff with the next step" : name === "prevdifflink" ? "Diff with the previous step" : "View the diff")];
        if (!ctx.stepId)
          return replace(el("span", { className: ["diff-link-inactive"], title: "Diff links work inside a step's lessons" }, label));
        let target = name === "nextdifflink" ? "next" : name === "prevdifflink" ? "prev" : "step";
        if (name === "difflink" && SIDE.test(String(p.app1 ?? "")) && SIDE.test(String(p.app2 ?? ""))) target = p.app1 + ".." + p.app2;
        return replace(el("a", { href: "#diff=" + target, className: ["engine-link"] }, label));
      }
      if (name === APPS_VIDEO_TAG.toLowerCase() || name === "videoembed") {
        const url = String(p.url ?? "");
        return replace(
          el("p", { className: ["video-card"] }, [
            el("a", { href: url, className: ["video-link"] }, children || [txt("▶ Watch the video")]),
          ]),
        );
      }
      if (name === "blockquote") {
        const first = node.children?.find((c) => c.type === "element");
        const head = first?.tagName === "p" ? first.children?.[0] : null;
        const m = head?.type === "text" && head.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
        if (m) {
          head.value = head.value.slice(m[0].length);
          const kind = ALERTS[m[1]];
          return replace(el("div", { className: ["callout", "callout-" + kind], role: "note" }, [el("strong", { className: ["callout-label"] }, [txt(CALLOUT_LABELS[kind])]), ...node.children]));
        }
      }
    });
  };
}

// ---------- 3. sanitiser schema ----------
const GLOBAL_ATTRS = ["title", "lang", "dir", "align", "colSpan", "rowSpan", "scope", "headers", "alt", "width", "height", "start", "open", "abbr", "dateTime"];
export const schema = {
  strip: ["script", "style", "template", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "svg", "math", "textarea", "select", "option", "title", "head", "meta", "link", "base", "form", "button", "audio", "video", "canvas", "portal", "xmp", "plaintext", "noembed", "noframes"],
  tagNames: ["a", "b", "blockquote", "br", "code", "dd", "del", "details", "div", "dl", "dt", "em", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var", "abbr", "time", "caption", "colgroup", "col"],
  attributes: {
    "*": GLOBAL_ATTRS,
    a: ["href", ["id", /^fn-/], "dataFootnoteBackref", "dataFootnoteRef", "ariaDescribedBy", "ariaLabel", ["className", "engine-link", "inline-file", "video-link", "data-footnote-backref"]],
    div: ["role", ["className", "callout", ...CALLOUTS.map((k) => "callout-" + k)]],
    strong: [["className", "callout-label"]],
    span: [["className", "diff-link-inactive"]],
    p: [["className", "video-card"]],
    code: [["className", /^language-[\w+#.-]{1,40}$/], "dataMeta"],
    img: ["src"],
    input: [["disabled", true], ["type", "checkbox"], "checked"],
    li: [["className", "task-list-item"], ["id", /^fn-/]],
    ol: [["className", "contains-task-list"]],
    ul: [["className", "contains-task-list"]],
    section: ["dataFootnotes", ["className", "footnotes"]],
    h2: [["className", "sr-only"]],
  },
  required: { input: { disabled: true, type: "checkbox" } },
  // Every href/src is checked by policy() right after sanitising, so the
  // sanitiser itself does not filter protocols (one place decides).
  protocols: {},
  clobberPrefix: "",
  clobber: [],
  ancestors: { tbody: ["table"], td: ["table"], th: ["table"], thead: ["table"], tfoot: ["table"], tr: ["table"] },
  allowComments: false,
  allowDoctypes: false,
};

// ---------- 4. URL policy ----------
/**
 * Returns {href} for an allowed URL or {blocked: reason}.
 * kind: "link" | "image". https:, fragments, and relative paths that stay
 * inside the course are allowed; everything else is blocked.
 */
export function policy(raw, { kind = "link", root = null, docDir = "", sandboxOrigin = "" } = {}) {
  if (typeof raw !== "string") return { blocked: "missing" };
  const url = raw.trim();
  // Browsers ignore ASCII tab/newline anywhere and leading C0/space.
  const probe = url.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!probe) return { blocked: "empty" };
  if (probe.startsWith("#")) return kind === "link" ? { href: url } : { blocked: "fragment image" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe)) {
    try {
      const parsed = new URL(probe);
      if (parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password) return { href: parsed.href, external: true };
      // Lessons often point at a local dev server: http only on loopback, links only.
      if (kind === "link" && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) && !parsed.username && !parsed.password) return { href: parsed.href, external: true };
    } catch {}
    return { blocked: "scheme" };
  }
  if (/^[\\/]/.test(probe) || /^[a-z]:/i.test(probe)) return { blocked: "absolute" };
  if (/[\u0000-\u001f\\]/.test(url)) return { blocked: "control" };
  const pathPart = url.split(/[?#]/)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return { blocked: "encoding" };
  }
  if (/[\u0000-\u001f\\]/.test(decoded) || !decoded) return { blocked: "path" };
  const joined = posix.normalize(posix.join(docDir || ".", decoded));
  if (joined === ".." || joined.startsWith("../") || posix.isAbsolute(joined)) return { blocked: "outside course" };
  if (joined.split("/").some((p) => p.startsWith(".") && p !== ".")) return { blocked: "hidden path" };
  if (kind === "image") {
    if (!IMAGE_EXT.test(joined) || !sandboxOrigin) return { blocked: "not an image" };
    return { href: sandboxOrigin + "/asset/" + joined.split("/").map(encodeURIComponent).join("/") };
  }
  return { href: "#course=" + encodeURIComponent(joined) };
}

/** Text appended, visually hidden, to every link that opens a new tab. */
export const NEW_TAB_HINT = " (opens in a new tab)";
function applyPolicy(ctx) {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type !== "element") return;
      const attr = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : null;
      if (!attr) return;
      const p = node.properties || (node.properties = {});
      if (p[attr] === undefined) {
        if (node.tagName === "img") node.tagName = "span";
        return;
      }
      const result = policy(String(p[attr]), { kind: node.tagName === "img" ? "image" : "link", docDir: ctx.docDir, sandboxOrigin: ctx.sandboxOrigin });
      if (result.blocked) {
        delete p[attr];
        p.dataBlockedUrl = result.blocked;
        p.title = "Blocked by the workshop URL policy";
        if (node.tagName === "img") {
          node.tagName = "span";
          node.children = [txt(p.alt ? "[image: " + p.alt + "]" : "[image]")];
          delete p.alt;
        }
        ctx.warnings.push("Blocked " + (node.tagName === "a" ? "link" : "image") + " (" + result.blocked + ")");
        return;
      }
      p[attr] = result.href;
      if (node.tagName === "a" && result.external) {
        // A link to another origin opens in a new tab, so the workshop page
        // stays where it is. The hint is part of the link's accessible name.
        p.target = "_blank";
        p.rel = ["noopener", "noreferrer", "nofollow"];
        p.className = [...classes(node).filter((c) => c !== "external-link"), "external-link"];
        node.children.push(el("span", { className: ["visually-hidden", "new-tab-hint"] }, [txt(NEW_TAB_HINT)]));
      }
      if (node.tagName === "img") {
        p.loading = "lazy";
        p.referrerPolicy = "no-referrer";
      }
    });
  };
}

// ---------- 5. headings and TOC ----------
function headings(ctx) {
  return (tree) => {
    const used = new Map();
    walk(tree, (node, parent) => {
      if (node.type !== "element" || !/^h[1-6]$/.test(node.tagName)) return;
      const text = textOf(node).replace(/\s+/g, " ").trim();
      let slug = "h-" + (text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section");
      const n = used.get(slug) || 0;
      used.set(slug, n + 1);
      if (n) slug += "-" + (n + 1);
      node.properties.id = slug;
      // The section link is a sibling of the heading, so the heading's
      // accessible name is its own text and nothing else.
      const anchor = el("a", { href: "#" + slug, className: ["heading-anchor"], ariaLabel: "Link to section: " + text.slice(0, 80) }, [el("span", { ariaHidden: "true" }, [txt("#")])]);
      const index = parent ? parent.children.indexOf(node) : -1;
      if (index >= 0) parent.children[index] = el("div", { className: ["heading-row"] }, [node, anchor]);
      if ((node.tagName === "h2" || node.tagName === "h3") && ctx.toc.length < LIMITS.tocEntries)
        ctx.toc.push({ depth: Number(node.tagName[1]), text: text.slice(0, 120), id: slug });
      return false;
    });
  };
}

// ---------- 6. code: Shiki and Mermaid ----------
let highlighterPromise;
async function highlighter() {
  highlighterPromise ??= import("shiki").then(async (shiki) => {
    const hl = await shiki.createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
    return { shiki, hl, colorReplacements: contrastReplacements(hl) };
  });
  return highlighterPromise;
}

// WCAG AA: code colours are checked against every background a code
// line can have in the UI (plain, highlighted line, diff add/remove; dark and
// high-contrast share the dark palette). A theme colour below the target is
// darkened (light) or lightened (dark) until it passes. Applied through
// Shiki's colorReplacements, so this covers every language: token colours
// come from the theme, not the grammar.
export const CODE_BACKGROUNDS = {
  "github-light": ["#ffffff", "#f6ede9", "#e0f4e7", "#fbe8e8"],
  "github-dark": ["#020617", "#000000", "#2f2628", "#0c2320", "#29121f", "#003d16", "#4d0000"],
};
export const CODE_CONTRAST = 4.6;
const hex6 = (c) => {
  const v = String(c).toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + [...v.slice(1)].map((h) => h + h).join("");
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v.slice(0, 7);
  return null;
};
const toHex = (rgb) => "#" + rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
export function passingColor(color, backgrounds, towards, target = CODE_CONTRAST) {
  const base = parseColor(hex6(color));
  const goal = towards === "dark" ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const rgb = base.map((c, i) => c + (goal[i] - c) * t);
    if (backgrounds.every((bg) => contrast(rgb, bg) >= target)) return toHex(rgb);
  }
  return toHex(goal);
}
/**
 * Foreground colours a token can be drawn in. With `ownBackground: false`,
 * rules that paint their own token background are left out (their colour is
 * checked against that background instead) and so is the theme's background.
 */
export function themeColors(theme, { ownBackground = true } = {}) {
  const out = new Set();
  const bg = ownBackground ? null : hex6(theme.bg);
  const add = (c) => hex6(c) && hex6(c) !== bg && out.add(c.toLowerCase());
  add(theme.fg);
  for (const rule of theme.settings || theme.tokenColors || [])
    if (ownBackground || !rule?.settings?.background) add(rule?.settings?.foreground);
  return [...out];
}
function contrastReplacements(hl) {
  const replacements = {};
  for (const [name, backgrounds] of Object.entries(CODE_BACKGROUNDS)) {
    const map = (replacements[name] = {});
    // Light spans keep their token backgrounds; dark spans are transparent
    // (styles.css), so every dark foreground sits on the code background.
    const light = name === "github-light";
    for (const color of themeColors(hl.getTheme(name), { ownBackground: !light })) {
      if (backgrounds.every((bg) => contrast(parseColor(hex6(color)), bg) >= CODE_CONTRAST)) continue;
      map[color] = passingColor(color, backgrounds, light ? "dark" : "light");
    }
  }
  return replacements;
}
export async function codeColorReplacements() {
  return (await highlighter()).colorReplacements;
}
export function parseMeta(meta = "") {
  const out = { lines: new Set(), title: null };
  const m = String(meta).slice(0, 500);
  const title = m.match(/(?:filename|title|file)=(?:"([^"]{1,200})"|'([^']{1,200})'|(\S{1,200}))/);
  if (title) out.title = title[1] ?? title[2] ?? title[3];
  const spec = m.match(/\{([\d,\s-]+)\}/)?.[1] ?? m.match(/(?:lines|highlight)=["']?([\d,\s-]+)["']?/)?.[1];
  if (spec)
    for (const part of spec.split(",")) {
      const [a, b] = part.trim().split("-").map(Number);
      if (!Number.isInteger(a)) continue;
      const end = Number.isInteger(b) ? Math.min(b, a + 5000) : a;
      for (let i = a; i <= end; i++) out.lines.add(i);
    }
  return out;
}
function code(ctx) {
  return async (tree) => {
    const blocks = [];
    walk(tree, (node, parent) => {
      if (node.type === "element" && node.tagName === "pre" && node.children?.length === 1 && node.children[0].tagName === "code") {
        blocks.push({ node, parent });
        return false;
      }
    });
    const langOf = (node) => (classes(node.children[0]).find((c) => c.startsWith("language-")) || "").slice(9).toLowerCase();
    // Check questions: only the code nodes the Markdown parse found carry
    // this render's token (raw HTML cannot forge it). Nested content never
    // holds questions: there, a question fence is plain code.
    const byIndex = new Map();
    if (!ctx.nested && ctx.questionToken)
      for (const { node } of blocks) {
        // By token only: the info string may differ in case or spacing.
        const m = textOf(node.children[0]).trim().match(ctx.questionToken);
        if (m) byIndex.set(Number(m[1]), node);
      }
    const done = new Set(byIndex.values());
    if (ctx.questionBodies?.length) await questions(ctx, byIndex);
    for (const { node } of blocks) {
      if (done.has(node)) continue;
      const codeNode = node.children[0];
      const lang = langOf(node);
      const meta = parseMeta(codeNode.properties?.dataMeta);
      const value = textOf(codeNode).replace(/\n$/, "");
      let replacement;
      if (lang === "mermaid") {
        replacement =
          Buffer.byteLength(value) > LIMITS.mermaidBytes
            ? el("figure", { className: ["mermaid-diagram", "mermaid-too-large"] }, [el("figcaption", {}, [txt("Diagram too large to render")]), el("pre", { className: ["mermaid-source"] }, [el("code", {}, [txt(value)])])])
            : el("figure", { className: ["mermaid-diagram"], dataSource: value }, [el("pre", { className: ["mermaid-source"] }, [el("code", {}, [txt(value)])])]);
      } else {
        let pre = null;
        if (Buffer.byteLength(value) <= LIMITS.codeBytes) {
          try {
            const { shiki, hl, colorReplacements } = await highlighter();
            const resolved = lang && (shiki.bundledLanguages[lang] ? lang : shiki.bundledLanguagesAlias?.[lang] ? lang : null);
            if (resolved && !hl.getLoadedLanguages().includes(resolved)) await hl.loadLanguage(resolved);
            const root = hl.codeToHast(value, {
              lang: resolved || "text",
              themes: { light: "github-light", dark: "github-dark" },
              defaultColor: false,
              colorReplacements,
              transformers: [
                {
                  line(line, n) {
                    if (meta.lines.has(n)) this.addClassToHast(line, "highlighted");
                    if (lang === "diff") {
                      const first = textOf(line)[0];
                      if (first === "+") this.addClassToHast(line, "diff-add");
                      if (first === "-") this.addClassToHast(line, "diff-remove");
                    }
                  },
                },
              ],
            });
            pre = root.children.find((c) => c.tagName === "pre");
          } catch (error) {
            ctx.warnings.push("Highlighting failed: " + error.message);
          }
        }
        pre ??= el("pre", { className: ["plain"] }, [el("code", {}, [txt(value)])]);
        if (pre.properties) pre.properties.dataLang = lang || "text";
        replacement = el("div", { className: ["code-block"] }, [...(meta.title ? [el("div", { className: ["code-title"] }, [txt(meta.title)])] : []), pre]);
      }
      for (const k of Object.keys(node)) delete node[k];
      Object.assign(node, replacement);
    }
  };
}

// ---------- 7. check questions (docs/check-questions.md) ----------
const htmlOf = (children) => unified().use(rehypeStringify).stringify({ type: "root", children });
const plain = (children) => textOf({ type: "root", children }).replace(/\s+/g, " ").trim();
/** Markdown inside a question, through the same sanitiser and URL policy. */
async function fragment(markdown, ctx, { inline = false } = {}) {
  const sub = { ...ctx, nested: true, warnings: ctx.warnings, toc: [] };
  const processor = pipeline(sub, { mdx: ctx.mdx, nested: true });
  const tree = await processor.run(processor.parse(preprocess(markdown, { mdx: ctx.mdx })));
  const children = tree.children.filter((c) => !(c.type === "text" && !c.value.trim()));
  if (inline && children.length === 1 && children[0].tagName === "p") return children[0].children;
  return children;
}
function invalidQuestion(position, errors) {
  return el("div", { className: ["callout", "callout-warning", "question-invalid"], role: "note" }, [
    el("strong", { className: ["callout-label"] }, [txt("Author warning")]),
    el("p", {}, [txt(`Check question ${position} is invalid and is not shown. Run `), el("code", {}, [txt("workshop validate")]), txt(" for the file and line.")]),
    el("ul", {}, errors.slice(0, 10).map((e) => el("li", {}, [txt(e)]))),
  ]);
}
async function questions(ctx, byIndex) {
  // Ids and positions follow the Markdown parse (document order, footnotes
  // where they are defined), the same order validate and the plain copy use.
  const parsed = ctx.questionBodies.map((body) => parseQuestion(body));
  const { ids, warnings } = assignIds(parsed, ctx.docPath);
  ctx.warnings.push(...warnings);
  for (let i = 0; i < parsed.length; i++) {
    const node = byIndex.get(i);
    if (!node) continue;
    const p = parsed[i];
    let replacement;
    if (i >= QUESTION_LIMITS.perDocument) {
      replacement = invalidQuestion(i + 1, [`A document may hold at most ${QUESTION_LIMITS.perDocument} check questions.`]);
      ctx.warnings.push("Too many check questions");
    } else if (!p.ok) {
      replacement = invalidQuestion(i + 1, p.errors);
      ctx.warnings.push("Invalid check question " + (i + 1));
    } else {
      const q = p.question;
      const id = ids[i];
      const base = "q-" + id;
      const prompt = await fragment(q.prompt, ctx);
      const head = [el("span", { className: ["cq-label"] }, [txt("Check question")])];
      if (q.source) head.push(el("span", { className: ["cq-source"], title: "Source" }, [txt(q.source)]));
      const children = [el("div", { className: ["cq-head"] }, head), el("div", { className: ["cq-prompt"], id: base + "-prompt" }, prompt)];
      if (q.kind === "choice") {
        const options = [];
        for (let n = 0; n < q.options.length; n++)
          options.push(el("li", { className: ["cq-option"], dataOption: String(n) }, await fragment(q.options[n], ctx, { inline: true })));
        children.push(el("ol", { className: ["cq-options"] }, options));
      }
      // Static text for engines or pages that do not hydrate the block. It
      // never holds the answer: that is fetched only after an attempt.
      children.push(
        el("p", { className: ["cq-static"] }, [
          txt(!ctx.stepId ? "Check questions can be answered inside a step's lessons." : q.kind === "choice" ? "Choose an answer, then check it." : "Write your answer, then reveal the model answer."),
        ]),
      );
      replacement = el(
        "div",
        { className: ["check-question"], id: base, role: "group", ariaLabelledBy: base + "-prompt", dataQuestion: id, dataKind: q.kind, ...(ctx.stepId ? {} : { dataInactive: "true" }) },
        children,
      );
      if (ctx.stepId) {
        const explanation = await fragment(q.explanation, ctx);
        ctx.questions.push({
          id,
          kind: q.kind,
          options: q.options?.length ?? 0,
          ...(q.kind === "choice" ? { answerIndex: q.answerIndex } : { answerHtml: htmlOf(await fragment(q.answer, ctx)) }),
          explanationHtml: htmlOf(explanation),
          promptText: plain(prompt).slice(0, 200),
          ...(q.source ? { source: q.source } : {}),
        });
      }
    }
    for (const k of Object.keys(node)) delete node[k];
    Object.assign(node, replacement);
  }
}

// ---------- 8. one source of truth for question blocks ----------
// Every consumer (rendered HTML, the plain-text copy, the API payload, MCP,
// the tutor, `workshop validate`) finds question blocks in the same Markdown
// parse the renderer uses: `code` nodes whose info string is `question`.
function syntax(mdx) {
  const processor = unified().use(remarkParse);
  if (mdx) processor.use(noIndentedCode);
  return processor.use(remarkGfm);
}
function questionNodes(tree) {
  const out = [];
  const visit = (node, depth = 0) => {
    if (depth > 5000) throw new RangeError("Document nested too deeply");
    if (node.type === "code" && isQuestionInfo(node.lang)) return void out.push(node);
    if (node.children) for (const child of node.children) visit(child, depth + 1);
  };
  visit(tree);
  return out;
}
const codeNodes = (tree) => {
  const out = [];
  const visit = (node) => (node.type === "code" ? out.push(node) : node.children?.forEach(visit));
  visit(tree);
  return out;
};
/** Remark stage: take question bodies out of the tree, leaving a per-render token. */
function remarkQuestions(ctx) {
  return (tree) => {
    ctx.questionBodies = [];
    if (ctx.nested) return;
    questionNodes(tree).forEach((node, i) => {
      ctx.questionBodies.push(node.value);
      node.value = ctx.questionTokenPrefix + i;
      node.meta = null;
    });
  };
}
// A line that looks like the start of a question fence, however it is
// indented or prefixed (also NBSP or tabs before the info string).
// Only at the start of a line (after indentation, blockquote or list
// markers): inline mentions of the syntax are prose.
const LOOKALIKE = /^(?:[\s\u00a0\ufeff>]|[-*+](?=\s)|\d{1,9}[.)](?=\s))*(`{3,}|~{3,})[\s\u00a0\ufeff]*question(?![\w-])/i;
// Anywhere: used where being conservative costs nothing (fallbacks, files).
const MENTION = /(`{3,}|~{3,})[\s\u00a0\ufeff]*question(?![\w-])/i;
export const mayHoldQuestions = (source) => MENTION.test(String(source ?? ""));
const closingFence = (line, marker) => {
  const m = line.replace(/^(?:[ \t>]|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))*/, "").match(/^(`{3,}|~{3,})\s*$/);
  return m && m[1][0] === marker[0] && m[1].length >= marker.length;
};
/**
 * Question blocks of a document, from the renderer's own parse.
 * blocks: [{start, end, line, body, unclosed}] (offsets into `text`, the
 * preprocessed source; `line` is the 1-based source line).
 * orphans: text that looks like a question fence but is not parsed as one
 * (inside raw HTML, an indented code block, a NBSP in the info string…):
 * it would render as visible text, answer included.
 */
export function analyzeQuestions(source, { mdx = false } = {}) {
  const { text, lines } = preprocessMapped(String(source ?? ""), { mdx });
  const tree = syntax(mdx).parse(text);
  const sourceLine = (n) => lines[n - 1] ?? n;
  const textLines = text.split("\n");
  const nodes = questionNodes(tree);
  const blocks = nodes.map((node) => {
    const { start, end } = node.position;
    const last = textLines[end.line - 1] ?? "";
    const marker = (textLines[start.line - 1] ?? "").match(/(`{3,}|~{3,})/)?.[1] ?? "```";
    return { start: start.offset, end: end.offset, startLine: start.line, endLine: end.line, line: sourceLine(start.line), body: node.value, unclosed: end.line === start.line || !closingFence(last, marker) };
  });
  // Fenced examples of the syntax (```markdown … ```question … ```) are
  // intentional; question fences inside them are not orphans.
  const examples = codeNodes(tree)
    // A fenced node's own text starts with its fence; an indented one does not.
    .filter((node) => !isQuestionInfo(node.lang) && /^(`{3,}|~{3,})/.test(text.slice(node.position.start.offset, node.position.start.offset + 3)))
    .map((node) => [node.position.start.line, node.position.end.line]);
  const inside = (n, ranges) => ranges.some(([a, b]) => n >= a && n <= b);
  const owned = blocks.map((b) => [b.startLine, b.endLine]);
  const orphans = [];
  for (let i = 0; i < textLines.length; i++) {
    const n = i + 1;
    const m = textLines[i].match(LOOKALIKE);
    if (!m || inside(n, owned) || inside(n, examples) || inside(n, orphans.map((o) => [o.startLine, o.endLine]))) continue;
    let j = i + 1;
    while (j < textLines.length && j - i < 400 && !closingFence(textLines[j], m[1])) j++;
    const body = textLines
      .slice(i + 1, j)
      .map((l) => l.replace(/^(?:[ \t]*>)+ ?/, "").replace(/^\t/, ""))
      .join("\n");
    orphans.push({ startLine: n, endLine: Math.min(j + 1, textLines.length), line: sourceLine(n), body });
  }
  return { text, blocks, orphans };
}
function summary(body) {
  const parsed = parseQuestion(body);
  if (!parsed.ok) return "**Check question** (invalid block, not shown)";
  const q = parsed.question;
  return ["**Check question:** " + q.prompt.trim(), ...(q.options ? ["", ...q.options.map((o, i) => `${i + 1}. ${o.replace(/\s+/g, " ").trim()}`)] : [])].join("\n");
}
/** The preprocessed source with every question block (by node) and orphan replaced. */
function stripAnalysed({ text, blocks, orphans }) {
  const ranges = [
    ...blocks.map((b) => ({ start: b.start, end: b.end, value: summary(b.body) })),
    ...orphans.map((o) => {
      const starts = text.split("\n").slice(0, o.startLine - 1).join("\n").length + (o.startLine > 1 ? 1 : 0);
      const ends = text.split("\n").slice(0, o.endLine).join("\n").length;
      return { start: starts, end: ends, value: "**Check question** (not shown: run `workshop validate`)" };
    }),
  ].sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  for (const r of ranges) {
    if (r.end > floor) continue; // overlapping: the outer range already went
    out = out.slice(0, r.start) + r.value + out.slice(r.end);
    floor = r.start;
  }
  return out;
}

// Fail-closed guard. Fingerprints are runs of words from answers and
// explanations (and from whole orphan blocks) that occur nowhere in the
// visible text of the lesson; any output that contains one is withheld.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function words(value, { html = false } = {}) {
  let s = String(value ?? "");
  if (html) s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(Number(e[1].toLowerCase() === "x" ? "0x" + e.slice(2) : e.slice(1))) : ENTITIES[e.toLowerCase()] ?? " ",
  );
  return s.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
const WINDOW = 5;
function windows(list, size) {
  const out = [];
  for (let i = 0; i + size <= list.length; i++) out.push(list.slice(i, i + size).join(" "));
  return out;
}
function windowSet(list) {
  return new Set([...windows(list, WINDOW), ...windows(list, 4), ...windows(list, 3)]);
}
export function questionFingerprints(analysis, visibleText) {
  const secrets = [];
  for (const b of analysis.blocks) {
    const p = parseQuestion(b.body);
    if (p.ok) secrets.push(p.question.explanation, ...(p.question.kind === "free" ? [p.question.answer] : []));
    else secrets.push(b.body);
  }
  for (const o of analysis.orphans) {
    const p = parseQuestion(o.body);
    secrets.push(...(p.ok ? [p.question.explanation, ...(p.question.kind === "free" ? [p.question.answer] : [])] : [o.body]));
  }
  const visible = windowSet(words(visibleText));
  const out = new Set();
  for (const secret of secrets) {
    const w = words(secret);
    const candidates = w.length >= WINDOW ? windows(w, WINDOW) : w.length >= 3 && w.join(" ").length >= 15 ? [w.join(" ")] : [];
    for (const c of candidates) if (!visible.has(c)) out.add(c);
  }
  return [...out];
}
/** True when `output` contains any fingerprint. */
export function leaksAnswers(output, fingerprints, { html = false } = {}) {
  if (!fingerprints.length) return false;
  const seen = windowSet(words(output, { html }));
  return fingerprints.some((f) => seen.has(f));
}
const WITHHELD_HTML =
  '<div class="callout callout-warning question-withheld" role="note"><strong class="callout-label">Author warning</strong><p>This lesson is withheld because it would show a check question\'s answer or explanation before an attempt. Run <code>workshop validate</code> to find the block.</p></div>';
const WITHHELD_TEXT = "This lesson is withheld because it would show a check question's answer before an attempt. Run `workshop validate` to find the block.";

/**
 * Validation problems for every question block of a document, from the same
 * parse as rendering, with 1-based source lines (for `workshop validate`).
 */
export function questionProblems(source, file, { mdx = false } = {}) {
  if (Buffer.byteLength(String(source ?? "")) > LIMITS.sourceBytes || nestingDepth(String(source ?? "")) > LIMITS.nesting)
    return { count: 0, problems: mayHoldQuestions(source) ? [{ file, line: 1, message: "document is too large or too deeply nested to render, so its check questions are not shown" }] : [] };
  const analysis = analyzeQuestions(source, { mdx });
  const problems = [];
  const { blocks, orphans } = analysis;
  if (blocks.length > QUESTION_LIMITS.perDocument)
    problems.push({ file, line: blocks[QUESTION_LIMITS.perDocument].line, message: `more than ${QUESTION_LIMITS.perDocument} question blocks in one document` });
  const parsed = blocks.map((b) => parseQuestion(b.body));
  const seen = new Map();
  parsed.forEach((p, i) => {
    const b = blocks[i];
    if (b.unclosed) problems.push({ file, line: b.line, message: "question block is not closed" });
    if (!p.ok) for (const message of p.errors) problems.push({ file, line: b.line, message });
    else if (p.question.id) {
      if (seen.has(p.question.id)) problems.push({ file, line: b.line, message: `duplicate question id "${p.question.id}" (first on line ${seen.get(p.question.id)})` });
      else seen.set(p.question.id, b.line);
    }
  });
  for (const o of orphans)
    problems.push({ file, line: o.line, message: "this looks like a question block but is not parsed as one (for example inside raw HTML without a blank line, indented as code, or with a non-breaking space before 'question'), so it would show its answer as text" });
  problems.sort((a, b) => a.line - b.line);
  return { count: blocks.length, problems };
}

// ---------- pipeline ----------
function remarkMeta() {
  // Carry fence meta to hast as data-meta (text only; sanitised as such).
  return (tree) => {
    const visit = (n) => {
      if (n.type === "code") {
        n.data ??= {};
        n.data.hProperties = { ...(n.data.hProperties || {}), dataMeta: n.meta || undefined };
      }
      n.children?.forEach(visit);
    };
    visit(tree);
  };
}
function noIndentedCode() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ disable: { null: ["codeIndented"] } });
}
function nestingDepth(source) {
  let max = 0;
  for (const line of source.split("\n")) {
    const q = line.match(/^[\s>]*/)[0].replace(/\s/g, "").length;
    const indent = line.match(/^ */)[0].length / 2;
    max = Math.max(max, q, indent);
    if (max > LIMITS.nesting) break;
  }
  return max;
}
function fallback(source, reason) {
  // The plain-text fallback never shows a document that may hold check
  // questions (it is used when the document could not be parsed in time).
  const withheld = mayHoldQuestions(source);
  const shown = withheld ? "" : source.slice(0, LIMITS.fallbackChars);
  const note = withheld ? " Its check questions are not shown." : "";
  return {
    html:
      '<div class="callout callout-warning" role="note"><strong class="callout-label">Warning</strong><p>' +
      escapeHtml(reason + note) +
      "</p></div>" +
      (withheld ? "" : '<pre class="plain lesson-source"><code>' + escapeHtml(shown) + (source.length > shown.length ? "\n…" : "") + "</code></pre>"),
    toc: [],
    warnings: [reason],
    questions: [],
    text: withheld ? reason + note : source,
  };
}

function pipeline(ctx, options = {}) {
  const processor = unified().use(remarkParse);
  if (options.mdx) processor.use(noIndentedCode);
  processor
    .use(remarkGfm)
    .use(remarkEmoji, { accessible: false, emoticon: false })
    .use(remarkMeta)
    .use(() => remarkQuestions(ctx))
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "fn-" })
    .use(rehypeRaw)
    .use(() => components(ctx))
    .use(rehypeSanitize, schema)
    .use(() => applyPolicy(ctx));
  // Headings inside a question get no ids or TOC entries.
  if (!options.nested) processor.use(() => headings(ctx));
  return processor.use(() => code(ctx));
}

/**
 * Render a lesson document to sanitised HTML.
 * @param {string} source Markdown/MDX source.
 * @param {{mdx?: boolean, stepId?: string|null, docDir?: string, sandboxOrigin?: string}} options
 *   docDir: the document's directory relative to the course root (posix).
 */
export async function renderLesson(source, options = {}) {
  if (typeof source !== "string") source = String(source ?? "");
  if (Buffer.byteLength(source) > LIMITS.sourceBytes) return fallback(source, "This lesson is larger than 256 KB and is shown as plain text.");
  if (nestingDepth(source) > LIMITS.nesting) return fallback(source, "This lesson is nested too deeply to render and is shown as plain text.");
  const ctx = {
    stepId: options.stepId ?? null,
    docDir: options.docDir ?? "",
    docPath: options.docPath ?? "",
    sandboxOrigin: options.sandboxOrigin ?? "",
    mdx: Boolean(options.mdx),
    warnings: [],
    toc: [],
    questions: [],
  };
  try {
    const analysis = analyzeQuestions(source, { mdx: options.mdx });
    const nonce = randomBytes(12).toString("hex");
    ctx.questionTokenPrefix = "icode-question-" + nonce + "-";
    ctx.questionToken = new RegExp("^icode-question-" + nonce + "-(\\d+)$");
    const processor = pipeline(ctx, options).use(rehypeStringify);
    let html = String(await processor.process(analysis.text));
    // The plain-text copy (API content, tutor, MCP): question blocks removed by node.
    let text = stripAnalysed(analysis);
    for (const o of analysis.orphans) ctx.warnings.push("Text that looks like a check question is not parsed as one (line " + o.line + ")");
    if (ctx.questionBodies.length !== analysis.blocks.length) throw new Error("check question parse mismatch");
    const fingerprints = questionFingerprints(analysis, text);
    if (leaksAnswers(html, fingerprints, { html: true })) {
      html = WITHHELD_HTML;
      ctx.toc = [];
      ctx.questions = [];
      ctx.warnings.push("Lesson withheld: it would show a check question's answer");
      console.warn("Author warning: " + (options.docPath || "lesson") + " withheld: its HTML would show a check question's answer; run workshop validate.");
    }
    if (leaksAnswers(text, fingerprints)) {
      text = WITHHELD_TEXT;
      ctx.warnings.push("Lesson text withheld: it would show a check question's answer");
      console.warn("Author warning: " + (options.docPath || "lesson") + " plain text withheld: it would show a check question's answer; run workshop validate.");
    }
    // `questions` holds answers: server-side only, never sent with a lesson.
    return { html, toc: ctx.toc, warnings: [...new Set(ctx.warnings)].slice(0, 50), questions: ctx.questions, text };
  } catch (error) {
    return fallback(source, "This lesson could not be rendered (" + String(error.message).slice(0, 200) + ") and is shown as plain text.");
  }
}

// ---------- off-thread rendering with a hard time limit ----------
let worker = null;
let current = null;
const queue = [];
let nextId = 0;
function pump() {
  if (current || !queue.length) return;
  current = queue.shift();
  worker ??= spawnWorker();
  current.timer = setTimeout(() => {
    const job = current;
    current = null;
    worker?.terminate().catch(() => {});
    worker = null;
    job.resolve(fallback(job.source, "This lesson took too long to render and is shown as plain text."));
    pump();
  }, jobTimeout(current));
  worker.postMessage({ id: current.id, source: current.source, options: current.options });
}
const jobTimeout = (job) => job.timeoutMs ?? LIMITS.renderMs;
function spawnWorker() {
  const w = new Worker(new URL("./markdown-worker.mjs", import.meta.url));
  w.on("message", ({ id, result, error }) => {
    if (!current || current.id !== id) return;
    clearTimeout(current.timer);
    const job = current;
    current = null;
    job.resolve(result ?? fallback(job.source, "This lesson could not be rendered (" + String(error).slice(0, 200) + ") and is shown as plain text."));
    pump();
  });
  w.on("error", () => {
    if (worker === w) worker = null;
    if (current) {
      clearTimeout(current.timer);
      const job = current;
      current = null;
      job.resolve(fallback(job.source, "This lesson could not be rendered and is shown as plain text."));
    }
    pump();
  });
  // After the listeners: an idle worker never keeps the process alive.
  w.unref();
  return w;
}
/**
 * renderLesson in a worker thread with a hard time limit: a pathological
 * lesson is cut off (and shown as escaped text) instead of blocking the API.
 */
export function renderSafe(source, options = {}, { timeoutMs } = {}) {
  if (typeof source !== "string") source = String(source ?? "");
  if (Buffer.byteLength(source) > LIMITS.sourceBytes) return Promise.resolve(fallback(source, "This lesson is larger than 256 KB and is shown as plain text."));
  return new Promise((resolve) => {
    queue.push({ id: ++nextId, source, options, resolve, timeoutMs });
    pump();
  });
}

// In-memory LRU keyed by the caller (root + path + mtime + size + context).
const cache = new Map();
export const CACHE_LIMIT = 200;
export const cacheSize = () => cache.size;
export async function renderCached(key, source, options) {
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = await renderSafe(source, options);
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
}
export { escapeHtml };
