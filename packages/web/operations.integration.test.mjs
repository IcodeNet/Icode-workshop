import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { request } from "node:http";
import { tmpdir } from "node:os";
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
const until = async (check, ms = 15000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Condition not met in time");
};
/** Raw request so tests can set Host/Origin/Sec-Fetch headers that fetch forbids. */
function raw(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { "content-type": "application/json", ...headers },
      },
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
/** Read NDJSON events until `stop(event)` or the stream ends. */
async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines.filter(Boolean))
      if ((await onEvent(JSON.parse(line))) === false) {
        await reader.cancel();
        return;
      }
  }
}

async function startServer(root, extraEnv = {}) {
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
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const closed = once(server, "close");
  await until(() =>
    fetch(base + "/exercises")
      .then((r) => r.ok)
      .catch(() => false),
  );
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { port, base, server, closed, post, log: () => log };
}

test(
  "API: hostile hosts, origins and cross-site requests are refused on every new endpoint",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    const { port, server, closed } = await startServer(root, {
      ICODE_SIDECARS: "0",
    });
    try {
      const mutating = [
        "/api/actions/run",
        "/api/actions/input",
        "/api/actions/cancel",
        "/api/processes/stop",
        "/api/ports/free",
        "/api/sidecars/restart",
        "/api/sidecars/stop",
        "/api/editor/launch",
      ];
      for (const path of mutating) {
        const body =
          '{"id":"deploy","name":"db","runId":"x","port":4403,"pid":1,"confirm":true}';
        assert.equal(
          (
            await raw(port, path, {
              method: "POST",
              headers: { host: "evil.example" },
              body,
            })
          ).status,
          403,
          path + " host",
        );
        assert.equal(
          (
            await raw(port, path, {
              method: "POST",
              headers: { origin: "https://evil.example" },
              body,
            })
          ).status,
          403,
          path + " origin",
        );
        assert.equal(
          (
            await raw(port, path, {
              method: "POST",
              headers: { "sec-fetch-site": "cross-site" },
              body,
            })
          ).status,
          403,
          path + " sec-fetch",
        );
      }
      const reads = [
        "/api/operations",
        "/api/indicators",
        "/api/processes",
        "/api/ports/holder?port=4403",
        "/api/sidecars",
        "/api/sidecars/logs?name=db",
        "/api/events?id=01",
        "/api/editors",
        "/api/doctor",
        "/api/actions/run",
        "/api/actions/stream",
      ];
      for (const path of reads) {
        assert.equal(
          (await raw(port, path, { headers: { host: "evil.example" } })).status,
          403,
          path + " host",
        );
        // <img src=…> from another site: no Origin, but Fetch Metadata says cross-site.
        assert.equal(
          (
            await raw(port, path, {
              headers: { "sec-fetch-site": "cross-site" },
            })
          ).status,
          403,
          path + " cross-site",
        );
        assert.equal(
          (
            await raw(port, path, {
              headers: { "sec-fetch-site": "same-site" },
            })
          ).status,
          403,
          path + " same-site",
        );
      }
      assert.notEqual(
        (
          await raw(port, "/api/operations", {
            headers: { "sec-fetch-site": "same-origin" },
          })
        ).status,
        403,
      );
    } finally {
      server.kill("SIGTERM");
      await closed;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "API: detached actions, re-attach, gate, indicators, processes, sidecars, live reload, editor",
  { timeout: 90000 },
  async () => {
    const root = await operationsCourse();
    // Editor stand-in that records its arguments.
    const editorLog = join(root, "editor-args.json");
    await writeFile(
      join(root, "editor.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(editorLog)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    const { base, server, closed, post, log } = await startServer(root, {
      ICODE_EDITOR: JSON.stringify([
        process.execPath,
        join(root, "editor.mjs"),
      ]),
    });
    try {
      const operations = await (await fetch(base + "/operations")).json();
      assert.deepEqual(
        operations.actions.map((a) => a.id),
        ["deploy", "teardown", "sleep", "noisy", "spoof", "graceful"],
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

      assert.equal((await post("/select", { id: "01" })).status, 200);
      assert.equal((await post("/actions/run", { id: "rm -rf" })).status, 400);
      assert.deepEqual(
        (await (await fetch(base + "/indicators")).json()).indicators,
        [],
      );

      // Start the action: the request returns at once; the run is detached.
      const started = await post("/actions/run", { id: "deploy" });
      assert.equal(started.status, 200);
      const { runId } = await started.json();
      // A follower that disconnects before the prompt (closed tab) does not cancel the run.
      await readEvents(
        await fetch(base + "/actions/stream?runId=" + runId),
        () => false,
      );
      await new Promise((r) => setTimeout(r, 300));
      // Re-attach and answer the confirmation.
      let text = "",
        result;
      await readEvents(
        await fetch(base + "/actions/stream?runId=" + runId),
        async (event) => {
          if (event.type === "snapshot") {
            text += event.output;
            assert.equal(event.status, "running");
            if (event.confirm) await answer(event.confirm);
          } else if (event.text) text += event.text;
          else if (event.type === "confirm") await answer(event);
          else if (event.type === "result") result = event;
        },
      );
      async function answer(confirm) {
        const running = (await (await fetch(base + "/operations")).json())
          .running;
        assert.equal(running.awaitingConfirmation, true);
        // The indicator reports the running action.
        assert.match(
          JSON.stringify(
            (await (await fetch(base + "/indicators")).json()).indicators,
          ),
          /Deploy to Azure.*running/,
        );
        const blocked = await fetch(base + "/file", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "01", name: "index.mjs", code: "x" }),
        });
        assert.equal(
          blocked.status,
          200,
          "playground work continues during an action",
        );
        assert.equal(
          (await post("/sidecars/restart", { name: "db" })).status,
          409,
          "course-level operations wait",
        );
        // Stopping something other than the running action is gated too.
        assert.equal(
          (await post("/processes/stop", { id: "not-the-action" })).status,
          409,
        );
        assert.equal(
          (await post("/actions/input", { runId, text: "wrong" })).status,
          400,
        );
        const sent = await post("/actions/input", {
          runId,
          text: confirm.expected,
        });
        assert.equal(sent.status, 200, await sent.clone().text());
      }
      assert.equal(result?.status, "passed", text);
      assert.match(text, /deployed/);
      assert.doesNotMatch(text, /icode-confirm/);
      const finished = await (
        await fetch(base + "/actions/run?runId=" + runId)
      ).json();
      assert.equal(finished.status, "passed");
      const indicators = (await (await fetch(base + "/indicators")).json())
        .indicators;
      assert.equal(
        indicators[0].message,
        "Azure resources are running and cost money",
      );

      // Explicit cancel via the Processes view while the action holds the gate.
      const graceful = await (
        await post("/actions/run", { id: "graceful" })
      ).json();
      await until(async () =>
        (
          await (
            await fetch(base + "/actions/run?runId=" + graceful.runId)
          ).json()
        ).output.includes("working"),
      );
      const actionProcess = (
        await (await fetch(base + "/processes")).json()
      ).processes.find((p) => p.kind === "action");
      assert.equal(
        (await post("/processes/stop", { id: actionProcess.id })).status,
        200,
      );
      await until(
        async () =>
          (
            await (
              await fetch(base + "/actions/run?runId=" + graceful.runId)
            ).json()
          ).status === "cancelled",
      );
      assert.equal(
        await readFile(join(root, ".cleaned"), "utf8"),
        "yes",
        "SIGINT reached the script first",
      );
      assert.equal(
        (await post("/actions/cancel", { runId: graceful.runId })).status,
        400,
      );

      const { processes } = await (await fetch(base + "/processes")).json();
      const sidecarProcess = processes.find((p) => p.kind === "sidecar");
      assert.equal(sidecarProcess.pid > 0, true);
      assert.ok(Date.parse(sidecarProcess.startedAt));
      const logs = (await (await fetch(base + "/sidecars/logs?name=db")).json())
        .logs;
      assert.ok(logs.length && logs.every((line) => line.startsWith("[db] ")));
      // Port endpoints: only configured preview ports, even with confirmation.
      assert.equal((await fetch(base + "/ports/holder?port=22")).status, 400);
      assert.equal(
        (await post("/ports/free", { port: 22, pid: 1 })).status,
        400,
      );
      const free = await post("/ports/free", {
        port: 22,
        pid: 1,
        confirm: true,
      });
      assert.equal(free.status, 400);
      assert.match((await free.json()).error, /Only configured preview ports/);

      const doctor = await (await fetch(base + "/doctor")).json();
      assert.ok(doctor.checks.some((c) => c.name === "Course dependencies"));

      // Editor launch: traversal and symlinks refused; reference variants allowed.
      assert.ok(
        (await (await fetch(base + "/editors")).json()).editors.length >= 5,
      );
      assert.equal(
        (await post("/editor/launch", { id: "01", name: "../course.json" }))
          .status,
        400,
      );
      assert.equal((await post("/select", { id: "01" })).status, 200);
      const playground = join(root, ".workshop", "playgrounds", "01");
      let symlinked = true;
      try {
        await symlink(
          join(root, "course.json"),
          join(playground, "linked.mjs"),
        );
      } catch {
        symlinked = false;
      }
      if (symlinked)
        assert.equal(
          (await post("/editor/launch", { id: "01", name: "linked.mjs" }))
            .status,
          400,
        );
      const launched = await post("/editor/launch", {
        id: "01",
        name: "index.mjs",
        variant: "solution",
        line: 3,
      });
      assert.equal(launched.status, 200, await launched.clone().text());
      const args = JSON.parse(
        await until(() => readFile(editorLog, "utf8").catch(() => "")),
      );
      assert.deepEqual(args, [
        join(root, "exercises", "01", "solution", "index.mjs"),
      ]);

      // Live reload over server-sent events; the endpoint never creates playgrounds.
      await rm(join(root, ".workshop", "playgrounds", "02"), {
        recursive: true,
        force: true,
      });
      assert.equal((await fetch(base + "/events?id=02")).status, 404);
      const controller = new AbortController();
      const events = await fetch(base + "/events?id=01", {
        signal: controller.signal,
      });
      assert.equal(events.headers.get("content-type"), "text/event-stream");
      const sse = events.body.getReader();
      const decoder = new TextDecoder();
      let stream = "";
      const read = async (pattern) => {
        while (!pattern.test(stream)) {
          const { value, done } = await sse.read();
          if (done) throw new Error("SSE closed: " + stream);
          stream += decoder.decode(value);
        }
      };
      await read(/event: ready/);
      await writeFile(join(playground, "index.mjs"), "export default 2\n");
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
      await until(() => readFile(join(root, "db.pid"), "utf8").catch(() => ""));

      // Shutdown stops sidecars.
      const restartedPid = Number(await readFile(join(root, "db.pid"), "utf8"));
      server.kill("SIGTERM");
      const [code] = await closed;
      assert.equal(code, 0, log());
      if (process.platform !== "win32")
        await until(() => !alive(restartedPid), 5000);
    } finally {
      if (server.exitCode === null && server.signalCode === null)
        server.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "SIGHUP (closed terminal) stops sidecars and running actions",
  { skip: process.platform === "win32", timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    const { base, server, closed, post } = await startServer(root);
    try {
      const sidecarPid = Number(
        await until(() =>
          readFile(join(root, "db.pid"), "utf8").catch(() => ""),
        ),
      );
      const run = await (await post("/actions/run", { id: "sleep" })).json();
      await until(async () =>
        (
          await (await fetch(base + "/actions/run?runId=" + run.runId)).json()
        ).output.includes("sleeping"),
      );
      const actionPid = (
        await (await fetch(base + "/processes")).json()
      ).processes.find((p) => p.kind === "action").pid;
      server.kill("SIGHUP");
      await closed;
      await until(() => !alive(sidecarPid) && !alive(actionPid), 5000);
    } finally {
      if (server.exitCode === null && server.signalCode === null)
        server.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);
