import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateOperations,
  validateIndicatorPath,
  protocolFilter,
  courseOperations,
  indicatorStatus,
  runAction,
  sendActionInput,
  cancelAction,
  currentAction,
} from "./operations.mjs";
import { listProcesses } from "./processes.mjs";
import { operationsCourse } from "./test-support/operations-course.mjs";

test("operations are validated against package scripts", () => {
  const scripts = { deploy: "x", db: "y" };
  const valid = validateOperations(
    {
      actions: [{ id: "deploy", label: "Deploy", script: "deploy" }],
      indicators: [{ path: ".workshop/deployed.json", message: "Running" }],
      sidecars: { db: { script: "db" } },
    },
    scripts,
  );
  assert.equal(valid.actions[0].destructive, false);
  assert.equal(valid.indicators[0].level, "warning");
  assert.deepEqual(valid.sidecars, [{ name: "db", script: "db" }]);
  for (const course of [
    { actions: [{ id: "x", label: "X", script: "rm -rf /" }] },
    { actions: [{ id: "x", label: "X", script: "missing" }] },
    { actions: [{ id: "x", label: "X", script: "constructor" }] },
    { actions: [{ id: "../x", label: "X", script: "deploy" }] },
    {
      actions: [
        { id: "x", label: "X", script: "deploy" },
        { id: "x", label: "Y", script: "deploy" },
      ],
    },
    { actions: [{ id: "x", label: "", script: "deploy" }] },
    {
      actions: [{ id: "x", label: "X", script: "deploy", destructive: "yes" }],
    },
    { actions: "deploy" },
    { indicators: [{ path: "a", message: "m", level: "loud" }] },
    { sidecars: { db: { script: "node server.js" } } },
    { sidecars: { "bad name": { script: "db" } } },
    { sidecars: [] },
  ])
    assert.throws(
      () => validateOperations(course, scripts),
      undefined,
      JSON.stringify(course),
    );
  for (const path of [
    "../outside",
    "/etc/passwd",
    "a/../../b",
    "C:/x",
    "a\\b",
    "",
    "./a",
    "a//b",
  ])
    assert.throws(
      () => validateIndicatorPath(path),
      /Invalid indicator path/,
      path,
    );
  assert.equal(
    validateIndicatorPath(".workshop/cost.flag"),
    ".workshop/cost.flag",
  );
});

test("protocol lines are hidden, partial output is shown immediately", () => {
  const shown = [],
    prompts = [];
  const filter = protocolFilter(
    (type, text) => shown.push(text),
    (confirm) => prompts.push(confirm),
  );
  filter.push("stdout", "Progress: ");
  assert.deepEqual(shown, ["Progress: "]);
  filter.push("stdout", "50%\n::icode-");
  filter.push("stdout", 'confirm::{"expected":"yes","message":"Sure?"}\nafter');
  filter.push("stdout", " ::icode-confirm::{}\n");
  filter.push("stderr", "::icode-confirm::not json\n");
  filter.flush();
  assert.deepEqual(prompts, [{ expected: "yes", message: "Sure?" }]);
  const output = shown.join("");
  assert.equal(
    output,
    "Progress: 50%\nafter ::icode-confirm::{}\n[invalid confirmation request ignored]\n",
  );
});

test(
  "course actions run in the course root with typed confirmation",
  { timeout: 30000 },
  async () => {
    const root = await operationsCourse();
    try {
      const ops = await courseOperations(root);
      assert.deepEqual(
        ops.actions.map((a) => a.id),
        ["deploy", "teardown", "sleep"],
      );
      assert.deepEqual((await indicatorStatus(root)).indicators, []);
      const events = [];
      const result = await runAction(root, "deploy", {
        emit: (event) => {
          events.push(event);
          if (event.type === "confirm") {
            assert.throws(
              () => sendActionInput(currentAction().runId, "a\nb"),
              /Invalid/,
            );
            assert.equal(currentAction().awaitingConfirmation, true);
            sendActionInput(currentAction().runId, event.expected);
            assert.throws(
              () => sendActionInput(currentAction().runId, "again"),
              /not waiting/,
            );
          }
        },
      });
      const output = events
        .filter((e) => e.text)
        .map((e) => e.text)
        .join("");
      assert.equal(result.status, "passed", output);
      assert.match(output, /ICODE_ACTION=1/);
      assert.match(output, /deployed/);
      assert.doesNotMatch(output, /icode-confirm/);
      assert.equal(
        events.find((e) => e.type === "confirm").message,
        "Type deploy-prod to create paid resources",
      );
      assert.equal(await readFile(join(root, ".deployed"), "utf8"), "yes");
      assert.equal((await indicatorStatus(root)).indicators[0].level, "danger");
      assert.equal(currentAction(), null);

      // Cancel from the dialog sends an empty line; the script refuses.
      const cancelled = await runAction(root, "deploy", {
        emit: (event) => {
          if (event.type === "confirm")
            sendActionInput(currentAction().runId, "");
        },
      });
      assert.equal(cancelled.status, "failed");
      assert.equal(cancelled.exitCode, 3);

      assert.equal((await runAction(root, "teardown")).status, "passed");
      assert.deepEqual((await indicatorStatus(root)).indicators, []);
      await assert.rejects(runAction(root, "nope"), /Unknown course action/);
      assert.throws(() => sendActionInput("x", "y"), /No matching action/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "only one action runs at a time and cancellation stops it",
  { timeout: 30000 },
  async () => {
    const root = await operationsCourse();
    try {
      let started;
      const ready = new Promise((resolve) => (started = resolve));
      const running = runAction(root, "sleep", {
        emit: (event) => {
          if (event.text?.includes("sleeping")) started();
        },
      });
      await ready;
      assert.equal(
        listProcesses().filter((p) => p.kind === "action").length,
        1,
      );
      await assert.rejects(runAction(root, "teardown"), /already running/);
      await cancelAction(currentAction().runId);
      const result = await running;
      assert.equal(result.status, "cancelled");
      assert.equal(
        listProcesses().filter((p) => p.kind === "action").length,
        0,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("indicator paths cannot escape through symlinks", async (t) => {
  const root = await operationsCourse();
  try {
    const { symlink } = await import("node:fs/promises");
    try {
      await symlink(tmpdir(), join(root, "link"));
    } catch {
      t.skip("symlinks unavailable");
      return;
    }
    const course = JSON.parse(
      await readFile(join(root, "course.json"), "utf8"),
    );
    course.indicators = [{ path: "link/anything", message: "m" }];
    await writeFile(join(root, "course.json"), JSON.stringify(course));
    await assert.rejects(indicatorStatus(root), /Symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
