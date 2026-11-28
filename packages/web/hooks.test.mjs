import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  validateHooks,
  splitCommand,
  hookEnvironment,
  resolveHooks,
  runHook,
} from "./hooks.mjs";
import { withPlaygroundHooks } from "./playground-ops.mjs";
import { selectWorkspace, resetWorkspace, workspacePath } from "./workspaces.mjs";
import { listProcesses, stopProcess } from "./processes.mjs";
import { nativeCourse, appsCourse, recorderScript, writeTree } from "./test-support/workspace-course.mjs";
import { APPS_SETTINGS_KEY as DIR, APPS_HOOK_ENV_PREFIX as VAR } from "../core/apps-layout.mjs";

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
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("hook declarations are validated like course actions", () => {
  const scripts = { pre: "node pre.mjs", post: "node post.mjs" };
  assert.deepEqual(validateHooks(undefined, scripts), {});
  const ok = validateHooks({ preSetPlayground: "pre", postSetPlayground: "post", timeoutSeconds: 5 }, scripts);
  assert.equal(ok.preSetPlayground.script, "pre");
  assert.equal(ok.timeoutSeconds, 5);
  assert.throws(() => validateHooks({ onEverything: "pre" }, scripts), /Unknown hook/);
  assert.throws(() => validateHooks({ preSetPlayground: "--eval=1" }, scripts), /Invalid script name/);
  assert.throws(() => validateHooks({ preSetPlayground: "node pre.mjs" }, scripts), /Invalid script name/);
  assert.throws(() => validateHooks({ postSetPlayground: "missing" }, scripts), /not in package.json/);
  for (const t of [0, 1801, 1.5, "5"])
    assert.throws(() => validateHooks({ timeoutSeconds: t }, scripts), /timeoutSeconds/);
  assert.throws(() => validateHooks([], scripts), /must be an object/);
});

test("apps-layout postupdate command lines are split without a shell", () => {
  assert.deepEqual(splitCommand("npm run build -- --flag"), ["npm", "run", "build", "--", "--flag"]);
  assert.deepEqual(splitCommand("node scripts/my\\ file.js"), ["node", "scripts/my file.js"]);
  for (const bad of ["npm run a && rm -rf /", "node a.js | tee", "echo $HOME", "a; b", "a `b`", "", "x\ny"])
    assert.throws(() => splitCommand(bad), /shell|Invalid/);
});

test("hook environment carries resolved booleans, never a Promise", () => {
  const env = hookEnvironment("post-set-playground", {
    operation: "reset",
    step: "01",
    source: { step: "01", variant: "problem" },
    srcDir: "/src",
    destDir: "/dest",
    timestamp: 123,
    wasRunning: true,
    isStillRunning: false,
    restartPlayground: true,
  });
  assert.equal(env[VAR + "IS_STILL_RUNNING"], "false");
  assert.equal(env[VAR + "RESTART_PLAYGROUND"], "true");
  assert.equal(env.ICODE_PLAYGROUND_WAS_RUNNING, "true");
  assert.equal(env.ICODE_PLAYGROUND_SOURCE_VARIANT, "problem");
  assert.ok(!Object.values(env).some((v) => String(v).includes("[object")));
  assert.equal(JSON.parse(env.ICODE_HOOK_CONTEXT).restartPlayground, true);
  // Pre hooks do not get post-only values.
  const pre = hookEnvironment("pre-set-playground", { srcDir: "/s", destDir: "/d", wasRunning: false });
  assert.equal(pre[VAR + "WAS_RUNNING"], "false");
  assert.equal(pre[VAR + "IS_STILL_RUNNING"], undefined);
});

