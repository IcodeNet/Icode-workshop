import test from "node:test";
import assert from "node:assert/strict";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startSidecars,
  listSidecars,
  sidecarLogs,
  restartSidecar,
  stopSidecar,
  stopAllSidecars,
  SIDECAR_LOG_LINES,
} from "./sidecars.mjs";
import { listProcesses, stopProcess } from "./processes.mjs";
import { operationsCourse } from "./test-support/operations-course.mjs";

const until = async (check, ms = 10000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Condition not met in time");
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test(
  "sidecars start, keep prefixed bounded logs, restart and stop",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    try {
      await startSidecars(root);
      const [sidecar] = listSidecars();
      assert.equal(sidecar.name, "db");
      assert.equal(sidecar.status, "running");
      assert.ok(
        listProcesses().some(
          (p) => p.kind === "sidecar" && p.label === "Sidecar: db",
        ),
      );
      await until(() =>
        sidecarLogs("db").logs.some((line) => line.includes("ready")),
      );
      const { logs } = sidecarLogs("db");
      assert.ok(
        logs.every((line) => line.startsWith("[db] ")),
        logs.join("\n"),
      );
      assert.ok(
        logs.some((line) => line.includes("\x1b[36mready")),
        "ANSI kept for rendering",
      );
      await until(
        () => sidecarLogs("db").logs.length >= SIDECAR_LOG_LINES,
        30000,
      );
      assert.equal(sidecarLogs("db").logs.length, SIDECAR_LOG_LINES);
      const pid = Number(
        await until(() =>
          readFile(join(root, "db.pid"), "utf8").catch(() => ""),
        ),
      );
      assert.ok(alive(pid));

      // Starting again does not duplicate a running sidecar.
      await startSidecars(root);
      assert.equal(
        listProcesses().filter((p) => p.kind === "sidecar").length,
        1,
      );

      await rm(join(root, "db.pid"));
      await restartSidecar(root, "db");
      const restartedPid = Number(
        await until(() =>
          readFile(join(root, "db.pid"), "utf8").catch(() => ""),
        ),
      );
      assert.notEqual(restartedPid, pid);
      await until(() => !alive(pid));
      assert.ok(
        sidecarLogs("db").logs.some((line) => line === "[db] restarting"),
      );

      await stopSidecar("db");
      assert.equal(listSidecars()[0].status, "stopped");
      await until(() => !alive(restartedPid));
      assert.equal(
        listProcesses().filter((p) => p.kind === "sidecar").length,
        0,
      );

      // The Processes view can stop sidecars too.
      await restartSidecar(root, "db");
      const entry = await until(() =>
        listProcesses().find((p) => p.kind === "sidecar"),
      );
      assert.ok(entry.pid > 0);
      await stopProcess(entry.id);
      assert.equal(listSidecars()[0].status, "stopped");
      await assert.rejects(restartSidecar(root, "unknown"), /Unknown sidecar/);
      assert.throws(() => sidecarLogs("unknown"), /Unknown sidecar/);
    } finally {
      await stopAllSidecars();
      await rm(root, { recursive: true, force: true });
    }
  },
);
