import { stepLayout } from "../core/layout.mjs";
import { prepareWorkspace } from "./setup.mjs";
import { cp, mkdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateId } from "../core/index.mjs";
import { labConfig } from "./runtime.mjs";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export function workspacePath(root, id) {
  validateId(id);
  return join(resolve(root), ".workshop", "playgrounds", id);
}
export async function selectWorkspace(root, id) {
  const path = workspacePath(root, id);
  const starter = stepLayout(root, id).problem;
  const { assertSafePath } = await import("./files.mjs");
  await assertSafePath(path);
  await assertSafePath(starter);
  if (!(await exists(starter))) throw new Error("Unknown exercise");
  if (!(await exists(path))) {
    await mkdir(join(resolve(root), ".workshop", "playgrounds"), {
      recursive: true,
    });
    await cp(starter, path, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    try { await prepareWorkspace(root, path); } catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
  }
  const config = await labConfig(root, id);
  const { listFiles, readProjectFile } = await import("./files.mjs");
  const files = await listFiles(root, id);
  const entry = files.includes(config.entry) ? config.entry : files[0];
  return {
    path,
    entry: entry || "",
    code: entry ? await readProjectFile(root, id, entry) : "",
  };
}
export async function saveWorkspace(root, id, code) {
  if (typeof code !== "string" || code.length > 50000)
    throw new Error("Invalid code");
  const path = workspacePath(root, id);
  if (!(await exists(path))) throw new Error("Select the exercise first");
  const config = await labConfig(root, id);
  const { writeProjectFile } = await import("./files.mjs");
  await writeProjectFile(root, id, config.entry, code);
}

export async function resetWorkspace(root, id) {
  const { rename } = await import("node:fs/promises");
  const path = workspacePath(root, id);
  const { assertSafePath } = await import("./files.mjs");
  await assertSafePath(path);
  const backup = path + ".backup-" + Date.now();
  if (await exists(path)) await rename(path, backup);
  try {
    return { ...(await selectWorkspace(root, id)), backup };
  } catch (error) {
    if (await exists(backup)) {
      await rm(path, { recursive: true, force: true });
      await rename(backup, path);
    }
    throw error;
  }
}

export async function listBackups(root, id) {
  workspacePath(root, id);
  const { readdir } = await import("node:fs/promises");
  const { assertSafePath } = await import("./files.mjs");
  const parent = join(resolve(root), ".workshop", "playgrounds");
  await assertSafePath(parent);
  try {
    return (await readdir(parent, { withFileTypes: true }))
      .filter(
        (item) => item.isDirectory() && item.name.startsWith(id + ".backup-"),
      )
      .map((item) => item.name)
      .sort()
      .reverse();
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

export async function replaceWorkspace(
  root,
  id,
  { sourceId = id, variant = "problem", backup } = {},
) {
  const { rename } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");
  const { assertSafePath, variantRoot, listFiles } =
    await import("./files.mjs");
  const path = workspacePath(root, id);
  await labConfig(root, id);
  let source;
  if (backup !== undefined) {
    if (
      typeof backup !== "string" ||
      !(await listBackups(root, id)).includes(backup)
    )
      throw new Error("Unknown backup");
    source = join(resolve(root), ".workshop", "playgrounds", backup);
  } else {
    source = variantRoot(root, sourceId, variant);
    await listFiles(root, sourceId, variant);
  }
  await assertSafePath(path);
  await assertSafePath(source);
  await mkdir(join(resolve(root), ".workshop", "playgrounds"), {
    recursive: true,
  });
  const token = Date.now() + "-" + randomUUID();
  const staging = path + ".staging-" + token,
    previous = path + ".backup-" + token;
  // Stage first: a failed source copy must never remove the learner's workspace.
  try {
    await cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    // Restoring a backup preserves its database; fresh authored copies run setup before replacing work.
    if (!backup && variant !== "playground") await prepareWorkspace(root, staging);
    const hadPrevious = await exists(path);
    if (hadPrevious) await rename(path, previous);
    try {
      await rename(staging, path);
    } catch (e) {
      if (hadPrevious) await rename(previous, path);
      throw e;
    }
    return {
      ...(await selectWorkspace(root, id)),
      backup: hadPrevious ? previous : null,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