test("native hooks run in order with structured context around a reset", { timeout: 60000 }, async () => {
  const root = await nativeCourse({
    hooks: { preSetPlayground: "hook:pre", postSetPlayground: "hook:post", timeoutSeconds: 30 },
    scripts: { "hook:pre": "node pre.mjs", "hook:post": "node post.mjs" },
    files: { "pre.mjs": recorderScript("pre"), "post.mjs": recorderScript("post") },
  });
  try {
    await selectWorkspace(root, "01");
    await writeFile(join(workspacePath(root, "01"), "index.mjs"), "learner work\n");
    const result = await withPlaygroundHooks(
      root,
      "01",
      { operation: "reset", source: { step: "01", variant: "problem" }, srcDir: join(root, "exercises/01/problem") },
      async () => {
        await appendFile(join(root, "order.log"), "change\n");
        return resetWorkspace(root, "01");
      },
    );
    assert.deepEqual((await readFile(join(root, "order.log"), "utf8")).trim().split("\n"), ["pre", "change", "post"]);
    assert.deepEqual(result.hooks.map((h) => [h.hook, h.status]), [["pre-set-playground", "passed"], ["post-set-playground", "passed"]]);
    assert.match(result.hooks[1].output, /hook post ran/);
    const post = await readJson(join(root, "post.json"));
    const context = JSON.parse(post.ICODE_HOOK_CONTEXT);
    assert.equal(context.operation, "reset");
    assert.equal(context.step, "01");
    assert.equal(context.wasRunning, false);
    assert.equal(context.isStillRunning, false);
    assert.equal(post[VAR + "IS_STILL_RUNNING"], "false");
    assert.equal(post.ICODE_HOOK, "post-set-playground");
    assert.equal(post.ICODE_PLAYGROUND_DEST_DIR, workspacePath(root, "01"));
    assert.ok(result.saved?.savedId, "previous playground saved automatically");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failing pre hook aborts and leaves the playground untouched; a failing post hook is reported", { timeout: 60000 }, async () => {
  const root = await nativeCourse({
    hooks: { preSetPlayground: "fail" },
    scripts: { fail: "node fail.mjs", post: "node fail.mjs" },
    files: { "fail.mjs": 'console.error("refusing"); process.exit(4);\n' },
  });
  try {
    await selectWorkspace(root, "01");
    const file = join(workspacePath(root, "01"), "index.mjs");
    await writeFile(file, "learner work\n");
    let changed = false;
    await assert.rejects(
      withPlaygroundHooks(root, "01", { operation: "reset", source: { step: "01", variant: "problem" } }, async () => {
        changed = true;
      }),
      (e) => /pre-set-playground hook failed/.test(e.message) && e.hooks[0].exitCode === 4 && /refusing/.test(e.hooks[0].output),
    );
    assert.equal(changed, false);
    assert.equal(await readFile(file, "utf8"), "learner work\n");
    await writeFile(join(root, "course.json"), JSON.stringify({ schemaVersion: 1, title: "x", hooks: { postSetPlayground: "post" } }));
    const result = await withPlaygroundHooks(root, "01", { operation: "reset", source: { step: "01", variant: "problem" } }, () => resetWorkspace(root, "01"));
    assert.equal(result.hooks[0].status, "failed");
    assert.notEqual(await readFile(file, "utf8"), "learner work\n", "post failure does not roll back");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a hook that never exits is killed with its whole process tree at the timeout", { timeout: 60000 }, async () => {
  const root = await nativeCourse({
    hooks: { preSetPlayground: "hang", timeoutSeconds: 1 },
    scripts: { hang: "node hang.mjs" },
    files: {
      "hang.mjs": `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync("grandchild.pid", String(child.pid));
process.on("SIGTERM", () => {}); // ignores polite termination
setInterval(() => {}, 1000);
`,
    },
  });
  try {
    const hooks = await resolveHooks(root);
    const started = Date.now();
    const result = await runHook(root, hooks.preSetPlayground, { name: "pre-set-playground", timeoutSeconds: 1 });
    assert.equal(result.status, "timeout");
    assert.match(result.output, /timed out after 1s/);
    assert.ok(Date.now() - started < 15000, "returned promptly");
    const pid = Number(await readFile(join(root, "grandchild.pid"), "utf8"));
    await until(() => !alive(pid), 10000);
    assert.equal(listProcesses().filter((p) => p.kind === "hook").length, 0, "unregistered after exit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a running hook is listed in Processes and can be stopped there", { timeout: 60000 }, async () => {
  const root = await nativeCourse({
    hooks: { postUpdate: "hang" },
    scripts: { hang: "node hang.mjs" },
    files: {
      "hang.mjs": `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync("child.pid", String(child.pid));
setInterval(() => {}, 1000);
`,
    },
  });
  try {
    const hooks = await resolveHooks(root);
    let processId;
    const running = runHook(root, hooks.postUpdate, { name: "post-update", timeoutSeconds: 120, onSpawn: (id) => (processId = id) });
    await until(() => processId);
    const entry = listProcesses().find((p) => p.id === processId);
    assert.equal(entry.kind, "hook");
    assert.match(entry.label, /post-update/);
    const pid = Number(await until(() => readFile(join(root, "child.pid"), "utf8").catch(() => "")));
    await stopProcess(processId);
    assert.equal((await running).status, "stopped");
    await until(() => !alive(pid), 10000); // the whole tree, not just the leader
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("apps layout: per-app hook files win over root ones; learner directories are never trusted", { timeout: 60000 }, async () => {
  const root = await appsCourse({
    pkg: { [DIR]: { scripts: { postupdate: "node scripts/after.js --done" } } },
    files: {
      [`${DIR}/pre-set-playground.js`]: recorderScript("root-pre"),
      [`${DIR}/post-set-playground.js`]: recorderScript("root-post"),
      [`exercises/01.basics/01.solution.start/${DIR}/post-set-playground.js`]: recorderScript("app-post"),
      "scripts/after.js": "console.log('after ' + process.argv.slice(2).join(' '));\n",
    },
  });
  try {
    const app = join(root, "exercises/01.basics/01.solution.start");
    const hooks = await resolveHooks(root, { srcDir: app });
    assert.equal(hooks.postSetPlayground.file, join(app, DIR, "post-set-playground.js"));
    assert.equal(hooks.preSetPlayground.file, join(root, DIR, "pre-set-playground.js"));
    assert.deepEqual(hooks.postUpdate.argv, ["node", "scripts/after.js", "--done"]);
    const update = await runHook(root, hooks.postUpdate, { name: "post-update" });
    assert.equal(update.status, "passed");
    assert.match(update.output, /after --done/);
    // A playground that contains a hook file does not get it executed.
    await selectWorkspace(root, "01");
    await writeTree(workspacePath(root, "01"), { [`${DIR}/post-set-playground.js`]: recorderScript("learner") });
    const result = await withPlaygroundHooks(
      root,
      "01",
      { operation: "replace", source: { step: "01", variant: "playground" }, srcDir: workspacePath(root, "01") },
      async () => ({}),
    );
    assert.deepEqual(result.hooks.map((h) => h.label), [`node ${DIR}/pre-set-playground.js`, `node ${DIR}/post-set-playground.js`]);
    const order = (await readFile(join(root, "order.log"), "utf8")).trim().split("\n");
    assert.deepEqual(order, ["root-pre", "root-post"]);
    const env = await readJson(join(root, "root-post.json"));
    assert.equal(env[VAR + "IS_STILL_RUNNING"], "false");
    assert.equal(env[VAR + "SRC_DIR"], workspacePath(root, "01"));
    await writeFile(join(root, "package.json"), JSON.stringify({ [DIR]: { scripts: { postupdate: "npm run x && rm -rf ." } } }));
    await assert.rejects(resolveHooks(root), /shell syntax/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symlinked hook file is refused, never run", { skip: process.platform === "win32" }, async () => {
  const { symlink } = await import("node:fs/promises");
  const root = await appsCourse({ files: { "real/pre.js": recorderScript("linked") } });
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, DIR));
    await symlink(join(root, "real/pre.js"), join(root, DIR, "pre-set-playground.js"));
    await assert.rejects(resolveHooks(root), /Symlinks are not supported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
