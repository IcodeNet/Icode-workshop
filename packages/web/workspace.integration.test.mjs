// Stage 2 over HTTP: hooks, saved playgrounds, diffs, touched files, sync and
// update routes, including hostile requests.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { request } from "node:http";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCourse, recorderScript } from "./test-support/workspace-course.mjs";

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
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
async function startServer(root) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api`;
  const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, WORKSHOP_CONTENT: root, WORKSHOP_API_PORT: String(port), ICODE_SIDECARS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const closed = once(server, "close");
  await until(() => fetch(base + "/exercises").then((r) => r.ok).catch(() => false));
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const stop = async () => {
    server.kill("SIGTERM");
    await closed;
  };
  return { port, base, call, stop, log: () => log };
}
const q = encodeURIComponent;

test("new routes refuse foreign hosts, origins and cross-site requests without side effects", { timeout: 60000 }, async () => {
  const root = await nativeCourse();
  const api = await startServer(root);
  try {
    await api.call("/select", { method: "POST", body: { id: "01" } });
    const routes = [
      ["POST", "/api/saved-playgrounds", { id: "01", label: "evil" }],
      ["DELETE", "/api/saved-playgrounds", { id: "01", savedId: "20261127T101112345Z-abcdef" }],
      ["PATCH", "/api/saved-playgrounds", { id: "01", savedId: "20261127T101112345Z-abcdef", pinned: true }],
      ["POST", "/api/saved-playgrounds/restore", { id: "01", savedId: "20261127T101112345Z-abcdef" }],
      ["POST", "/api/file/sync", { id: "01", name: "index.mjs", from: "01.solution" }],
      ["PUT", "/api/preferences", { savePlaygrounds: false }],
      ["POST", "/api/update/check", {}],
      ["POST", "/api/update/apply", { confirm: "update" }],
      ["GET", "/api/diff?a=01.problem&b=01.solution"],
      ["GET", "/api/touched?id=01"],
    ];
    const hostile = [
      { origin: "http://evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { host: "evil.example:" + api.port },
    ];
    for (const [method, path, body] of routes)
      for (const headers of hostile) {
        const response = await raw(api.port, path, { method, headers, body: body && JSON.stringify(body) }).catch((e) => { throw new Error(method + " " + path + " " + JSON.stringify(headers) + ": " + e.message); });
        assert.equal(response.status, 403, method + " " + path + " " + JSON.stringify(headers));
      }
    assert.deepEqual((await api.call("/saved-playgrounds?id=01")).body.saved, [], "nothing was saved");
    assert.equal(await readFile(join(root, ".workshop/playgrounds/01/index.mjs"), "utf8"), "export const value = 1;\n// TODO\n", "nothing was synced");
    assert.equal((await api.call("/preferences")).body.savePlaygrounds, true, "preferences unchanged");
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("traversal through saved-playground ids, diff sides, diff paths and sync names is refused", { timeout: 60000 }, async () => {
  const root = await nativeCourse();
  const api = await startServer(root);
  try {
    await api.call("/select", { method: "POST", body: { id: "01" } });
    const bad = [
      ["/saved-playgrounds?id=" + q("../01")],
      ["/saved-playgrounds/restore", { method: "POST", body: { id: "01", savedId: "../../exercises/01/solution" } }],
      ["/saved-playgrounds/restore", { method: "POST", body: { id: "01", savedId: "20261127T101112345Z-abcdef/../../.." } }],
      ["/saved-playgrounds", { method: "DELETE", body: { id: "01", savedId: "../../../" } }],
      ["/saved-playgrounds", { method: "DELETE", body: { id: "..", savedId: "20261127T101112345Z-abcdef" } }],
      ["/diff?a=" + q("../01.problem") + "&b=01.solution"],
      ["/diff?a=01.problem&b=" + q("01.saved.../../../etc")],
      ["/diff?a=01.problem&b=" + q("01.solution/../../..")],
      ["/diff/file?a=01.problem&b=01.solution&path=" + q("../../course.json")],
      ["/diff/file?a=01.problem&b=01.solution&path=" + q("/etc/passwd")],
      ["/diff/file?a=01.problem&b=01.solution&path=" + q("..\\..\\course.json")],
      ["/diff/file?a=01.problem&b=01.solution&path=package.json"],
      ["/touched?id=" + q("../..")],
      ["/file/sync", { method: "POST", body: { id: "01", name: "../../../course.json", from: "01.solution" } }],
      ["/file/sync", { method: "POST", body: { id: "01", name: "index.mjs", from: "../02.solution" } }],
      ["/file/sync", { method: "POST", body: { id: "01", name: "index.mjs", from: "01.playground" } }],
      ["/replace-workspace", { method: "POST", body: { id: "01", backup: "../../exercises/01/solution" } }],
    ];
    for (const [path, options] of bad) {
      const response = await api.call(path, options);
      assert.equal(response.status, 400, path + " " + JSON.stringify(options?.body ?? ""));
    }
    assert.deepEqual((await readdir(join(root, ".workshop"))).sort(), ["playgrounds"], "no stray state was created");
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("hooks, saved playgrounds, diffs, touched files and sync work end to end", { timeout: 90000 }, async () => {
  const root = await nativeCourse({
    hooks: { postSetPlayground: "post", timeoutSeconds: 30 },
    scripts: { post: "node post.mjs" },
    files: { "post.mjs": recorderScript("post") },
  });
  const api = await startServer(root);
  try {
    const created = await api.call("/select", { method: "POST", body: { id: "01" } });
    assert.equal(created.body.hooks[0].status, "passed", "creating a playground sets it");
    assert.equal(JSON.parse((JSON.parse(await readFile(join(root, "post.json"), "utf8"))).ICODE_HOOK_CONTEXT).operation, "create");
    const reopened = await api.call("/select", { method: "POST", body: { id: "01" } });
    assert.deepEqual(reopened.body.hooks, [], "re-opening does not run hooks");
    await api.call("/file", { method: "PUT", body: { id: "01", name: "index.mjs", code: "mine\n" } });
    const saved = await api.call("/saved-playgrounds", { method: "POST", body: { id: "01", label: "first try" } });
    assert.equal(saved.status, 200);
    const reset = await api.call("/reset", { method: "POST", body: { id: "01" } });
    assert.equal(reset.status, 200);
    assert.ok(reset.body.saved.savedId, "reset saved the playground first");
    assert.equal(reset.body.hooks[0].hook, "post-set-playground");
    const list = (await api.call("/saved-playgrounds?id=01")).body.saved;
    assert.deepEqual(list.map((s) => s.reason), ["reset", "manual"]);
    const restored = await api.call("/saved-playgrounds/restore", { method: "POST", body: { id: "01", savedId: saved.body.savedId } });
    assert.equal(restored.status, 200);
    assert.equal(await readFile(join(root, ".workshop/playgrounds/01/index.mjs"), "utf8"), "mine\n");
    const diff = await api.call("/diff?a=01.playground&b=01.solution&context=all");
    assert.equal(diff.status, 200);
    assert.deepEqual(diff.body.files.map((f) => f.path), ["extra.mjs", "index.mjs"]);
    const savedDiff = await api.call("/diff?a=01.saved." + saved.body.savedId + "&b=01.problem");
    assert.deepEqual(savedDiff.body.files.map((f) => f.path), ["index.mjs"]);
    const one = await api.call("/diff/file?a=01.problem&b=01.solution&path=index.mjs&ws=ignore");
    assert.equal(one.body.file.additions, 1);
    const touched = (await api.call("/touched?id=01")).body;
    assert.deepEqual(touched.files.map((f) => [f.path, f.playground]), [["extra.mjs", "missing"], ["index.mjs", "edited"]]);
    const synced = await api.call("/file/sync", { method: "POST", body: { id: "01", name: "extra.mjs", from: "01.solution" } });
    assert.equal(synced.status, 200);
    assert.ok(synced.body.saved.savedId, "sync saves first");
    assert.deepEqual(synced.body.hooks, [], "single-file sync runs no hooks");
    const after = (await api.call("/touched?id=01")).body;
    assert.equal(after.files.find((f) => f.path === "extra.mjs").playground, "done");
    const pref = await api.call("/preferences", { method: "PUT", body: { savePlaygrounds: false } });
    assert.equal(pref.body.savePlaygrounds, false);
    const noSave = await api.call("/reset", { method: "POST", body: { id: "01" } });
    assert.equal(noSave.body.saved, null);
    const deleted = await api.call("/saved-playgrounds", { method: "DELETE", body: { id: "01", savedId: saved.body.savedId } });
    assert.equal(deleted.status, 200);
    const status = await api.call("/update");
    assert.equal(status.body.git, false);
    const refused = await api.call("/update/apply", { method: "POST", body: { confirm: "yes" } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /typing "update"/);
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("a hook that never exits holds only its own request: listed, stoppable, nothing changed", { timeout: 90000 }, async () => {
  const root = await nativeCourse({
    hooks: { preSetPlayground: "hang", timeoutSeconds: 60 },
    scripts: { hang: "node hang.mjs" },
    files: { "hang.mjs": "setInterval(() => {}, 1000);\n" },
  });
  // Create the playground before hooks exist.
  const manifest = JSON.parse(await readFile(join(root, "course.json"), "utf8"));
  await writeFile(join(root, "course.json"), JSON.stringify({ ...manifest, hooks: undefined }));
  const api = await startServer(root);
  try {
    await api.call("/select", { method: "POST", body: { id: "01" } });
    await api.call("/file", { method: "PUT", body: { id: "01", name: "index.mjs", code: "keep me\n" } });
    await writeFile(join(root, "course.json"), JSON.stringify(manifest));
    const pending = api.call("/reset", { method: "POST", body: { id: "01" } });
    const hook = await until(async () => (await api.call("/processes")).body.processes.find((p) => p.kind === "hook"));
    assert.match(hook.label, /pre-set-playground/);
    const busy = await api.call("/file", { method: "PUT", body: { id: "01", name: "index.mjs", code: "x" } });
    assert.equal(busy.status, 409, "other mutations wait for the gate");
    for (const [path, method, body] of [
      ["/saved-playgrounds", "POST", { id: "01" }],
      ["/file/sync", "POST", { id: "01", name: "index.mjs", from: "01.solution" }],
      ["/saved-playgrounds/restore", "POST", { id: "01", savedId: "20261127T101112345Z-abcdef" }],
      ["/preferences", "PUT", { savePlaygrounds: false }],
    ])
      assert.equal((await api.call(path, { method, body })).status, 409, path + " is gated");
    const stopped = await api.call("/processes/stop", { method: "POST", body: { id: hook.id } });
    assert.equal(stopped.status, 200, "stopping the gate's own hook is allowed");
    const result = await pending;
    assert.equal(result.status, 400);
    assert.match(result.body.error, /pre-set-playground hook stopped/);
    assert.equal(result.body.hooks[0].status, "stopped");
    assert.equal(await readFile(join(root, ".workshop/playgrounds/01/index.mjs"), "utf8"), "keep me\n");
    assert.equal((await api.call("/processes")).body.processes.length, 0);
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("update routes wait for a running course action; playground work does not", { timeout: 90000 }, async () => {
  const root = await nativeCourse({
    scripts: { slow: "node slow.mjs" },
    course: { actions: [{ id: "slow", label: "Slow", script: "slow" }] },
    files: { "slow.mjs": "setInterval(() => {}, 1000);\n" },
  });
  const api = await startServer(root);
  try {
    await api.call("/select", { method: "POST", body: { id: "01" } });
    const run = await api.call("/actions/run", { method: "POST", body: { id: "slow" } });
    assert.equal(run.status, 200);
    assert.equal((await api.call("/update/check", { method: "POST", body: {} })).status, 409);
    assert.equal((await api.call("/update/apply", { method: "POST", body: { confirm: "update" } })).status, 409);
    assert.equal((await api.call("/saved-playgrounds", { method: "POST", body: { id: "01" } })).status, 200, "playground work continues");
    await api.call("/actions/cancel", { method: "POST", body: { runId: run.body.runId } });
    await until(async () => !(await api.call("/operations")).body.running);
  } finally {
    await api.stop();
    await rm(root, { recursive: true, force: true });
  }
});
