import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  selectWorkspace,
  resetWorkspace,
  workspacePath,
} from "./workspaces.mjs";
import {
  listFiles,
  readProjectFile,
  writeProjectFile,
  renameProjectFile,
  deleteProjectFile,
} from "./files.mjs";
test("nested files, rename, deletion, backup reset and path containment", async () => {
  const root = await mkdtemp(join(tmpdir(), "icode-files-"));
  try {
    const starter = join(root, "exercises", "01", "problem");
    await mkdir(starter, { recursive: true });
    await writeFile(join(starter, "index.mjs"), "starter");
    await selectWorkspace(root, "01");
    await writeProjectFile(root, "01", "src/helper.mjs", "helper", {
      create: true,
    });
    assert.deepEqual(await listFiles(root, "01"), [
      "index.mjs",
      "src/helper.mjs",
    ]);
    await renameProjectFile(root, "01", "src/helper.mjs", "src/renamed.mjs");
    assert.equal(
      await readProjectFile(root, "01", "src/renamed.mjs"),
      "helper",
    );
    await assert.rejects(writeProjectFile(root, "01", "../escape", "bad"));
    await symlink(root, join(workspacePath(root, "01"), "link"));
    await assert.rejects(
      writeProjectFile(root, "01", "link/escape", "bad"),
      /Symlinks/,
    );
    await rm(join(workspacePath(root, "01"), "link"));
    await deleteProjectFile(root, "01", "src/renamed.mjs");
    await writeProjectFile(root, "01", "index.mjs", "edited");
    const reset = await resetWorkspace(root, "01");
    assert.equal(reset.code, "starter");
    assert.equal(
      await readFile(join(reset.backup, "index.mjs"), "utf8"),
      "edited",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
