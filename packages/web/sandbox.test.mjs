// Stage 3: the sandbox origin (apps, export apps, browser tests, Mermaid,
// images). Read-only, path-safe, refuses foreign hosts and cross-site use,
// never bundles files outside the course.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { createSandboxServer, urlSegments, mermaidFile } from "./sandbox.mjs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { nativeCourse } from "./test-support/workspace-course.mjs";
import { selectWorkspace } from "./workspaces.mjs";

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
function get(port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "127.0.0.1:" + port, ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}
async function setup() {
  const root = await nativeCourse({
    files: {
      "exercises/01/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Simple", app: { type: "simple", browserTests: ["page.browser.js"] } },
      "exercises/01/problem/index.html": "<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1><script type=module src=./main.ts></script></body></html>",
      "exercises/01/problem/main.ts": "import { greet } from './greet.ts';\nconst n: number = 1;\ndocument.body.append(greet('x') + n);\n",
      "exercises/01/problem/greet.ts": "export const greet = (s: string): string => 'hi ' + s;\n",
      "exercises/01/problem/page.browser.js": "import { testStep, expect, dtl } from '@icodenet/workshop-test';\nawait testStep('h1', () => expect(dtl.screen.getByRole('heading')).toBeInTheDocument());\n",
      "exercises/01/problem/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'><script>alert(1)</script></svg>",
      "exercises/01/problem/data.json": '{"a":1}',
      "exercises/02/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Export", app: { type: "export", entry: "index.mjs" } },
      "exercises/02/problem/index.mjs": "import secret from '../../../../" + "SECRET_PLACEHOLDER" + "';\nexport const leaked = secret;\n",
      "exercises/02/solution/index.mjs": "import data from '../../01/problem/data.json';\nexport const value = data.a;\nconsole.log('hello');\n",
      "images/pic.png": Buffer.from("89504e470d0a1a0a", "hex"),
      "images/notes.txt": "secret notes",
    },
  });
  // A file outside the course root that a hostile export app tries to bundle.
  const secret = join(dirname(root), basename(root) + "-secret.json");
  await writeFile(secret, '{"token":"do-not-leak"}');
  const rel = "../../../../" + basename(secret);
  await writeFile(join(root, "exercises/02/problem/index.mjs"), `import secret from ${JSON.stringify(rel)};\nexport const leaked = secret;\n`);
  const port = await freePort();
  const server = createSandboxServer({ root, port, uiOrigin: "http://127.0.0.1:5173" });
  await once(server, "listening");
  return { root, port, server, secret };
}

