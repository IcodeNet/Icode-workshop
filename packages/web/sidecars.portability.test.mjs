// Runs on Linux, macOS and Windows in CI (process-portability job): sidecars
// and actions go through npm, so process-tree cleanup and stdin piping must
// hold on every platform.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSidecars, stopAllSidecars } from "./sidecars.mjs";
import { runAction, sendActionInput, currentAction } from "./operations.mjs";
import { startProcess } from "../adapter-api/node.mjs";
import { operationsCourse } from "./test-support/operations-course.mjs";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Condition not met in time");
};
const pidFile = (root) =>
  until(async () =>
    Number(await readFile(join(root, "db.pid"), "utf8").catch(() => "")),
  );

test(
  "stopping sidecars terminates the script behind npm",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    try {
      await startSidecars(root);
      const pid = await pidFile(root);
      assert.ok(alive(pid));
      await stopAllSidecars();
      await until(() => !alive(pid));
    } finally {
      await stopAllSidecars();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "action confirmation reaches the script through npm stdin",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    try {
      const result = await runAction(root, "deploy", {
        emit: (event) => {
          if (event.type === "confirm")
            sendActionInput(currentAction().runId, event.expected);
        },
      });
      assert.equal(result.status, "passed");
      assert.equal(await readFile(join(root, ".deployed"), "utf8"), "yes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "stopping the workshop server (as CLI start does) stops its sidecars",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    let output = "";
    const server = startProcess(
      process.execPath,
      [fileURLToPath(new URL("./server.mjs", import.meta.url))],
      {
        workspaceRoot: root,
        env: { WORKSHOP_CONTENT: root, WORKSHOP_API_PORT: String(port) },
        emit: (e) => (output += e.text),
      },
    );
    try {
      const pid = await pidFile(root);
      assert.ok(alive(pid), output);
      await server.stop();
      await until(() => !alive(pid));
    } finally {
      await server.stop();
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  },
);
