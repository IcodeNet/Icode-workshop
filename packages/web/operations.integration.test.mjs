import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { operationsCourse } from "./test-support/operations-course.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 10000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Condition not met in time");
};
/** Raw request so tests can set Host/Origin headers that fetch forbids. */
function raw(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test(
  "API: actions with confirmation, indicators, processes, sidecars, live reload",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    const port = await freePort();
    const base = `http://127.0.0.1:${port}/api`;
    const server = spawn(
      process.execPath,
      [fileURLToPath(new URL("./server.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          WORKSHOP_CONTENT: root,
          WORKSHOP_API_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    server.stdout.on("data", (d) => (log += d));
    server.stderr.on("data", (d) => (log += d));
    const closed = once(server, "close");
    const post = (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      await until(() =>
        fetch(base + "/exercises")
          .then((r) => r.ok)
          .catch(() => false),
      );

      // Host/Origin checks apply to the new endpoints.
      assert.equal(
        (
          await raw(port, "/api/operations", {
            headers: { host: "evil.example" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await raw(port, "/api/actions/run", {
            method: "POST",
            headers: { origin: "https://evil.example" },
            body: '{"id":"deploy"}',
          })
        ).status,
        403,
      );

      const operations = await (await fetch(base + "/operations")).json();
      assert.deepEqual(
        operations.actions.map((a) => a.id),
        ["deploy", "teardown", "sleep"],
      );
      assert.equal(operations.actions[0].destructive, true);
      const sidecar = await until(async () =>
        (await (await fetch(base + "/operations")).json()).sidecars.find(
          (s) => s.status === "running",
        ),
      );
      assert.equal(sidecar.name, "db");
      const sidecarPid = Number(
        await until(() =>
          readFile(join(root, "db.pid"), "utf8").catch(() => ""),
        ),
      );

      assert.equal((await post("/actions/run", { id: "rm -rf" })).status, 400);
      assert.deepEqual(
        (await (await fetch(base + "/indicators")).json()).indicators,
        [],
      );

      // Run the action; answer the confirmation while the stream holds the mutation gate.
      const response = await post("/actions/run", { id: "deploy" });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "",
        text = "",
        result;
      while (!result) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.text) text += event.text;
          if (event.type === "confirm") {
            const running = (await (await fetch(base + "/operations")).json())
              .running;
            assert.equal(running.awaitingConfirmation, true);
            const blocked = await fetch(base + "/file", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: "01", name: "index.mjs", code: "x" }),
            });
            assert.equal(
              blocked.status,
              409,
              "other mutations wait for the action",
            );
            const sent = await post("/actions/input", {
              runId: running.runId,
              text: event.expected,
            });
            assert.equal(sent.status, 200, await sent.clone().text());
          }
          if (event.type === "result") result = event;
        }
      }
      assert.equal(result?.status, "passed", text);
      assert.match(text, /deployed/);
      assert.doesNotMatch(text, /icode-confirm/);
      const indicators = (await (await fetch(base + "/indicators")).json())
        .indicators;
      assert.equal(
        indicators[0].message,
        "Azure resources are running and cost money",
      );

      const { processes } = await (await fetch(base + "/processes")).json();
      const sidecarProcess = processes.find((p) => p.kind === "sidecar");
      assert.equal(sidecarProcess.pid > 0, true);
      assert.ok(Date.parse(sidecarProcess.startedAt));
      const logs = (await (await fetch(base + "/sidecars/logs?name=db")).json())
        .logs;
      assert.ok(logs.length && logs.every((line) => line.startsWith("[db] ")));
      assert.equal((await fetch(base + "/ports/holder?port=22")).status, 400);
      assert.equal(
        (await post("/ports/free", { port: 22, pid: 1 })).status,
        400,
      );

      const doctor = await (await fetch(base + "/doctor")).json();
      assert.ok(doctor.checks.some((c) => c.name === "Course dependencies"));
      assert.ok(
        (await (await fetch(base + "/editors")).json()).editors.length >= 5,
      );
      assert.equal(
        (await post("/editor/launch", { id: "01", name: "../course.json" }))
          .status,
        400,
      );

      // Live reload over server-sent events.
      const controller = new AbortController();
      const events = await fetch(base + "/events?id=01", {
        signal: controller.signal,
      });
      assert.equal(events.headers.get("content-type"), "text/event-stream");
      const sse = events.body.getReader();
      let stream = "";
      const read = async (pattern) => {
        while (!pattern.test(stream)) {
          const { value, done } = await sse.read();
          if (done) throw new Error("SSE closed: " + stream);
          stream += decoder.decode(value);
        }
      };
      await read(/event: ready/);
      await writeFile(
        join(root, ".workshop", "playgrounds", "01", "index.mjs"),
        "export default 2\n",
      );
      await read(/event: change\ndata: \{"id":"01","name":"index.mjs"\}/);
      controller.abort();

      // Stopping a sidecar from the Processes view; restart brings it back.
      assert.equal(
        (await post("/processes/stop", { id: sidecarProcess.id })).status,
        200,
      );
      await until(() => !alive(sidecarPid));
      await rm(join(root, "db.pid"));
      assert.equal(
        (await post("/sidecars/restart", { name: "db" })).status,
        200,
      );
      const restartedPid = Number(
        await until(() =>
          readFile(join(root, "db.pid"), "utf8").catch(() => ""),
        ),
      );

      // Shutdown stops sidecars.
      server.kill("SIGTERM");
      const [code] = await closed;
      assert.equal(code, 0, log);
      if (process.platform !== "win32")
        await until(() => !alive(restartedPid), 5000);
    } finally {
      if (server.exitCode === null && server.signalCode === null)
        server.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);
