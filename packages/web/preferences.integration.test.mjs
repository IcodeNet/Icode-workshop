// Over HTTP: the preference API (validation, persistence, origin,
// Sec-Fetch-Site, session-token and mutation-gate checks), health, exercise
// warnings and the offline OG image.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { request } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCourse } from "./test-support/workspace-course.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}
const until = async (check, ms = 15000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Condition not met in time");
};
function raw(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body ?? ""), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
async function start(root) {
  const port = await freePort();
  const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, WORKSHOP_CONTENT: root, WORKSHOP_API_PORT: String(port), ICODE_SANDBOX: "0", ICODE_SIDECARS: "0", ICODE_UPDATE_CHECK: "0", ICODE_NOTIFICATIONS_FEED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const closed = once(server, "close");
  const base = `http://127.0.0.1:${port}/api`;
  await until(() => fetch(base + "/exercises").then((r) => r.ok).catch(() => false));
  const call = async (path, { method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, body: json, text, headers: response.headers };
  };
  return { port, call, stop: async () => (server.kill("SIGTERM"), await closed), log: () => log };
}
const prefsFile = (root) => join(root, ".workshop", "preferences.json");

test("preferences API: validated partial UI updates persist; hostile bodies are refused unchanged", { timeout: 60000 }, async () => {
  const root = await nativeCourse();
  const api = await start(root);
  try {
    const initial = await api.call("/preferences");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.savePlaygrounds, true);
    assert.equal(initial.body.ui.theme, "dark");
    const put = await api.call("/preferences", { method: "PUT", body: { ui: { theme: "light", editorFontSize: 16, shortcuts: { "nav.next": "j j" } } } });
    assert.equal(put.status, 200, put.text);
    assert.equal(put.body.ui.theme, "light");
    const second = await api.call("/preferences", { method: "PUT", body: { ui: { motion: "reduce" } } });
    assert.equal(second.body.ui.theme, "light", "partial updates merge");
    assert.equal(second.body.ui.motion, "reduce");
    const stored = JSON.parse(await readFile(prefsFile(root), "utf8"));
    assert.equal(stored.ui.editorFontSize, 16);
    assert.deepEqual(stored.ui.shortcuts, { "nav.next": "j j" });
    const before = await readFile(prefsFile(root), "utf8");
    const hostile = [
      '{"ui":{"theme":"dark;}body{display:none"}}',
      '{"ui":{"editorFont":"</style><script>alert(1)</script>"}}',
      '{"ui":{"__proto__":{"polluted":true}}}',
      '{"__proto__":{"polluted":true}}',
      '{"ui":{"shortcuts":{"palette.open":"<img src=x onerror=alert(1)>"}}}',
      '{"ui":{"shortcuts":{"constructor":"g x"}}}',
      '{"ui":{"unknown":1}}',
      '{"ui":[1,2]}',
      '{"ui":"light"}',
      '{"savePlaygrounds":"no"}',
      '{"extra":true}',
      '[]',
      JSON.stringify({ ui: { shortcuts: Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["x" + i, "g " + i])) } }),
    ];
    for (const body of hostile) {
      const response = await raw(api.port, "/api/preferences", { method: "PUT", body });
      assert.equal(response.status, 400, body + " → " + response.data);
    }
    assert.equal(await readFile(prefsFile(root), "utf8"), before, "file unchanged by refused writes");
    // A tampered file on disk is salvaged per key, never passed through.
    await writeFile(prefsFile(root), JSON.stringify({ savePlaygrounds: false, ui: { theme: "javascript:alert(1)", uiScale: 125, editorFont: "x}", shortcuts: { "nav.next": "<b>" } } }));
    const tampered = (await api.call("/preferences")).body;
    assert.equal(tampered.savePlaygrounds, false);
    assert.equal(tampered.ui.theme, "dark");
    assert.equal(tampered.ui.uiScale, 125);
    assert.equal(tampered.ui.editorFont, "system-mono");
    assert.deepEqual(tampered.ui.shortcuts, {});
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("preferences API keeps the origin, Sec-Fetch-Site, session-token and mutation-gate checks", { timeout: 60000 }, async () => {
  const root = await nativeCourse({
    hooks: { postSetPlayground: "slow" },
    scripts: { slow: 'node -e "setTimeout(() => {}, 2500)"' },
  });
  const api = await start(root);
  try {
    const body = JSON.stringify({ ui: { theme: "light" } });
    const refused = [
      { origin: "http://evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { host: "evil.example:" + api.port },
      // The UI origin itself still needs the per-process session token.
      { origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" },
      { origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin", "x-icode-session": "0".repeat(64) },
    ];
    for (const headers of refused) {
      const response = await raw(api.port, "/api/preferences", { method: "PUT", headers, body });
      assert.equal(response.status, 403, JSON.stringify(headers));
    }
    // A cross-site page cannot read preferences either.
    assert.equal((await raw(api.port, "/api/preferences", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    assert.equal((await api.call("/preferences")).body.ui.theme, "dark", "nothing changed");
    // Hold the mutation gate with a slow post-set-playground hook.
    const select = api.call("/select", { method: "POST", body: { id: "01" } });
    await until(async () => api.log().includes("slow") || (await api.call("/processes")).body.processes.length > 0, 10000);
    const blocked = await api.call("/preferences", { method: "PUT", body: { ui: { theme: "light" } } });
    assert.equal(blocked.status, 409, blocked.text);
    assert.match(blocked.body.error, /Another workshop operation/);
    assert.equal((await select).status, 200);
    const after = await api.call("/preferences", { method: "PUT", body: { ui: { theme: "light" } } });
    assert.equal(after.status, 200, "the retry succeeds once the gate is free");
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("health, exercise warnings and the offline OG image", { timeout: 60000 }, async () => {
  const root = await nativeCourse({ course: { title: 'Course <script>alert("x")</script> & co', subtitle: "Sub" } });
  const api = await start(root);
  try {
    const health = await api.call("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual((await api.call("/warnings")).body, { warnings: [] }, "not a git repository: no warning");
    const og = await api.call("/og.svg");
    assert.equal(og.status, 200);
    assert.match(og.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(og.headers.get("content-security-policy"), /sandbox/, "the API CSP stays on the SVG");
    assert.ok(og.text.includes("Course &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co"));
    assert.equal(/<script/i.test(og.text), false);
    const custom = await api.call("/og.svg?title=" + encodeURIComponent("<b>Hi</b>"));
    assert.ok(custom.text.includes("&lt;b&gt;Hi&lt;/b&gt;"));
    if (spawnSync("git", ["--version"]).status === 0) {
      const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
      for (const args of [["init", "-q"], ["add", "."], ["commit", "-q", "-m", "course"]]) assert.equal(spawnSync("git", args, { cwd: root, env }).status, 0);
      await new Promise((r) => setTimeout(r, 2100)); // warning cache
      assert.deepEqual((await api.call("/warnings")).body, { warnings: [] }, "clean course");
      await writeFile(join(root, "exercises", "01", "problem", "index.mjs"), "edited by mistake\n");
      await writeFile(join(root, "exercises", "01", "problem", "[x] onerror=alert(1).mjs"), "x\n");
      await new Promise((r) => setTimeout(r, 2100));
      const [warning] = (await api.call("/warnings")).body.warnings;
      assert.equal(warning.id, "exercises-changed");
      assert.ok(warning.paths.includes("exercises/01/problem/index.mjs"), JSON.stringify(warning));
      assert.ok(warning.paths.length <= 5);
    }
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});
