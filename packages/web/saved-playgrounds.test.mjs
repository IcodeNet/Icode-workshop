import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectWorkspace, workspacePath } from "./workspaces.mjs";
import {
  autoSave,
  deleteSaved,
  listSaved,
  restoreSaved,
  savePlayground,
  savedFilesPath,
  updateSaved,
  validateSavedConfig,
  validateSavedId,
  writePreferences,
} from "./saved-playgrounds.mjs";
import { nativeCourse, writeTree } from "./test-support/workspace-course.mjs";

/** Every file/dir under `dir` (excluding `skip`) → {type, content, mode}. */
async function snapshot(dir, skip = new Set()) {
  const out = {};
  async function walk(current, prefix) {
    for (const item of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(item.name)) continue;
      const rel = prefix + item.name;
      const path = join(current, item.name);
      const info = await lstat(path);
      if (info.isDirectory()) {
        out[rel + "/"] = { type: "dir" };
        await walk(path, rel + "/");
      } else
        out[rel] = {
          type: "file",
          content: (await readFile(path)).toString("base64"),
          mode: process.platform === "win32" ? 0 : info.mode & 0o777,
          mtime: Math.floor(info.mtimeMs / 1000),
        };
    }
  }
  await walk(dir, "");
  return out;
}

test("saved ids are strict; traversal through ids is impossible", async () => {
  const root = await nativeCourse();
  try {
    for (const bad of ["../01", "..", "x", "20261127T101112345Z-abcdef/..", "20261127T101112345Z-ABCDEF", "20261127T101112345Z-abcdef\0", "/etc/passwd", "..\\..\\x", 7, null])
      assert.throws(() => validateSavedId(bad), /Invalid saved playground id/);
    await assert.rejects(savedFilesPath(root, "01", "20261127T101112345Z-abcdef"), /Unknown saved playground/);
    await assert.rejects(savedFilesPath(root, "../01", "20261127T101112345Z-abcdef"), /two digits/);
    await assert.rejects(restoreSaved(root, "01", "../../exercises/01/solution"), /Invalid saved playground id/);
    await assert.rejects(deleteSaved(root, "01", "../../../"), /Invalid saved playground id/);
    // A directory planted with a valid-looking name but no metadata is ignored.
    await mkdir(join(root, ".workshop", "saved-playgrounds", "01", "20261127T101112345Z-abcdef"), { recursive: true });
    assert.deepEqual(await listSaved(root, "01"), []);
    await assert.rejects(savedFilesPath(root, "01", "20261127T101112345Z-abcdef"), /Unknown saved playground/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore is exact: content, binary, dotfiles, empty dirs, modes and times; dependencies carried over", async () => {
  const root = await nativeCourse();
  try {
    await selectWorkspace(root, "01");
    const pg = workspacePath(root, "01");
    await writeTree(pg, {
      ".env": "SECRET=local\n",
      "src/deep/nested.mjs": "export const n = 1;\r\n",
      "data/blob.bin": Buffer.from([0, 1, 2, 255, 0, 10, 13]),
      "node_modules/dep/index.js": "module.exports = 1\n",
    });
    await mkdir(join(pg, "empty", "dir"), { recursive: true });
    if (process.platform !== "win32") await chmod(join(pg, "src/deep/nested.mjs"), 0o755);
    const before = await snapshot(pg, new Set(["node_modules"]));
    const saved = await savePlayground(root, "01", { label: "../../not-a-path ✓" });
    assert.match(saved.savedId, /^\d{8}T\d{9}Z-[0-9a-f]{6}$/);
    assert.equal(saved.label, "../../not-a-path ✓");
    const stored = await savedFilesPath(root, "01", saved.savedId);
    await assert.rejects(lstat(join(stored, "node_modules")), /ENOENT/, "dependencies are not stored");
    // Wreck the playground, then restore.
    await rm(join(pg, "src"), { recursive: true });
    await rm(join(pg, "empty"), { recursive: true });
    await writeFile(join(pg, ".env"), "changed\n");
    await writeFile(join(pg, "new.mjs"), "should disappear\n");
    const restored = await restoreSaved(root, "01", saved.savedId);
    assert.deepEqual(await snapshot(pg, new Set(["node_modules"])), before);
    assert.equal(await readFile(join(pg, "node_modules/dep/index.js"), "utf8"), "module.exports = 1\n", "dependencies carried over");
    assert.ok(restored.previous && (await stat(restored.previous)).isDirectory(), "previous playground kept");
    const [entry] = await listSaved(root, "01");
    assert.equal(entry.files, 6); // index, util, README, .env, nested, blob
    assert.equal(entry.reason, "manual");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("count and size are bounded; pinned saves survive pruning", async () => {
  const root = await nativeCourse({ course: { savedPlaygrounds: { limit: 3, maxMegabytes: 1 } } });
  try {
    await selectWorkspace(root, "01");
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const s = await savePlayground(root, "01", { label: "save " + i });
      ids.push(s.savedId);
      if (i === 0) await updateSaved(root, "01", s.savedId, { pinned: true, label: "keep me" });
    }
    const list = await listSaved(root, "01");
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((s) => s.label), ["save 4", "save 3", "keep me"]);
    assert.equal(list[2].pinned, true);
    await writeFile(join(workspacePath(root, "01"), "big.bin"), Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(savePlayground(root, "01"), /size limit \(1 MB\)/);
    const auto = await autoSave(root, "01", "reset", { step: "01", variant: "problem" });
    assert.match(auto.skipped, /size limit/);
    assert.equal((await listSaved(root, "01")).length, 3);
    for (const bad of [{ limit: 0 }, { limit: 101 }, { maxMegabytes: 0 }, { maxMegabytes: 501 }, { limit: "3" }, []])
      assert.throws(() => validateSavedConfig(bad));
    await assert.rejects(savePlayground(root, "01", { label: "bad\u0000label" }), /printable/);
    await assert.rejects(savePlayground(root, "01", { label: "x".repeat(81) }), /80/);
    await assert.rejects(savePlayground(root, "02"), /no playground/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic saves respect the preference and never throw", async () => {
  const root = await nativeCourse();
  try {
    assert.equal(await autoSave(root, "01", "reset"), null, "no playground yet");
    await selectWorkspace(root, "01");
    assert.ok((await autoSave(root, "01", "reset")).saved.savedId);
    await writePreferences(root, { savePlaygrounds: false });
    assert.equal(await autoSave(root, "01", "reset"), null);
    await assert.rejects(writePreferences(root, { savePlaygrounds: "no" }), /Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlinks (junctions on Windows) in a playground are refused when saving", async () => {
  const root = await nativeCourse();
  try {
    await selectWorkspace(root, "01");
    await symlink(tmpdir(), join(workspacePath(root, "01"), "escape"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(savePlayground(root, "01"), /Symlinks are not supported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Directory link that needs no privileges: a symlink on POSIX, a junction on Windows. */
const linkDir = (target, path) => symlink(target, path, process.platform === "win32" ? "junction" : "dir");

test("nested bin/obj/target/__pycache__/.venv source survives; only node_modules and declared output are left out", async () => {
  const root = await nativeCourse({
    course: { buildOutput: ["/dist/", "**/*.log"] },
    files: { "exercises/02/lab.json": { schemaVersion: 1, runtime: "rust", entry: "src/main.rs", title: "Rust" } },
  });
  try {
    for (const id of ["01", "02"]) await selectWorkspace(root, id);
    const source = {
      "src/bin/tool.rs": "fn main() {}\n",
      "cli/bin/run.mjs": "console.log(1)\n",
      "bin/start.sh": "#!/bin/sh\necho saved\n",
      "obj/model.cs": "class Model {}\n",
      "lib/target/notes.md": "notes\n",
      "pkg/obj/x.cs": "class X {}\n",
      "py/__pycache__/helper.py": "def helper(): pass\n",
      "env/.venv/conf.py": "X = 1\n",
      ".venv/keep.py": "Y = 2\n",
      "web/dist/app.js": "nested dist is source\n",
    };
    const output = {
      "node_modules/dep/index.js": "dep\n",
      "web/node_modules/x/index.js": "x\n",
      "dist/bundle.js": "built\n",
      "logs/run.log": "log\n",
    };
    const pg1 = workspacePath(root, "01");
    await writeTree(pg1, { ...source, ...output });
    const saved = await savePlayground(root, "01");
    const stored = await savedFilesPath(root, "01", saved.savedId);
    for (const rel of Object.keys(source)) assert.equal(await readFile(join(stored, rel), "utf8"), source[rel], rel + " saved");
    for (const rel of Object.keys(output)) await assert.rejects(lstat(join(stored, rel)), /ENOENT/, rel + " left out");
    assert.deepEqual([...saved.excluded].sort(), ["dist", "logs/run.log", "node_modules", "web/node_modules"]);
    // Wreck everything, then restore.
    for (const rel of Object.keys(source)) await writeFile(join(pg1, rel), "changed\n");
    await rm(join(pg1, "src"), { recursive: true });
    await restoreSaved(root, "01", saved.savedId);
    for (const rel of Object.keys(source)) assert.equal(await readFile(join(pg1, rel), "utf8"), source[rel], rel + " restored");
    for (const rel of Object.keys(output)) assert.equal(await readFile(join(pg1, rel), "utf8"), output[rel], rel + " carried over");
    // A runtime adapter's declared output is root-anchored: /target/ only.
    const pg2 = workspacePath(root, "02");
    await writeTree(pg2, { "target/debug/app": "binary\n", "src/target/mod.rs": "mod t;\n" });
    const rust = await savePlayground(root, "02");
    const rustFiles = await savedFilesPath(root, "02", rust.savedId);
    assert.equal(await readFile(join(rustFiles, "src/target/mod.rs"), "utf8"), "mod t;\n");
    await assert.rejects(lstat(join(rustFiles, "target")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declared output must be anchored or an explicit glob", async () => {
  const { validateOutputPatterns } = await import("./exclusions.mjs");
  assert.deepEqual(validateOutputPatterns(["/dist/", "**/*.pyc"]), ["/dist/", "**/*.pyc"]);
  for (const bad of ["bin", "bin/", "target", "!x", "/../x", "a\\b", ""]) assert.throws(() => validateOutputPatterns([bad]), /Invalid/);
  const { validateAdapter } = await import("../adapter-api/index.mjs");
  const adapter = { id: "x", apiVersion: 1, detect() {}, prepare() {}, run() {} };
  assert.throws(() => validateAdapter({ ...adapter, outputs: ["bin"] }), /root-anchored/);
  assert.ok(validateAdapter({ ...adapter, outputs: ["/bin/"] }));
});

test("a linked saved-playgrounds folder is refused", async () => {
  const root = await nativeCourse();
  const outside = await mkdtemp(join(tmpdir(), "icode-outside-"));
  try {
    await selectWorkspace(root, "01");
    await linkDir(outside, join(root, ".workshop", "saved-playgrounds"));
    await assert.rejects(savePlayground(root, "01"), /Symlinks are not supported/);
    await assert.rejects(listSaved(root, "01"), /Symlinks are not supported/);
    assert.deepEqual(await readdir(outside), [], "nothing written through the link");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("crashed partial saves are cleaned up", async () => {
  const root = await nativeCourse();
  try {
    await selectWorkspace(root, "01");
    const stale = join(root, ".workshop", "saved-playgrounds", "01", "20260101T000000000Z-abcdef.partial");
    await mkdir(join(stale, "files"), { recursive: true });
    await savePlayground(root, "01");
    await assert.rejects(lstat(stale), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reset backups are bounded by count and size, oldest first, newest always kept", async () => {
  const { resetWorkspace, listBackups, validateBackupConfig } = await import("./workspaces.mjs");
  const root = await nativeCourse({ course: { backups: { limit: 2, maxMegabytes: 1 } } });
  try {
    await selectWorkspace(root, "01");
    const made = [];
    for (let i = 0; i < 4; i++) {
      await writeFile(join(workspacePath(root, "01"), "index.mjs"), "attempt " + i + "\n");
      made.push((await resetWorkspace(root, "01")).backup.split(/[\\/]/).pop());
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.deepEqual(await listBackups(root, "01"), [made[3], made[2]]);
    assert.equal(await readFile(join(root, ".workshop/playgrounds", made[3], "index.mjs"), "utf8"), "attempt 3\n");
    // Size: a 0.7 MB playground fits once in 1 MB; the newest is kept, older evicted.
    await writeFile(join(workspacePath(root, "01"), "big.bin"), Buffer.alloc(700 * 1024));
    const first = (await resetWorkspace(root, "01")).backup.split(/[\\/]/).pop();
    await writeFile(join(workspacePath(root, "01"), "big.bin"), Buffer.alloc(700 * 1024));
    await new Promise((r) => setTimeout(r, 5));
    const second = (await resetWorkspace(root, "01")).backup.split(/[\\/]/).pop();
    assert.deepEqual(await listBackups(root, "01"), [second]);
    assert.notEqual(first, second);
    for (const bad of [{ limit: 0 }, { limit: 51 }, { maxMegabytes: 0 }, []]) assert.throws(() => validateBackupConfig(bad));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
