import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

test("symlinks in a playground are refused when saving", { skip: process.platform === "win32" }, async () => {
  const root = await nativeCourse();
  try {
    await selectWorkspace(root, "01");
    await symlink("/etc", join(workspacePath(root, "01"), "escape"));
    await assert.rejects(savePlayground(root, "01"), /Symlinks are not supported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
