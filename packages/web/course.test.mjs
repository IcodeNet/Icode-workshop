import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  courseConfig,
  readProgress,
  updateProgress,
  validateMedia,
} from "./course.mjs";
import {
  selectWorkspace,
  replaceWorkspace,
  listBackups,
} from "./workspaces.mjs";
import { writeProjectFile, readProjectFile } from "./files.mjs";
import { executionWorkspace } from "./variants.mjs";
import { testLab } from "./runtime.mjs";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "icode-course-"));
  await cp("examples", root, {
    recursive: true,
    filter: (path) => !path.includes(".workshop"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("course ordering is validated; progress persists across reads and concurrent changes", async (t) => {
  const root = await fixture(t);
  assert.deepEqual((await courseConfig(root)).ids, ["01", "02", "03"]);
  await Promise.all([
    updateProgress(root, "01", true),
    updateProgress(root, "02", true),
  ]);
  assert.deepEqual((await readProgress(root)).completed, ["01", "02"]);
  await updateProgress(root, "01", false);
  assert.deepEqual((await readProgress(root)).completed, ["02"]);
  await assert.rejects(updateProgress(root, "99", true));
  await writeFile(
    join(root, "course.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Broken",
      modules: [{ id: "m", title: "M", steps: ["01", "01"] }],
    }),
  );
  await assert.rejects(courseConfig(root), /duplicate/);
});
test("reference tests pass in disposable copies and emit live output without mutating source", async (t) => {
  const root = await fixture(t),
    before = await readProjectFile(root, "01", "index.mjs", "solution");
  const workspace = await executionWorkspace(root, "01", "solution");
  const events = [];
  try {
    const result = await testLab(root, "01", {
      workspaceRoot: workspace.path,
      emit: (event) => events.push(event.text),
    });
    assert.equal(result.passed, true);
    assert.ok(events.length);
    await writeFile(join(workspace.path, "index.mjs"), "// mutation");
    assert.equal(
      await readProjectFile(root, "01", "index.mjs", "solution"),
      before,
    );
  } finally {
    await workspace.cleanup();
  }
  await assert.rejects(readFile(join(workspace.path, "index.mjs")), /ENOENT/);
  await assert.rejects(executionWorkspace(root, "01", "../../"), /variant/);
});
test("workspace replacement backs up edits, restores them and rejects invalid backup paths", async (t) => {
  const root = await fixture(t);
  await selectWorkspace(root, "01");
  await writeProjectFile(root, "01", "index.mjs", "// learner work");
  await replaceWorkspace(root, "01", { variant: "solution" });
  assert.match(await readProjectFile(root, "01", "index.mjs"), /filter/);
  const [backup] = await listBackups(root, "01");
  await replaceWorkspace(root, "01", { backup });
  assert.equal(
    await readProjectFile(root, "01", "index.mjs"),
    "// learner work",
  );
  await assert.rejects(
    replaceWorkspace(root, "01", { backup: "../escape" }),
    /Unknown backup/,
  );
  await assert.rejects(replaceWorkspace(root, "01", { sourceId: "99" }));
  assert.equal(
    await readProjectFile(root, "01", "index.mjs"),
    "// learner work",
  );
});
test("media allows accessible authored content and rejects executable URL schemes", () => {
  assert.equal(
    validateMedia({
      src: "https://example.com/lesson.mp4",
      transcript: "Lesson",
    }).transcript,
    "Lesson",
  );
  assert.throws(() => validateMedia({ src: "javascript:alert(1)" }), /URL/);
  assert.throws(() => validateMedia({ transcript: {} }), /transcript/);
});

test("CLI validates an external course and shares web playground and progress paths", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const root = await fixture(t);
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["packages/cli/bin.mjs", ...args, "--content", root],
      { encoding: "utf8" },
    );
  assert.equal(run("validate").status, 0);
  assert.equal(run("set", "01").status, 0);
  await writeProjectFile(
    root,
    "01",
    "index.mjs",
    await readProjectFile(root, "01", "index.mjs", "solution"),
  );
  assert.equal(run("test", "01").status, 0);
  await updateProgress(root, "01", true);
  assert.deepEqual(JSON.parse(run("progress").stdout).completed, ["01"]);
  const course = await courseConfig(root);
  assert.equal(course.modules[0].exercises[0].title, "Approval filtering");
});
