// Stage 3 over HTTP: content routes, the sandbox origin started with the API,
// and refusal of hostile, cross-origin and sandbox-origin requests.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { request } from "node:http";
import { access } from "node:fs/promises";
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
  const sandboxPort = await freePort();
  const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, WORKSHOP_CONTENT: root, WORKSHOP_API_PORT: String(port), WORKSHOP_SANDBOX_PORT: String(sandboxPort), ICODE_SIDECARS: "0", ICODE_UPDATE_CHECK: "0", ICODE_NOTIFICATIONS_FEED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const closed = once(server, "close");
  const base = `http://127.0.0.1:${port}/api`;
  await until(() => fetch(base + "/exercises").then((r) => r.ok).catch(() => false));
  await until(() => fetch(`http://127.0.0.1:${sandboxPort}/__icode/nav.js`).then((r) => r.ok).catch(() => false));
  const call = async (path, { method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { port, sandboxPort, call, stop: async () => (server.kill("SIGTERM"), await closed), log: () => log };
}
async function course() {
  return nativeCourse({
    course: {
      subtitle: "Stage 3",
      forms: { workshop: "https://f.test/?w={workshopTitle}", exercise: "https://f.test/?e={exerciseTitle}" },
      support: { text: "Ask <script>alert(1)</script>**here**" },
      notifications: [{ id: "n1", title: "Note", message: "Hello" }],
    },
    files: {
      "exercises/README.md": "# Intro\n\n<DiffLink>diff</DiffLink>\n\n```mermaid\ngraph TD; A-->B\n```\n",
      "exercises/FINISHED.md": "# Done\n",
      "exercises/01/README.md": "# Step one\n\n<script>alert(1)</script>\n\n```js {1}\nconst a = 1;\n```\n\n<InlineFile file=\"index.mjs\" />\n",
      "exercises/01/FINISHED.md": "# Wrap-up\n",
      "exercises/01/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "First", app: { type: "simple" } },
      "exercises/01/problem/index.html": "<h1>App</h1>",
    },
  });
}

test("content routes: lesson HTML, pages, app info, notifications and mute through the gate", { timeout: 60000 }, async () => {
  const root = await course();
  const api = await start(root);
  try {
    const exercise = (await api.call("/exercise?id=01")).body;
    assert.match(exercise.lesson.html, /<h1 id="h-step-one">/);
    assert.match(exercise.lesson.html, /class="shiki/);
    assert.doesNotMatch(exercise.lesson.html, /<script/);
    assert.match(exercise.instructions, /Step one/, "Markdown content is kept for the tutor and MCP");
    assert.deepEqual(exercise.documents.map((d) => d.title), ["Lesson", "Exercise wrap-up"]);
    assert.deepEqual(exercise.app, { type: "simple", initialRoute: "/", browserTests: [] });
    const config = (await api.call("/content/config")).body;
    assert.equal(config.sandboxOrigin, "http://127.0.0.1:" + api.sandboxPort);
    assert.equal(config.forms.workshop, "https://f.test/?w=Workspace%20course");
    assert.match(config.support.html, /<strong>here<\/strong>/);
    assert.doesNotMatch(config.support.html, /<script/);
    const intro = (await api.call("/content/page?name=intro")).body;
    assert.equal(intro.exists, true);
    assert.match(intro.html, /diff-link-inactive/);
    assert.match(intro.html, /mermaid-diagram/);
    const finished = (await api.call("/content/page?name=finished")).body;
    assert.deepEqual([finished.completed, finished.total, finished.form], [0, 2, "https://f.test/?w=Workspace%20course"]);
    assert.match((await api.call("/content/page?name=guide&id=01")).body.html, /exercises\/01\/problem/);
    assert.equal((await api.call("/content/page?name=guide&id=..")).status, 400);
    assert.equal((await api.call("/content/page?name=../../etc/passwd")).status, 400);
    const app = (await api.call("/content/app?id=01&variant=problem")).body;
    assert.equal(app.url, `http://127.0.0.1:${api.sandboxPort}/app/01/problem/`);
    assert.equal(app.exerciseForm, "https://f.test/?e=Labs", "exercise title: the module of a flat course");
    assert.equal((await api.call("/content/app?id=../01")).status, 400);
    assert.equal((await api.call("/content/app?id=01&variant=../../x")).status, 400);
    assert.deepEqual((await api.call("/notifications")).body.notifications.map((n) => n.id), ["n1"]);
    assert.deepEqual((await api.call("/notifications/mute", { method: "POST", body: { id: "n1" } })).body, { muted: ["n1"] });
    assert.deepEqual((await api.call("/notifications")).body.notifications, []);
    // The sandbox serves the app.
    const page = await raw(api.sandboxPort, "/app/01/problem/", { headers: { host: "127.0.0.1:" + api.sandboxPort } });
    assert.equal(page.status, 200);
    assert.match(page.data, /<h1>App<\/h1>/);
  } finally {
    await api.stop();
  }
});

test("the API refuses the sandbox origin, cross-site, foreign-origin and foreign-host requests on new routes", { timeout: 60000 }, async () => {
  const root = await course();
  const api = await start(root);
  try {
    const sandbox = "http://127.0.0.1:" + api.sandboxPort;
    const host = "127.0.0.1:" + api.port;
    const routes = [
      ["GET", "/api/content/config"],
      ["GET", "/api/content/page?name=intro"],
      ["GET", "/api/content/app?id=01"],
      ["GET", "/api/notifications"],
      ["GET", "/api/exercise?id=01"],
      ["POST", "/api/notifications/mute", { id: "n1" }],
      ["PUT", "/api/progress", { id: "01", complete: true }],
    ];
    for (const [method, path, body] of routes) {
      const payload = body && JSON.stringify(body);
      for (const headers of [
        { host, origin: sandbox },
        { host, origin: "null" },
        { host, "sec-fetch-site": "same-site" },
        { host, "sec-fetch-site": "cross-site" },
        { host, origin: "https://evil.test" },
        { host: "evil.test:" + api.port },
        { host: "127.0.0.1:" + api.sandboxPort },
      ]) {
        const r = await raw(api.port, path, { method, headers, body: payload });
        assert.equal(r.status, 403, `${method} ${path} ${JSON.stringify(headers)} → ${r.status}`);
      }
    }
    // Nothing changed.
    assert.deepEqual((await api.call("/notifications")).body.notifications.map((n) => n.id), ["n1"]);
    assert.deepEqual((await api.call("/progress")).body, { completed: [], questions: {} });
    await assert.rejects(access(join(root, ".workshop", "notifications.json")));
    // Invalid mute ids are plain 400s.
    assert.equal((await api.call("/notifications/mute", { method: "POST", body: { id: "../x" } })).status, 400);
  } finally {
    await api.stop();
  }
});

test("stopping the API also closes the sandbox origin", { timeout: 60000 }, async () => {
  const root = await course();
  const api = await start(root);
  await api.stop();
  await assert.rejects(fetch(`http://127.0.0.1:${api.sandboxPort}/__icode/nav.js`, { signal: AbortSignal.timeout(2000) }));
});

test("mute takes the mutation gate; browser mutations need the session token", { timeout: 60000 }, async () => {
  const root = await nativeCourse({
    hooks: { preSetPlayground: "slow" },
    scripts: { slow: "node slow.mjs" },
    files: { "slow.mjs": "setTimeout(() => {}, 3000);\n" },
    course: { notifications: [{ id: "n1", title: "Note", message: "Hello" }] },
  });
  const api = await start(root);
  try {
    const select = api.call("/select", { method: "POST", body: { id: "01" } });
    await new Promise((r) => setTimeout(r, 800));
    const muted = await api.call("/notifications/mute", { method: "POST", body: { id: "n1" } });
    assert.equal(muted.status, 409, "mute waits for the running operation");
    assert.equal((await select).status, 200);
    await assert.rejects(access(join(root, ".workshop", "notifications.json")));
    // A browser request (Origin or Fetch Metadata) without the token is refused, even from the UI origin.
    const host = "127.0.0.1:" + api.port;
    const body = JSON.stringify({ id: "n1" });
    for (const headers of [{ host, origin: "http://127.0.0.1:5173" }, { host, "sec-fetch-site": "same-origin" }, { host, origin: "http://127.0.0.1:5173", "x-icode-session": "x".repeat(64) }])
      assert.equal((await raw(api.port, "/api/notifications/mute", { method: "POST", headers, body })).status, 403, JSON.stringify(headers));
    // Only a same-origin fetch can read the token; with it, the UI's request succeeds.
    assert.equal((await raw(api.port, "/api/session", { headers: { host } })).status, 403);
    assert.equal((await raw(api.port, "/api/session", { headers: { host, "sec-fetch-site": "same-origin", "sec-fetch-dest": "document" } })).status, 403);
    const session = await raw(api.port, "/api/session", { headers: { host, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" } });
    const { token } = JSON.parse(session.data);
    assert.equal(token.length, 64);
    assert.equal(session.headers["x-frame-options"], "DENY");
    const ok = await raw(api.port, "/api/notifications/mute", { method: "POST", headers: { host, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin", "x-icode-session": token }, body });
    assert.equal(ok.status, 200);
  } finally {
    await api.stop();
  }
});

test("every API response forbids framing and sniffing, whatever its status", { timeout: 60000 }, async () => {
  const root = await course();
  const api = await start(root);
  try {
    const host = "127.0.0.1:" + api.port;
    const cases = [
      ["GET", "/api/exercises", { host }, 200],
      ["GET", "/api/content/config", { host }, 200],
      ["GET", "/api/exercise?id=99", { host }, 400],
      ["GET", "/api/nope", { host }, 404],
      ["GET", "/api/exercises", { host: "evil.test" }, 403],
      ["GET", "/api/exercises", { host, origin: "https://evil.test" }, 403],
      ["GET", "/api/session", { host }, 403],
      ["PUT", "/api/progress", { host, origin: "http://127.0.0.1:5173" }, 403],
      ["OPTIONS", "/api/progress", { host }, 204],
    ];
    for (const [method, path, headers, status] of cases) {
      const r = await raw(api.port, path, { method, headers, body: method === "PUT" ? "{}" : undefined });
      assert.equal(r.status, status, method + " " + path);
      assert.equal(r.headers["x-frame-options"], "DENY", path + " " + status);
      assert.match(r.headers["content-security-policy"] ?? "", /frame-ancestors 'none'/, path + " " + status);
      assert.match(r.headers["content-security-policy"] ?? "", /(^|; )sandbox($|;)/, path + " " + status);
      assert.equal(r.headers["x-content-type-options"], "nosniff", path + " " + status);
    }
  } finally {
    await api.stop();
  }
});
