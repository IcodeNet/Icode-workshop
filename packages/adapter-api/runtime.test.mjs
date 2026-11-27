import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapterRegistry } from "./index.mjs";
import { nodeAdapter } from "./node-adapter.mjs";
import { createPythonAdapter } from "./python-adapter.mjs";

test("Node adapter executes a real local test", async () => {
  const root = await mkdtemp(join(tmpdir(), "icode-node-"));
  try {
    await writeFile(
      join(root, "example.test.mjs"),
      'import {test} from "node:test"; import {strict as assert} from "node:assert"; test("works",()=>assert.equal(2+2,4))',
    );
    const events = [];
    const registry = createAdapterRegistry();
    registry.register(nodeAdapter);
    const result = await registry.require("node").run("test", {
      workspaceRoot: root,
      emit: (event) => events.push(event),
    });
    assert.equal(result.exitCode, 0);
    assert.ok(Array.isArray(events));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Python adapter reports missing interpreter without throwing from detection", async () => {
  const root = await mkdtemp(join(tmpdir(), "icode-python-"));
  try {
    const adapter = createPythonAdapter({
      executable: "icode-nonexistent-python-executable",
    });
    const registry = createAdapterRegistry();
    registry.register(adapter);
    const diagnostics = await registry
      .require("python")
      .detect({ workspaceRoot: root });
    assert.equal(diagnostics[0].level, "error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed process abort terminates a process that ignores SIGTERM", async () => {
  const { execute } = await import("./node.mjs");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    const result = await execute(
      process.execPath,
      ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},100)'],
      { workspaceRoot: tmpdir(), signal: controller.signal },
    );
    assert.equal(result.aborted, true);
    assert.notEqual(result.exitCode, 0);
  } finally {
    clearTimeout(timer);
  }
});
test("explicit third party loading and author conformance", async () => {
  const { loadAdapters, checkAdapter } = await import("./index.mjs");
  const registry = createAdapterRegistry();
  const adapter = {
    id: "custom",
    apiVersion: 1,
    async detect() {
      return [];
    },
    async prepare() {},
    async run() {
      return { exitCode: 0 };
    },
  };
  await loadAdapters(registry, ["installed-adapter"], async () => ({
    default: adapter,
  }));
  assert.equal(
    (
      await checkAdapter(registry.require("custom"), {
        workspaceRoot: tmpdir(),
      })
    ).result.exitCode,
    0,
  );
  await assert.rejects(
    loadAdapters(registry, ["bad"], async () => ({
      default: { ...adapter, id: "bad", apiVersion: 2 },
    })),
    /Unsupported/,
  );
  assert.deepEqual(registry.list(), ["custom"]);
});

test(
  "cancellation terminates an owned child process tree",
  { timeout: 10000 },
  async () => {
    const { execute } = await import("./node.mjs");
    const controller = new AbortController();
    const script =
      'const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setInterval(()=>{},100)"],{stdio:["ignore",process.stdout,process.stderr]}); console.log("ready"); setInterval(()=>{},100)';
    const result = await execute(process.execPath, ["-e", script], {
      workspaceRoot: tmpdir(),
      signal: controller.signal,
      emit: (event) => {
        if (event.text.includes("ready")) controller.abort();
      },
    });
    assert.equal(result.aborted, true);
  },
);

test("managed process stdin can be piped and written", async () => {
  const { startProcess } = await import("./node.mjs");
  let output = "";
  const session = startProcess(
    process.execPath,
    ["-e", 'process.stdin.once("data",d=>{console.log("got:"+String(d).trim());process.exit(0)})'],
    { workspaceRoot: tmpdir(), stdin: true, emit: (e) => (output += e.text) },
  );
  assert.ok(session.pid > 0);
  assert.equal(session.running, true);
  assert.equal(session.write("hello\n"), true);
  const result = await session.completion;
  assert.equal(result.exitCode, 0);
  assert.match(output, /got:hello/);
  assert.equal(session.running, false);
  assert.equal(session.write("late"), false);
});
test("managed process honours an unlimited output limit and onSpawn", async () => {
  const { execute } = await import("./node.mjs");
  let size = 0, spawned;
  await execute(process.execPath, ["-e", 'process.stdout.write("x".repeat(120000))'], {
    workspaceRoot: tmpdir(),
    outputLimit: Infinity,
    onSpawn: (s) => (spawned = s),
    emit: (e) => (size += e.text.length),
  });
  assert.equal(size, 120000);
  assert.ok(spawned.pid > 0);
});