test("refuses foreign hosts, cross-site requests and every method but GET/HEAD", async (t) => {
  const { port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  assert.equal((await get(port, "/app/01/problem/", { headers: { host: "evil.test:" + port } })).status, 403);
  assert.equal((await get(port, "/app/01/problem/", { headers: { host: "127.0.0.1:1" } })).status, 403);
  assert.equal((await get(port, "/app/01/problem/", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  for (const site of ["same-site", "same-origin", "none"]) assert.equal((await get(port, "/app/01/problem/", { headers: { "sec-fetch-site": site } })).status, 200, site);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await get(port, "/app/01/problem/", { method })).status, 405, method);
  // Only the static Mermaid engine scripts are loadable cross-site (opaque frame).
  assert.equal((await get(port, "/__icode/mermaid/mermaid.esm.min.mjs", { headers: { "sec-fetch-site": "cross-site" } })).status, 200);
  assert.equal((await get(port, "/__icode/mermaid-frame.js", { headers: { "sec-fetch-site": "cross-site" } })).status, 200);
  assert.equal((await get(port, "/__icode/mermaid/mermaid.esm.min.mjs?x", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await get(port, "/asset/images/pic.png", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
});

test("path traversal through apps, exports, tests and assets is refused", async (t) => {
  const { root, port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  const bad = [
    "/app/01/problem/..%2f..%2f..%2fcourse.json",
    "/app/01/problem/%2e%2e/%2e%2e/%2e%2e/course.json",
    "/app/01/problem/../../../course.json",
    "/app/01/problem/..\\..\\course.json",
    "/app/01/problem/%5c..%5c..%5ccourse.json",
    "/app/01/problem/%00.html",
    "/app/01/evil/",
    "/app/1/problem/",
    "/app/01/problem/.hidden",
    "/export/01/../../course.json",
    "/export/%2e%2e/problem/",
    "/asset/..%2fcourse.json",
    "/asset/course.json",
    "/asset/images/notes.txt",
    "/asset/.workshop/x.png",
    "/asset/C:%5cWindows%5cx.png",
    "/__icode/test-bundle/01/problem/..%2f..%2f..%2fcourse.json",
    "/__icode/test-bundle/01/problem/greet.ts",
    "/app/01/problem/?__icode_test=..%2f..%2fcourse.json",
    "/app/01/problem/?__icode_test=greet.ts",
  ];
  for (const path of bad) {
    const r = await get(port, path);
    assert.ok([400, 404].includes(r.status), path + " → " + r.status + " " + r.body.slice(0, 80));
    assert.doesNotMatch(r.body, /schemaVersion|secret notes/);
  }
  assert.deepEqual(urlSegments("/a/b%20c/"), ["a", "b c"]);
  assert.throws(() => urlSegments("/a/%2e%2e/b"), /Invalid path/);
  if (process.platform !== "win32") {
    await mkdir(join(root, "outside"), { recursive: true });
    await writeFile(join(root, "outside", "x.png"), "x");
    await symlink(join(root, "outside"), join(root, "exercises", "01", "problem", "linked"));
    assert.equal((await get(port, "/app/01/problem/linked/x.png")).status, 400, "symlinks are refused");
  }
});

test("simple apps: injected navigation script and base, TS bundled, CSP and nosniff; SVG served sandboxed", async (t) => {
  const { port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  const page = await get(port, "/app/01/problem/");
  assert.equal(page.status, 200);
  assert.match(page.body, /<head><script src="\/__icode\/nav\.js"><\/script><base href="\/app\/01\/problem\/">/);
  assert.match(page.headers["content-security-policy"], /connect-src 'self'/);
  assert.match(page.headers["content-security-policy"], /frame-ancestors http:\/\/127\.0\.0\.1:5173/);
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.equal(page.headers["cross-origin-resource-policy"], "same-site");
  // SPA route fallback to index.html; missing files are 404.
  assert.equal((await get(port, "/app/01/problem/some/route")).status, 200);
  assert.equal((await get(port, "/app/01/problem/missing.css")).status, 404);
  const js = await get(port, "/app/01/problem/main.ts");
  assert.match(js.headers["content-type"], /text\/javascript/);
  assert.match(js.body, /hi /);
  assert.doesNotMatch(js.body, /: number/);
  const svg = await get(port, "/app/01/problem/logo.svg");
  assert.match(svg.headers["content-security-policy"], /^sandbox; default-src 'none'/);
  const nav = await get(port, "/__icode/nav.js");
  assert.match(nav.body, /var UI = "http:\/\/127\.0\.0\.1:5173";/);
  // The playground does not exist until the step is opened.
  assert.equal((await get(port, "/app/01/playground/")).status, 404);
  assert.equal((await get(port, "/app/03/problem/")).status, 400);
});

test("in-browser tests: only declared files, test runtime aliased and bundled, results posted to the UI origin", async (t) => {
  const { root, port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  const page = await get(port, "/app/01/problem/?__icode_test=page.browser.js");
  assert.match(page.body, /<script type="module" src="\/__icode\/test-bundle\/01\/problem\/page\.browser\.js"><\/script><\/body>/);
  const bundle = await get(port, "/__icode/test-bundle/01/problem/page.browser.js");
  assert.equal(bundle.status, 200);
  assert.match(bundle.body, /function testStep/);
  assert.match(bundle.body, /icode:test/);
  assert.match(bundle.body, /getByRole/, "@testing-library/dom is bundled from the engine");
  await selectWorkspace(root, "01");
  assert.equal((await get(port, "/app/01/playground/?__icode_test=page.browser.js")).status, 200);
});

test("export apps: page shell, bundling inside the course, and a hostile import outside the course is refused", async (t) => {
  const { port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  const page = await get(port, "/export/02/solution/");
  assert.match(page.body, /data-entry="\/app\/02\/solution\/index\.mjs"/);
  assert.match(page.body, /<script type="module" src="\/__icode\/export\.js"><\/script>/);
  assert.match((await get(port, "/app/02/solution/")).body, /Console output/, "an export app's root is its export page");
  const ok = await get(port, "/app/02/solution/index.mjs");
  assert.match(ok.body, /var data_default = \{ a: 1 \}/);
  const hostile = await get(port, "/app/02/problem/index.mjs");
  assert.match(hostile.body, /Refused to bundle a file outside the course/);
  assert.doesNotMatch(hostile.body, /do-not-leak/);
});

test("lesson images are served from the course with a sandbox CSP; Mermaid page is locked down", async (t) => {
  const { port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  const png = await get(port, "/asset/images/pic.png");
  assert.equal(png.status, 200);
  assert.equal(png.headers["content-type"], "image/png");
  assert.match(png.headers["content-security-policy"], /^sandbox;/);
  const mermaid = await get(port, "/__icode/mermaid.html");
  assert.match(mermaid.headers["content-security-policy"], /default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'/);
  assert.match(mermaid.body, /<script type="module" src="\/__icode\/mermaid-frame\.js"><\/script>/);
  const frame = await get(port, "/__icode/mermaid-frame.js");
  assert.match(frame.body, /securityLevel: "strict"/);
  assert.match(frame.body, /event\.origin !== UI/);
});

test("Mermaid is served from its ESM build without the elk layout (EPL/GPL): no elk code is reachable", async (t) => {
  const { port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  const dist = join(dirname(createRequire(import.meta.url).resolve("mermaid/package.json")), "dist");
  const chunks = await readdir(join(dist, "chunks", "mermaid.esm.min"));
  const elk = chunks.filter((f) => /elk/i.test(f));
  assert.ok(elk.length >= 1, "the elk chunk exists in the package");
  let served = 0;
  for (const name of ["mermaid.esm.min.mjs", ...chunks.map((c) => "chunks/mermaid.esm.min/" + c)]) {
    const body = await mermaidFile(name);
    if (!body) continue;
    served++;
    assert.doesNotMatch(body.toString("utf8"), /org\.eclipse\.elk|Eclipse Public License/, name);
  }
  assert.ok(served > 50, "ESM entry and chunks are served");
  for (const name of elk) assert.equal((await get(port, "/__icode/mermaid/chunks/mermaid.esm.min/" + name)).status, 404, name);
  for (const path of ["/__icode/mermaid.js", "/__icode/mermaid/mermaid.esm.min.mjs.map", "/__icode/mermaid/chunks/mermaid.esm.min/ELK-x.mjs", "/__icode/mermaid/../package.json", "/__icode/mermaid/chunks/mermaid.core/x.mjs"])
    assert.ok([400, 404].includes((await get(port, path)).status), path);
  const entry = await get(port, "/__icode/mermaid/mermaid.esm.min.mjs");
  assert.equal(entry.headers["access-control-allow-origin"], "*");
  assert.match((await get(port, "/__icode/mermaid-frame.js")).body, /layout: "dagre"/);
});

test("double-encoded traversal and hidden files are refused (assets, apps and the bundler)", async (t) => {
  const { root, port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  for (const path of ["/asset/%252e%252e/%252e%252e/course.json", "/asset/%252e%252e%252fcourse.json", "/app/01/problem/%252e%252e%252f%252e%252e%252fcourse.json", "/asset/images/%252e%252e/%252e%252e/x.png"]) {
    const r = await get(port, path);
    assert.ok([400, 404].includes(r.status), path + " " + r.status);
    assert.doesNotMatch(r.body, /schemaVersion/);
  }
  await mkdir(join(root, "exercises", "02", "solution", ".secret"), { recursive: true });
  await writeFile(join(root, "exercises", "02", "solution", ".secret", "x.js"), "export const s = 'hidden-file-content';\n");
  await mkdir(join(root, ".workshop"), { recursive: true });
  await writeFile(join(root, ".workshop", "preferences.json"), '{"pref":"workshop-private"}');
  for (const spec of ["./.secret/x.js", "../../../.workshop/preferences.json"]) {
    await writeFile(join(root, "exercises", "02", "solution", "index.mjs"), `import x from ${JSON.stringify(spec)};\nexport const v = x;\n`);
    const r = await get(port, "/app/02/solution/index.mjs?" + encodeURIComponent(spec));
    assert.match(r.body, /Refused to bundle a file outside the course/, spec);
    assert.doesNotMatch(r.body, /hidden-file-content|workshop-private/);
  }
});

test("service workers are refused; the reset page clears the origin's storage", async (t) => {
  const { port, server, secret } = await setup();
  t.after(() => (server.close(), rm(secret, { force: true })));
  for (const headers of [{ "service-worker": "script" }, { "sec-fetch-dest": "serviceworker" }]) {
    for (const path of ["/app/01/problem/main.ts", "/app/01/problem/page.browser.js", "/__icode/nav.js", "/__icode/mermaid-frame.js", "/app/01/problem/"])
      assert.equal((await get(port, path, { headers })).status, 403, path + " " + JSON.stringify(headers));
  }
  assert.equal((await get(port, "/app/01/problem/main.ts")).status, 200, "ordinary script loads still work");
  const reset = await get(port, "/__icode/reset?generation=abc");
  assert.equal(reset.status, 200);
  assert.equal(reset.headers["clear-site-data"], '"storage", "cache"');
  assert.match(reset.headers["content-security-policy"], /^default-src 'none'; frame-ancestors http:\/\/127\.0\.0\.1:5173$/);
});

test("asset paths are decoded once: a double-encoded traversal cannot reach an image outside the course", async (t) => {
  const { root, port, server, secret } = await setup();
  const outside = join(dirname(root), basename(root) + "-outside.png");
  await writeFile(outside, Buffer.from("89504e470d0a1a0a6f757473696465", "hex"));
  t.after(() => (server.close(), rm(secret, { force: true }), rm(outside, { force: true })));
  const name = encodeURIComponent(basename(outside));
  // Control: the same image inside the course is served.
  await writeFile(join(root, "images", basename(outside)), Buffer.from("89504e470d0a1a0a", "hex"));
  assert.equal((await get(port, "/asset/images/" + name)).status, 200);
  for (const path of [
    "/asset/%252e%252e/" + name,
    "/asset/%252e%252e%252f" + name,
    "/asset/images/%252e%252e/%252e%252e/" + name,
    "/asset/%25252e%25252e/" + name,
    "/asset/%2e%2e/" + name,
    "/asset/..%2f" + name,
  ]) {
    const r = await get(port, path);
    assert.ok([400, 404].includes(r.status), path + " → " + r.status);
    assert.doesNotMatch(r.body, /outside/);
  }
});
