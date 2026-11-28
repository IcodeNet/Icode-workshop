// Sandbox origin (Stage 3): serves simple and export apps, in-browser tests,
// the Mermaid renderer and lesson images on a separate port, so course
// content never runs on the UI or API origin. Read-only. See
// docs/stage3-content.md#origins.
import { createServer } from "node:http";
import { readFile, stat, lstat, realpath } from "node:fs/promises";
import { join, resolve, relative, extname, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { validateId } from "../core/index.mjs";
import { variantRoot, assertSafePath } from "./files.mjs";
import { appInfo } from "./content-config.mjs";
import { labConfig } from "./runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const engineRoot = resolve(here, "..", "..");
const RUNTIME = join(here, "browser-test-runtime.mjs");
const TEST_MODULES = /^(@epic-web\/workshop-utils\/test|@icodenet\/workshop-test)$/;
const SCRIPT_EXT = new Set([".js", ".mjs", ".jsx", ".ts", ".tsx", ".cjs"]);
const MAX_BUNDLE = 10 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 20000;
export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
};
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico"]);

export function appCsp(uiOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors " + uiOrigin,
  ].join("; ");
}
export function mermaidCsp(uiOrigin) {
  return "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors " + uiOrigin;
}
const ASSET_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

function inside(base, path) {
  const rel = relative(base, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
}
/** Path segments from a URL: decoded, validated, never `..` or hidden. */
export function urlSegments(pathname) {
  const parts = pathname.split("/").filter((p, i, all) => p !== "" || i === all.length - 1);
  const out = [];
  for (const raw of parts) {
    let p;
    try {
      p = decodeURIComponent(raw);
    } catch {
      throw httpError(400, "Bad path encoding");
    }
    if (p === "") continue;
    if (p === "." || p === ".." || p.startsWith(".") || /[\\/\u0000-\u001f:*?"<>|]/.test(p)) throw httpError(400, "Invalid path");
    out.push(p);
  }
  return out;
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- esbuild bundling with a course-root guard ----------
const bundles = new Map(); // key -> {inputs: [[path, mtime]], code}
let esbuildPromise;
const esbuild = () => (esbuildPromise ??= import("esbuild"));
async function realOrSelf(p) {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}
/** esbuild plugin: aliases the test runtime; refuses files outside allowed roots. */
export function guardPlugin(allowedRoots) {
  return {
    name: "icode-guard",
    setup(build) {
      build.onResolve({ filter: TEST_MODULES }, () => ({ path: RUNTIME }));
      build.onLoad({ filter: /.*/ }, async (args) => {
        if (args.namespace !== "file") return undefined;
        const real = await realOrSelf(args.path);
        const ok = allowedRoots.some(({ base, engine }) => {
          if (!inside(base, real)) return false;
          if (engine) return true;
          // Hidden segments only inside node_modules or the learner's playgrounds.
          const segs = relative(base, real).split(sep);
          for (let i = 0; i < segs.length; i++) {
            if (!segs[i].startsWith(".")) continue;
            if (segs.slice(0, i).includes("node_modules")) continue;
            if (i === 0 && segs[0] === ".workshop" && segs[1] === "playgrounds") continue;
            return false;
          }
          return true;
        });
        if (!ok) return { errors: [{ text: "Refused to bundle a file outside the course: " + args.path }] };
        return undefined;
      });
    },
  };
}
async function allowedRoots(root) {
  return [
    { base: await realOrSelf(root) },
    { base: await realOrSelf(here), engine: true },
    { base: await realOrSelf(join(engineRoot, "node_modules")), engine: true },
  ];
}
async function fresh(entry) {
  const hit = bundles.get(entry);
  if (!hit) return null;
  for (const [path, mtime] of hit.inputs) {
    try {
      if ((await stat(path)).mtimeMs !== mtime) return null;
    } catch {
      return null;
    }
  }
  return hit.code;
}
/**
 * Bundle a course module (or stdin source) for the browser. Never executes
 * course code; refuses inputs outside the course root.
 */
export async function bundle(root, { entry, stdin, resolveDir, cacheKey }) {
  const key = cacheKey ?? entry;
  const cached = await fresh(key);
  if (cached !== null) return cached;
  const { build } = await esbuild();
  const options = {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: "inline",
    jsx: "automatic",
    logLevel: "silent",
    metafile: true,
    absWorkingDir: resolveDir,
    nodePaths: [join(engineRoot, "node_modules")],
    plugins: [guardPlugin(await allowedRoots(root))],
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".gif": "dataurl", ".css": "css" },
    ...(stdin ? { stdin: { contents: stdin, resolveDir, sourcefile: "icode-entry.js", loader: "js" } } : { entryPoints: [entry] }),
  };
  let timer;
  const result = await Promise.race([
    build(options),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Bundling timed out")), BUILD_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const js = result.outputFiles.find((f) => f.path.endsWith(".js")) ?? result.outputFiles[0];
  const css = result.outputFiles.find((f) => f.path.endsWith(".css"));
  let code = js?.text ?? "";
  if (css) code = `{const s=document.createElement("style");s.textContent=${JSON.stringify(css.text)};document.head.append(s);}\n` + code;
  if (Buffer.byteLength(code) > MAX_BUNDLE) throw new Error("Bundle larger than 10 MB");
  const inputs = [];
  for (const input of Object.keys(result.metafile.inputs)) {
    const abs = resolve(resolveDir, input);
    try {
      inputs.push([abs, (await stat(abs)).mtimeMs]);
    } catch {}
  }
  bundles.set(key, { inputs, code });
  if (bundles.size > 100) bundles.delete(bundles.keys().next().value);
  return code;
}
const scriptError = (message) => `console.error(${JSON.stringify(message)});\nthrow new Error(${JSON.stringify(message)});\n`;

// ---------- pages ----------
const escapeAttr = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
function injectHead(html, tags) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tags);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + "<head>" + tags + "</head>");
  return tags + html;
}
function injectBody(html, tags) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, tags + "</body>") : html + tags;
}
function generatedPage(title, entry) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeAttr(title)}</title></head><body><div id="root"></div>${entry ? `<script type="module" src="${escapeAttr(entry)}"></script>` : "<p>This app has no index.html or index file.</p>"}</body></html>`;
}
function exportPage(entryUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Export app</title><link rel="stylesheet" href="/__icode/export.css"></head><body><main data-entry="${escapeAttr(entryUrl)}"><section aria-label="Console output"><h2>Console output</h2><ol id="console"></ol></section><section aria-label="Exports"><h2>Exports</h2><div id="exports"><p>Loading…</p></div></section></main><script type="module" src="/__icode/export.js"></script></body></html>`;
}
// Served Mermaid files: the ESM entry and its chunks; no source maps, no elk.
const MERMAID_FILE = /^\/__icode\/mermaid\/(mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[A-Za-z0-9_-]+\.mjs)$/;
const MERMAID_DIST = () => dirname(require.resolve("mermaid/package.json")) + "/dist";
export async function mermaidFile(rel) {
  if (/elk/i.test(rel) || !/^(mermaid\.esm\.min\.mjs|chunks\/mermaid\.esm\.min\/[A-Za-z0-9_-]+\.mjs)$/.test(rel)) return null;
  try {
    return await readFile(join(MERMAID_DIST(), ...rel.split("/")));
  } catch {
    return null;
  }
}
const MERMAID_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Diagram</title><style>html,body{margin:0;background:transparent;overflow:hidden}#d{display:flex;justify-content:center}#d svg{max-width:100%;height:auto}#e{font:13px system-ui;color:#b42318;white-space:pre-wrap}</style></head><body><div id="d"></div><div id="e"></div><script type="module" src="/__icode/mermaid-frame.js"></script></body></html>`;

