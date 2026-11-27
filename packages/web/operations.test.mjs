import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateOperations,
  validateIndicatorPath,
  protocolFilter,
  courseOperations,
  indicatorStatus,
  runAction,
  startAction,
  subscribeAction,
  actionRun,
  sendActionInput,
  cancelAction,
  currentAction,
  ACTION_OUTPUT_TAIL,
} from "./operations.mjs";
import { listProcesses } from "./processes.mjs";
import { operationsCourse } from "./test-support/operations-course.mjs";

const until = async (check, ms = 15000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Condition not met in time");
};
async function editManifest(root, edit) {
  const path = join(root, "course.json");
  const course = JSON.parse(await readFile(path, "utf8"));
  edit(course);
  await writeFile(path, JSON.stringify(course));
}

test("operations are validated against package scripts", () => {
  const scripts = { deploy: "x", db: "y", "--workspaces": "z" };
  const valid = validateOperations(
    {
      actions: [{ id: "deploy", label: "Deploy", script: "deploy" }],
      indicators: [{ path: ".workshop/deployed.json", message: "Running" }],
      sidecars: { db: { script: "db" } },
    },
    scripts,
  );
  assert.equal(valid.actions[0].destructive, false);
  assert.equal(valid.actions[0].cancelGraceSeconds, 30);
  assert.equal(valid.indicators[0].level, "warning");
  assert.deepEqual(valid.sidecars, [{ name: "db", script: "db" }]);
  for (const course of [
    { actions: [{ id: "x", label: "X", script: "rm -rf /" }] },
    { actions: [{ id: "x", label: "X", script: "missing" }] },
    { actions: [{ id: "x", label: "X", script: "constructor" }] },
    { actions: [{ id: "x", label: "X", script: "--workspaces" }] },
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
    {
      actions: [
        { id: "x", label: "X", script: "deploy", cancelGraceSeconds: 0 },
      ],
    },
    {
      actions: [
        { id: "x", label: "X", script: "deploy", cancelGraceSeconds: 1.5 },
      ],
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

test("protocol lines need the run token, are hidden, and partial output is shown at once", () => {
  const shown = [],
    prompts = [];
  const filter = protocolFilter(
    "tok",
    (type, text) => shown.push(text),
    (confirm) => prompts.push(confirm),
  );
  filter.push("stdout", "Progress: ");
  assert.deepEqual(shown, ["Progress: "]);
  filter.push("stdout", "50%\n::icode-");
  filter.push(
    "stdout",
    'confirm:tok::{"expected":"yes","message":"Sure?"}\nafter',
  );
  filter.push("stdout", " ::icode-confirm:tok::{}\n");
  filter.push("stderr", "::icode-confirm:tok::not json\n");
  filter.push("stderr", '::icode-confirm::{"expected":"forged"}\n');
  filter.push("stderr", '::icode-confirm:other::{"expected":"forged"}\n');
  filter.push("stderr", '::icode-confirm:tok::{"expected":"a\u202eb"}\n');
  filter.push(
    "stderr",
    '::icode-confirm:tok::{"expected":"ok","message":"x\u0007"}\n',
  );
  filter.push("stderr", '::icode-confirm:tok::{"expected":"err-stream"}\n');
  filter.flush();
  assert.deepEqual(prompts, [
    { expected: "yes", message: "Sure?" },
    { expected: "err-stream", message: "" },
  ]);
  assert.equal(
    shown.join(""),
    "Progress: 50%\nafter ::icode-confirm:tok::{}\n[invalid confirmation request ignored]\n" +
      "[ignored confirmation request without this run's token]\n".repeat(2) +
      "[invalid confirmation request ignored]\n".repeat(2),
  );
});

test("an unterminated huge line starting like the protocol does not buffer forever", () => {
  const shown = [];
  const filter = protocolFilter(
    "t",
    (type, text) => shown.push(text),
    () => {},
  );
  filter.push("stdout", "::icode-confirm" + "y".repeat(70 * 1024));
  assert.equal(shown.join("").length, 15 + 70 * 1024);
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
        ["deploy", "teardown", "sleep", "noisy", "spoof", "graceful"],
      );
      assert.deepEqual((await indicatorStatus(root)).indicators, []);
      const events = [];
      const result = await runAction(root, "deploy", {
        emit: (event) => {
          events.push(event);
          if (event.type === "confirm") {
            const { runId } = currentAction();
            assert.equal(currentAction().awaitingConfirmation, true);
            // Only the exact text or an empty cancel is accepted.
            assert.throws(
              () => sendActionInput(runId, "a\nb"),
              /does not match/,
            );
            assert.throws(
              () => sendActionInput(runId, "deploy-pro"),
              /does not match/,
            );
            assert.equal(actionRun(runId).status, "running");
            sendActionInput(runId, event.expected);
            assert.throws(
              () => sendActionInput(runId, event.expected),
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
      assert.equal(actionRun(result.runId).status, "passed");

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
  "confirmation still works after more than 2 MB of output; retained output is a marked tail",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    try {
      let size = 0;
      let confirmed = false;
      const running = runAction(root, "noisy", {
        emit: (event) => {
          if (event.text) size += event.text.length;
          if (event.type === "confirm") {
            confirmed = true;
            sendActionInput(currentAction().runId, "go");
          }
        },
      });
      // Fail fast (instead of hanging on stdin) if the prompt is ever lost.
      let watchdog;
      const result = await Promise.race([
        running,
        new Promise((_, reject) => {
          watchdog = setTimeout(async () => {
            const active = currentAction();
            if (active)
              await cancelAction(active.runId, { graceMs: 100 }).catch(
                () => {},
              );
            reject(
              new Error(
                "No confirmation prompt after " +
                  size +
                  " characters of output",
              ),
            );
          }, 20000);
        }),
      ]).finally(() => clearTimeout(watchdog));
      assert.ok(size > 2_100_000, String(size));
      assert.equal(confirmed, true);
      assert.equal(result.status, "passed");
      const run = actionRun(result.runId);
      assert.equal(run.truncated, true);
      assert.ok(run.output.startsWith("[earlier output truncated]\n"));
      assert.ok(run.output.length <= ACTION_OUTPUT_TAIL + 100);
      assert.match(run.output, /answer=go/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "forged prompts are ignored; a tokened prompt on stderr from a grandchild works",
  { timeout: 30000 },
  async () => {
    const root = await operationsCourse();
    try {
      const prompts = [];
      let text = "";
      const result = await runAction(root, "spoof", {
        emit: (event) => {
          if (event.text) text += event.text;
          if (event.type === "confirm") {
            prompts.push(event.expected);
            sendActionInput(currentAction().runId, event.expected);
          }
        },
      });
      assert.deepEqual(prompts, ["real"]);
      assert.equal(result.status, "passed");
      assert.match(text, /answer=real/);
      assert.equal(
        text.match(/ignored confirmation request without this run's token/g)
          .length,
        2,
      );
      assert.doesNotMatch(text, /forged/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "runs are detached from followers; only one runs; cancel is graceful (SIGINT first)",
  { timeout: 60000 },
  async () => {
    const root = await operationsCourse();
    try {
      const started = await startAction(root, "graceful");
      // A follower that goes away (closed tab) does not affect the run.
      const follower = subscribeAction(started.runId, () => {});
      await until(() => actionRun(started.runId).output.includes("working"));
      follower.unsubscribe();
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(currentAction().status, "running");
      const reattached = subscribeAction(started.runId, () => {});
      assert.match(reattached.snapshot.output, /working/);
      reattached.unsubscribe();
      assert.equal(
        listProcesses().filter((p) => p.kind === "action").length,
        1,
      );
      await assert.rejects(startAction(root, "teardown"), /already running/);
      // Indicators report the running action.
      assert.match(
        (await indicatorStatus(root)).indicators.at(-1).message,
        /Graceful.*running/,
      );
      await cancelAction(started.runId);
      assert.equal(actionRun(started.runId).status, "cancelled");
      assert.equal(await readFile(join(root, ".cleaned"), "utf8"), "yes");
      assert.equal(
        listProcesses().filter((p) => p.kind === "action").length,
        0,
      );

      // A script that ignores SIGINT is force-stopped after its grace period.
      const sleeper = await startAction(root, "sleep");
      await until(() => actionRun(sleeper.runId).output.includes("sleeping"));
      const before = Date.now();
      await cancelAction(sleeper.runId);
      assert.equal(actionRun(sleeper.runId).status, "cancelled");
      assert.ok(Date.now() - before < 10000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("indicators fail closed when the manifest or an indicator cannot be checked", async (t) => {
  const root = await operationsCourse();
  try {
    // A broken action does not hide indicators.
    await editManifest(root, (c) => (c.actions[0].script = "renamed-away"));
    await writeFile(join(root, ".deployed"), "yes");
    const withBrokenAction = await indicatorStatus(root);
    assert.equal(withBrokenAction.indicators.length, 1);
    assert.equal(withBrokenAction.indicators[0].level, "danger");
    assert.match(withBrokenAction.indicators[0].message, /cost money/);
    // A broken indicator list yields an explicit unknown status.
    await editManifest(
      root,
      (c) => (c.indicators = [{ path: "../x", message: "m" }]),
    );
    const broken = await indicatorStatus(root);
    assert.match(broken.indicators[0].message, /Cost status unknown/);
    assert.equal(broken.indicators[0].level, "danger");
    await writeFile(join(root, "course.json"), "{ not json");
    assert.match(
      (await indicatorStatus(root)).indicators[0].message,
      /Cost status unknown/,
    );
    // Symlinked indicator path: refused and reported, not silently hidden.
    try {
      await symlink(tmpdir(), join(root, "link"));
    } catch {
      t.diagnostic("symlinks unavailable");
      return;
    }
    await writeFile(
      join(root, "course.json"),
      JSON.stringify({
        schemaVersion: 1,
        indicators: [{ path: "link/anything", message: "m" }],
      }),
    );
    const linked = await indicatorStatus(root);
    assert.match(linked.indicators[0].message, /Cost status unknown.*Symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "two concurrent starts cannot both run (guard after the manifest read)",
  { timeout: 30000 },
  async () => {
    const root = await operationsCourse();
    try {
      const results = await Promise.allSettled([
        startAction(root, "sleep"),
        startAction(root, "sleep"),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [
        "fulfilled",
        "rejected",
      ]);
      assert.match(
        results.find((r) => r.status === "rejected").reason.message,
        /already running/,
      );
      assert.equal(
        listProcesses().filter((p) => p.kind === "action").length,
        1,
      );
      await cancelAction(currentAction().runId, { graceMs: 200 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("prompts preceded by ANSI colour codes are still detected, also when split", () => {
  const shown = [],
    prompts = [];
  const filter = protocolFilter(
    "tok",
    (type, text) => shown.push(text),
    (c) => prompts.push(c.expected),
  );
  filter.push("stdout", '\x1b[0m::icode-confirm:tok::{"expected":"a"}\n');
  filter.push("stdout", "\x1b");
  filter.push("stdout", "[1;32m\x1b[0m::icode-conf");
  filter.push("stdout", 'irm:tok::{"expected":"b"}\n');
  filter.push("stdout", '\x1b[31m::icode-confirm:wrong::{"expected":"c"}\n');
  filter.push("stdout", "\x1b[32mcoloured text\n");
  filter.flush();
  assert.deepEqual(prompts, ["a", "b"]);
  const text = shown.join("");
  assert.doesNotMatch(text, /tok::/);
  assert.match(text, /without this run's token/);
  assert.match(text, /\x1b\[32mcoloured text\n/);
});
