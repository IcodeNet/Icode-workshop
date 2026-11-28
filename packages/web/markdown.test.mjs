// Lesson pipeline, components, URL policy and hostile input.
import test from "node:test";
import assert from "node:assert/strict";
import { renderLesson, renderSafe, renderCached, policy, parseMeta, preprocess, LIMITS, CACHE_LIMIT, cacheSize } from "./markdown.mjs";
import { renderDocument } from "./lessons.mjs";
import { nativeCourse } from "./test-support/workspace-course.mjs";
import { APPS_VIDEO_TAG } from "../core/apps-layout.mjs";
import { writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";

const SANDBOX = "http://127.0.0.1:4318";
const render = (source, options = {}) => renderLesson(source, { mdx: true, stepId: "01", docDir: "exercises/01", sandboxOrigin: SANDBOX, ...options });
// Every tag and attribute name in the output, for allowlist assertions.
const tags = (html) => [...html.matchAll(/<([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
const attrs = (html) => [...html.matchAll(/<[a-z][a-z0-9-]*((?:\s+[a-zA-Z_:][\w:.-]*(?:="[^"]*"|='[^']*'|=[^\s>]+)?)*)\s*\/?>/g)].flatMap((m) => [...m[1].matchAll(/\s+([a-zA-Z_:][\w:.-]*)(?:="[^"]*"|='[^']*'|=[^\s>]+)?/g)].map((a) => a[1].toLowerCase()));
const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "class", "id", "role", "aria-label", "data-source", "data-lang", "data-meta", "data-blocked-url", "target", "rel", "loading", "referrerpolicy", "style", "tabindex", "type", "disabled", "checked", "open", "colspan", "rowspan", "align", "start", "width", "height", "lang", "dir", "scope", "data-footnote-ref", "data-footnote-backref", "data-footnotes", "aria-describedby", "headers", "abbr", "datetime"]);

test("lesson components, GFM alerts, headings, TOC and Shiki with titles and line highlights", async () => {
  const { html, toc, warnings } = await render(`import { X } from './x.js'
export const meta = {}

# Lesson

<callout-warning>
  Be **careful**.
</callout-warning>

<callout-unknown>odd</callout-unknown>

> [!TIP]
> Use the *force*

Open <InlineFile file="src/app.js" /> or <InlineFile file="src/b.js">the helper</InlineFile>.

<LinkToApp to="/about">About</LinkToApp> <DiffLink>step diff</DiffLink> <DiffLink app1="01.problem" app2="02.solution">custom</DiffLink> <NextDiffLink /> <PrevDiffLink>prev</PrevDiffLink>

<${APPS_VIDEO_TAG} url="https://videos.example.org/x" />

## Part {' '}one

## Part one

### Deeper

\`\`\`ts filename=app.ts {2,4-5}
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
\`\`\`

\`\`\`notalanguage
plain <b>text</b>
\`\`\`
`);
  assert.doesNotMatch(html, /import \{ X \}|export const meta/);
  assert.match(html, /<div class="callout callout-warning" role="note"><strong class="callout-label">Warning<\/strong>\s*<p>Be <strong>careful<\/strong>\.<\/p>/);
  assert.match(html, /callout callout-info/, "unknown callout kinds fall back to info");
  assert.match(html, /callout callout-tip[\s\S]*Use the <em>force<\/em>/);
  assert.match(html, /<a href="#file=src%2Fapp\.js" class="engine-link inline-file"><code>src\/app\.js<\/code><\/a> or <a href="#file=src%2Fb\.js"[^>]*>the helper<\/a>/);
  assert.match(html, /<a href="#app=%2Fabout" class="engine-link">About<\/a>/);
  assert.match(html, /href="#diff=step"[^>]*>step diff/);
  assert.match(html, /href="#diff=01\.problem\.\.02\.solution"[^>]*>custom/);
  assert.match(html, /href="#diff=next"/);
  assert.match(html, /href="#diff=prev"[^>]*>prev/);
  assert.match(html, /<p class="video-card"><a href="https:\/\/videos\.example\.org\/x" class="video-link" target="_blank" rel="noopener noreferrer nofollow">▶ Watch the video<\/a><\/p>/);
  assert.deepEqual(toc, [
    { depth: 2, text: "Part one", id: "h-part-one" },
    { depth: 2, text: "Part one", id: "h-part-one-2" },
    { depth: 3, text: "Deeper", id: "h-deeper" },
  ]);
  assert.match(html, /<div class="code-title">app\.ts<\/div><pre class="shiki/);
  assert.equal((html.match(/class="line highlighted"/g) || []).length, 3);
  assert.match(html, /--shiki-light:[^;]+;--shiki-dark:/);
  assert.match(html, /plain &#x3C;b>text&#x3C;\/b>|plain &lt;b&gt;text&lt;\/b&gt;/);
  assert.deepEqual(warnings, []);
});

test("diff links on course pages are inactive text", async () => {
  const { html } = await render("<DiffLink>See diff</DiffLink> <NextDiffLink />", { stepId: null });
  assert.match(html, /<span class="diff-link-inactive" title="[^"]+">See diff<\/span>/);
  assert.doesNotMatch(html, /#diff=/);
});

test("Mermaid fences become sandbox placeholders with escaped source; oversized diagrams are not rendered", async () => {
  const { html } = await render('```mermaid\ngraph TD\n  A["<img src=x onerror=alert(1)>"] --> B\n```');
  assert.match(html, /<figure class="mermaid-diagram" data-source="graph TD\n {2}A\[&#x22;<img src=x onerror=alert\(1\)>&#x22;\] --> B">/);
  assert.match(html, /<pre class="mermaid-source"><code>graph TD\n {2}A\["&#x3C;img/);
  assert.doesNotMatch(html.replace(/data-source="[^"]*"/, ""), /<img/);
  const big = await render("```mermaid\n" + "A-->B\n".repeat(LIMITS.mermaidBytes / 5) + "```");
  assert.match(big.html, /mermaid-too-large/);
  assert.doesNotMatch(big.html, /data-source/);
});

test("XSS through lesson markdown is removed: scripts, handlers, javascript: links, SVG, iframes, forms, styles", async () => {
  const hostile = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<img src=\"pic.png\" onload=\"alert(1)\">",
    "[js](javascript:alert(1))",
    "[JS](JaVaScRiPt:alert(1))",
    "<a href=\"jav&#x09;ascript:alert(1)\">tab</a>",
    "<a href=\"&#106;avascript:alert(1)\">entity</a>",
    "<a href=\" javascript:alert(1)\">space</a>",
    "<a href=\"vbscript:msgbox(1)\">vb</a>",
    "<a href=\"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==\">data</a>",
    "<svg onload=alert(1)><script>alert(1)</script></svg>",
    "<svg><a xlink:href=\"javascript:alert(1)\"><text>x</text></a></svg>",
    "<iframe src=\"https://evil.test\" srcdoc=\"<script>alert(1)</script>\"></iframe>",
    "<object data=\"x.swf\"></object><embed src=\"x.swf\">",
    "<form action=\"https://evil.test\"><input name=q><button formaction=\"javascript:alert(1)\">go</button></form>",
    "<p style=\"background:url(javascript:alert(1))\" onclick=\"alert(1)\" onmouseover=\"alert(1)\">p</p>",
    "<details open ontoggle=alert(1)><summary>s</summary>d</details>",
    "<base href=\"https://evil.test/\"><meta http-equiv=\"refresh\" content=\"0;url=javascript:alert(1)\"><link rel=stylesheet href=x>",
    "<div id=\"root\" name=\"x\" class=\"app\">clobber</div>",
    "<template><script>alert(1)</script></template><noscript><img src=x onerror=alert(1)></noscript>",
    "<!-- <script>alert(1)</script> -->",
    "<a href=\"https://ok.test\" target=\"_top\" onclick=\"alert(1)\">ok</a>",
    "<video src=x onerror=alert(1)></video><audio src=x></audio>",
    "<img src=\"https://ok.test/a.png\" srcset=\"javascript:alert(1) 1x\">",
    "<input type=\"text\" autofocus onfocus=\"alert(1)\">",
    "<a href=\"//evil.test\">proto-relative</a><a href=\"/api/progress\">abs</a><a href=\"\\\\evil\">bs</a>",
    "<select><option>x</option></select><textarea>t</textarea><button>b</button>",
    "<isindex action=javascript:alert(1) type=image>",
    "<xmp><script>alert(1)</script></xmp>",
    // Last: a raw-text element swallows what follows (content lost, nothing executable).
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  ].join("\n\n");
  const { html } = await render(hostile);
  for (const tag of tags(html)) assert.ok(!["script", "svg", "math", "iframe", "object", "embed", "form", "style", "base", "meta", "link", "template", "noscript", "video", "audio", "textarea", "select", "button", "isindex", "xmp"].includes(tag), "tag survived: " + tag + "\n" + html);
  for (const a of attrs(html)) assert.ok(ALLOWED_ATTRS.has(a), "attribute survived: " + a);
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.doesNotMatch(html, /(href|src)="\s*(javascript|vbscript|data):/i);
  assert.doesNotMatch(html, /href="\/\/|href="\/api|srcset/);
  assert.doesNotMatch(html, /id="root"|name="x"|class="app"/);
  assert.doesNotMatch(html, /style="background/);
  assert.match(html, /<a href="https:\/\/ok\.test\/" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  // Inputs survive only as disabled checkboxes (GFM task lists).
  for (const input of html.match(/<input[^>]*>/g) ?? []) assert.match(input, /type="checkbox"/), assert.match(input, /disabled/);
});

test("URL policy: https, fragments and course-relative paths only", () => {
  const ctx = { docDir: "exercises/01", sandboxOrigin: SANDBOX };
  assert.deepEqual(policy("https://example.com/a?b#c", ctx), { href: "https://example.com/a?b#c", external: true });
  assert.deepEqual(policy("#file=x", ctx), { href: "#file=x" });
  assert.deepEqual(policy("../02/README.md", ctx), { href: "#course=exercises%2F02%2FREADME.md" });
  assert.deepEqual(policy("./problem/index.mjs#L3", ctx), { href: "#course=exercises%2F01%2Fproblem%2Findex.mjs" });
  assert.deepEqual(policy("img/a.png", { ...ctx, kind: "image" }), { href: SANDBOX + "/asset/exercises/01/img/a.png" });
  assert.deepEqual(policy("my%20pic.png", { ...ctx, kind: "image" }), { href: SANDBOX + "/asset/exercises/01/my%20pic.png" });
  for (const bad of ["http://example.com", "javascript:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "JAVASCRIPT:x", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "//evil.test", "/etc/passwd", "\\\\evil\\share", "C:/Windows", "../../../etc/passwd", "%2e%2e/%2e%2e/%2e%2e/etc/passwd", "..%2f..%2f..%2fetc", "a/%00b", "%E0%A4%A", "https://user:pw@example.com/", "mailto:a@b.c", ".git/config", "../../.workshop/progress.json", ""])
    assert.ok(policy(bad, ctx).blocked, "allowed: " + bad);
  assert.deepEqual(policy("http://localhost:3000/a", ctx), { href: "http://localhost:3000/a", external: true });
  assert.deepEqual(policy("http://127.0.0.1:8080", ctx), { href: "http://127.0.0.1:8080/", external: true });
  assert.ok(policy("http://localhost:3000/a.png", { ...ctx, kind: "image" }).blocked, "loopback http is for links only");
  assert.ok(policy("http://localhost.evil.test/", ctx).blocked);
  assert.ok(policy("http://u:p@localhost/", ctx).blocked);
  assert.ok(policy("#x", { ...ctx, kind: "image" }).blocked);
  assert.ok(policy("notes.txt", { ...ctx, kind: "image" }).blocked, "only image types are served");
  assert.ok(policy("pic.png", { docDir: "", kind: "image" }).blocked, "no sandbox origin, no image");
});

test("blocked links keep their text and say why; images become labelled text", async () => {
  const { html, warnings } = await render("[escape](../../../../etc/passwd) ![logo](javascript:alert(1)) ![ok](./ok.png)");
  assert.match(html, /<a data-blocked-url="outside course" title="Blocked by the workshop URL policy">escape<\/a>/);
  assert.match(html, /<span data-blocked-url="scheme" title="Blocked by the workshop URL policy">\[image: logo\]<\/span>/);
  assert.match(html, /<img src="http:\/\/127\.0\.0\.1:4318\/asset\/exercises\/01\/ok\.png" alt="ok" loading="lazy" referrerpolicy="no-referrer">/);
  assert.ok(warnings.some((w) => w.includes("outside course")));
});

test("huge, deeply nested and malformed lessons fall back to escaped text within budget", async () => {
  const cases = [
    ["x".repeat(LIMITS.sourceBytes + 1), /larger than 256 KB/],
    ["> ".repeat(LIMITS.nesting + 5) + "deep", /nested too deeply/],
    ["<div>".repeat(40000) + "<script>alert(1)</script>", /could not be rendered|nested too deeply/],
  ];
  for (const [source, reason] of cases) {
    const started = Date.now();
    const { html, warnings } = await render(source);
    assert.ok(Date.now() - started < 5000, "rendered within budget");
    assert.match(warnings[0], reason);
    assert.match(html, /^<div class="callout callout-warning"/);
    assert.doesNotMatch(html, /<script|<div><div>/);
    assert.ok(html.length < LIMITS.fallbackChars * 6 + 1000);
  }
  for (const source of ["<details><summary>x\n\n<callout-info>\n\n```js\nunterminated", "[".repeat(50000), "_*".repeat(50000), "<a href='\u0000javascript:alert(1)'>x</a>\u0000", "<<<<>>>>".repeat(5000), "|a|\n|-|\n" + "|<img src=x onerror=alert(1)>|\n".repeat(2000)]) {
    const started = Date.now();
    const { html } = await renderSafe(source, { mdx: true, stepId: "01", docDir: "exercises/01", sandboxOrigin: SANDBOX });
    assert.ok(Date.now() - started < LIMITS.renderMs + 3000, "malformed input within budget");
    assert.doesNotMatch(html, /onerror|<script|javascript:/);
  }
});

test("a pathological lesson is cut off off-thread; rendering keeps working for the next one", async () => {
  const started = Date.now();
  // Quadratic emphasis resolution: tens of seconds if run on the event loop.
  const slow = await renderSafe("_*".repeat(50000), {}, { timeoutMs: 1500 });
  assert.ok(Date.now() - started < 4500, "cut off at the time limit");
  assert.match(slow.warnings[0], /took too long/);
  assert.match(slow.html, /^<div class="callout callout-warning"/);
  // The event loop was free meanwhile, and a new worker renders the next lesson.
  const ok = await renderCached("k|" + Date.now(), "# Fine\n\n```js\nlet a = 1\n```", {});
  assert.match(ok.html, /<h1 id="h-fine">/);
  assert.match(ok.html, /class="shiki/);
});

test("self-closing components cannot swallow the rest of the lesson; code is never rewritten", async () => {
  const { html } = await render('Before <InlineFile file="a.js" /> after.\n\n## Still here\n\n```jsx\n<InlineFile file="b.js" />\n{\' \'}\n```\n\n`<DiffLink />` inline code');
  assert.match(html, /<a href="#file=a\.js"[^>]*><code>a\.js<\/code><\/a> after\./);
  assert.match(html, /<h2 id="h-still-here">/);
  assert.match(html, /InlineFile/); // inside code
  assert.match(html, /<code>&#x3C;DiffLink \/><\/code>|<code>&lt;DiffLink \/&gt;<\/code>/);
  assert.doesNotMatch(preprocess("```\n<X />\n```", { mdx: true }), /<\/X>/);
});

test("fence meta parsing: titles, lines=, braces and bounded ranges", () => {
  assert.deepEqual(parseMeta('title="a b.js" {1,3-4}'), { title: "a b.js", lines: new Set([1, 3, 4]) });
  assert.deepEqual(parseMeta("filename=x.ts lines=2"), { title: "x.ts", lines: new Set([2]) });
  assert.equal(parseMeta("{1-99999999}").lines.size, 5001);
  assert.deepEqual(parseMeta(""), { title: null, lines: new Set() });
});

test("plain .md lessons keep indented code blocks; .mdx disables them like MDX", async () => {
  const md = await renderLesson("Para\n\n    indented code\n", { mdx: false });
  assert.match(md.html, /<pre/);
  const mdx = await renderLesson("<callout-info>\n\n    indented text\n\n</callout-info>", { mdx: true });
  assert.doesNotMatch(mdx.html, /<pre/);
  assert.match(mdx.html, /indented text/);
});

test("code-block titles and languages from fence meta are text, never HTML", async () => {
  const { html } = await render('```js title="<img src=x onerror=alert(1)>" {1}\nlet a\n```\n\n```js filename=<script>alert(1)</script>\nlet b\n```\n\n```"><img/src/onerror=alert(1)>\nlet c\n```');
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /<div class="code-title">&#x3C;img src=x onerror=alert\(1\)><\/div>|<div class="code-title">&lt;img src=x onerror=alert\(1\)&gt;<\/div>/);
  assert.match(html, /<div class="code-title">&#x3C;script>alert\(1\)&#x3C;\/script><\/div>|<div class="code-title">&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/div>/);
});

test("author id and name attributes never survive (no DOM clobbering); only engine h-/fn- ids", async () => {
  const { html } = await render('<h2 id="root">T</h2>\n\n<a name="api" id="fetch" href="https://x.test">a</a> <img name="cookie" id="location" src="https://x.test/a.png"> <p id="h-fake">p</p> <span id="fn-x">s</span>\n\nFoot[^1]\n\n[^1]: note');
  const ids = [...html.matchAll(/\s(id|name)="([^"]*)"/g)].map((m) => m[1] + "=" + m[2]);
  for (const id of ids) assert.match(id, /^id=(h-|fn-)/, id);
  assert.doesNotMatch(html, /name=|id="root"|id="fetch"|id="location"|id="h-fake"|id="fn-x"/);
  assert.match(html, /<h2 id="h-t">/);
});

test("rendering is off the event loop: the loop keeps ticking during a pathological render", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  try {
    const result = await renderSafe("_*".repeat(50000), {}, { timeoutMs: 1500 });
    assert.match(result.warnings[0], /took too long/);
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks >= 30, "event loop ran " + ticks + " ticks while rendering");
});

test("the document cache is keyed by course root, mtime, size and step, and bounded", async () => {
  const a = await nativeCourse({ files: { "exercises/01/README.md": "# One\n\n<DiffLink>d</DiffLink>\n" } });
  const b = await nativeCourse({ files: { "exercises/01/README.md": "# Two\n\n<DiffLink>d</DiffLink>\n" } });
  const file = (root) => join(root, "exercises", "01", "README.md");
  const t = new Date("2026-01-01T00:00:00Z");
  await utimes(file(a), t, t);
  await utimes(file(b), t, t);
  assert.match((await renderDocument(a, file(a), { stepId: "01" })).html, /One/);
  assert.match((await renderDocument(b, file(b), { stepId: "01" })).html, /Two/, "another course with the same path, mtime and size");
  assert.match((await renderDocument(a, file(a), { stepId: "01" })).html, /#diff=step/);
  assert.match((await renderDocument(a, file(a), { stepId: null })).html, /diff-link-inactive/, "step context is part of the key");
  await writeFile(file(a), "# Changed\n");
  const later = new Date("2026-01-02T00:00:00Z");
  await utimes(file(a), later, later);
  assert.match((await renderDocument(a, file(a), { stepId: "01" })).html, /Changed/, "mtime is part of the key");
  for (let i = 0; i < CACHE_LIMIT + 20; i++) await renderCached("bound|" + i, "x" + i, {});
  assert.ok(cacheSize() <= CACHE_LIMIT, "cache bounded: " + cacheSize());
});

test("emoji shortcodes become emoji outside code", async () => {
  const { html } = await render("Done :tada: :rocket: and `:tada:` in code\n\n```\n:tada:\n```");
  assert.match(html, /Done 🎉 🚀/);
  assert.match(html, /<code>:tada:<\/code>/);
});

test("lesson documents (renderDocument/renderCached) render off the event loop with the time limit", async () => {
  const root = await nativeCourse({ files: { "exercises/01/README.md": "_*".repeat(50000) } });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  const started = Date.now();
  let doc;
  try {
    doc = await renderDocument(root, join(root, "exercises", "01", "README.md"), { stepId: "01" });
  } finally {
    clearInterval(timer);
  }
  const elapsed = Date.now() - started;
  assert.ok(elapsed < LIMITS.renderMs + 3000, "cut off at the limit: " + elapsed);
  assert.match(doc.warnings[0], /took too long/);
  assert.ok(ticks >= (elapsed / 20) * 0.5, `event loop kept running: ${ticks} ticks in ${elapsed} ms`);
});