/** @returns {import('node:http').Server} */
export function createSandboxServer({ root, port, uiOrigin = "http://127.0.0.1:5173" }) {
  const hosts = ["127.0.0.1:" + port, "localhost:" + port];
  const clientFile = async (name) => (await readFile(join(here, "sandbox-client", name), "utf8")).replaceAll("%ICODE_UI_ORIGIN%", JSON.stringify(uiOrigin).slice(1, -1));
  const base = (res, status, type, body, extra = {}) => {
    res.writeHead(status, {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-site",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      "content-security-policy": appCsp(uiOrigin),
      ...extra,
    });
    res.end(body);
  };
  const text = (res, status, message) => base(res, status, "text/plain; charset=utf-8", message);
  const html = (res, body, csp) => base(res, 200, "text/html; charset=utf-8", body, csp ? { "content-security-policy": csp } : {});
  const nav = '<script src="/__icode/nav.js"></script>';

  async function variantDir(id, variant) {
    validateId(id);
    const dir = variantRoot(root, id, variant);
    try {
      if (!(await lstat(dir)).isDirectory()) throw new Error();
    } catch {
      throw httpError(404, variant === "playground" ? "Playground not created yet: open the step first" : "Not found");
    }
    return assertSafePath(dir);
  }
  async function info(id, variant) {
    const lab = await labConfig(root, id);
    const app = await appInfo(root, id, variant, { lab });
    if (!app.type) throw httpError(404, "This step has no workshop-served app");
    return app;
  }
  async function serveApp(req, res, id, variant, segments, url) {
    const app = await info(id, variant);
    const dir = await variantDir(id, variant);
    const testFile = url.searchParams.get("__icode_test");
    let target = segments.length ? join(dir, ...segments) : dir;
    if (!inside(dir, target)) throw httpError(400, "Invalid path");
    target = await assertSafePath(target);
    let st = null;
    try {
      st = await stat(target);
    } catch {}
    const prefix = `/app/${id}/${variant}/`;
    if (!st || st.isDirectory()) {
      const index = join(st ? target : dir, "index.html");
      const isRoute = !st && !extname(segments.at(-1) ?? "");
      if (!st && !isRoute) throw httpError(404, "Not found");
      let page;
      try {
        page = await readFile(await assertSafePath(index), "utf8");
      } catch {
        if (st && target !== dir) throw httpError(404, "Not found");
        page = generatedPage("App " + id, app.entry ? prefix + app.entry : null);
      }
      if (app.type === "export" && !testFile) return html(res, exportPage(prefix + (app.entry ?? "index.js")), appCsp(uiOrigin));
      page = injectHead(page, nav + (page.includes("<base") ? "" : `<base href="${escapeAttr(prefix)}">`));
      if (testFile) {
        if (!app.browserTests.includes(testFile)) throw httpError(404, "Unknown browser test");
        page = injectBody(page, `<script type="module" src="/__icode/test-bundle/${id}/${variant}/${testFile.split("/").map(encodeURIComponent).join("/")}"></script>`);
      }
      return html(res, page);
    }
    if (st.size > MAX_FILE) throw httpError(413, "File too large");
    const ext = extname(target).toLowerCase();
    if (SCRIPT_EXT.has(ext)) {
      try {
        const code = await bundle(root, { entry: target, resolveDir: dir });
        return base(res, 200, MIME[".js"], code);
      } catch (error) {
        return base(res, 200, MIME[".js"], scriptError("Build failed: " + error.message.slice(0, 2000)));
      }
    }
    const body = await readFile(target);
    if (ext === ".html" || ext === ".htm") return html(res, injectHead(body.toString("utf8"), nav));
    return base(res, 200, MIME[ext] ?? "application/octet-stream", body, ext === ".svg" ? { "content-security-policy": ASSET_CSP } : {});
  }
  async function serveTestBundle(res, id, variant, segments) {
    const app = await info(id, variant);
    const file = segments.join("/");
    if (!app.browserTests.includes(file)) throw httpError(404, "Unknown browser test");
    const dir = await variantDir(id, variant);
    const abs = await assertSafePath(join(dir, ...segments));
    const stdin = `import { __start, __done, __fail } from ${JSON.stringify(RUNTIME)};\n__start(${JSON.stringify(file)});\nimport(${JSON.stringify("./" + file)}).then(__done, __fail);\n`;
    try {
      const code = await bundle(root, { stdin, resolveDir: dir, cacheKey: "test:" + abs });
      return base(res, 200, MIME[".js"], code);
    } catch (error) {
      return base(res, 200, MIME[".js"], `window.parent.postMessage({type:"icode:test",event:"error",file:${JSON.stringify(file)},message:${JSON.stringify("Build failed: " + error.message.slice(0, 2000))}}, ${JSON.stringify(uiOrigin)});`);
    }
  }
  async function serveAsset(res, segments) {
    const ext = extname(segments.at(-1) ?? "").toLowerCase();
    if (!IMAGE.has(ext)) throw httpError(404, "Not an image");
    const target = await assertSafePath(join(root, ...segments));
    if (!inside(resolve(root), target)) throw httpError(400, "Invalid path");
    const st = await stat(target).catch(() => null);
    if (!st?.isFile()) throw httpError(404, "Not found");
    if (st.size > MAX_FILE) throw httpError(413, "File too large");
    return base(res, 200, MIME[ext], await readFile(target), { "content-security-policy": ASSET_CSP, "cross-origin-resource-policy": "same-site" });
  }

  const server = createServer(async (req, res) => {
    try {
      if (!hosts.includes(req.headers.host)) return text(res, 403, "Host denied");
      const site = req.headers["sec-fetch-site"];
      // Static engine scripts (no course content) are fetched by the
      // opaque-origin Mermaid frame, whose requests are "cross-site".
      const engineAsset = req.url === "/__icode/mermaid-frame.js" || MERMAID_FILE.test(req.url);
      if (site && !["same-origin", "same-site", "none"].includes(site) && !engineAsset) return text(res, 403, "Cross-site request denied");
      if (!["GET", "HEAD"].includes(req.method)) return text(res, 405, "Read-only");
      const url = new URL(req.url, "http://sandbox.invalid");
      const segments = urlSegments(url.pathname);
      const [area, ...rest] = segments;
      if (area === "__icode") {
        const [name, ...more] = rest;
        // Engine assets (no course content): loadable by the opaque-origin Mermaid frame.
        const shared = { "cross-origin-resource-policy": "cross-origin" };
        if (name === "nav.js" || name === "export.js") return base(res, 200, MIME[".js"], await clientFile(name), shared);
        if (name === "mermaid-frame.js") return base(res, 200, MIME[".js"], await clientFile(name), { ...shared, "access-control-allow-origin": "*" });
        if (name === "export.css") return base(res, 200, MIME[".css"], await clientFile(name), shared);
        if (name === "mermaid.html") return html(res, MERMAID_PAGE, mermaidCsp(uiOrigin));
        if (name === "mermaid" && MERMAID_FILE.test(req.url)) {
          // Mermaid's ESM build, never its elk layout chunk (EPL-2.0/GPL):
          // elk diagrams fail into the source fallback.
          const file = await mermaidFile(more.join("/"));
          if (!file) return text(res, 404, "Not found");
          return base(res, 200, MIME[".js"], file, { ...shared, "access-control-allow-origin": "*", "cache-control": "max-age=3600" });
        }
        if (name === "test-bundle" && more.length >= 3) return await serveTestBundle(res, more[0], more[1], more.slice(2));
        return text(res, 404, "Not found");
      }
      if (area === "app" && rest.length >= 2) return await serveApp(req, res, rest[0], rest[1], rest.slice(2), url);
      if (area === "export" && rest.length >= 2) {
        const app = await info(rest[0], rest[1]);
        await variantDir(rest[0], rest[1]);
        return html(res, exportPage(`/app/${rest[0]}/${rest[1]}/` + (app.entry ?? "index.js")));
      }
      if (area === "asset" && rest.length) return await serveAsset(res, rest);
      return text(res, 404, "Not found");
    } catch (error) {
      const status = error.status ?? (/Exercise ID|Invalid variant|Unknown exercise|Symlinks|Invalid/.test(error.message) ? 400 : 500);
      if (!res.headersSent) text(res, status, error.message);
      else res.end();
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}
