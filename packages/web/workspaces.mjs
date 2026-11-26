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
  const starter = join(resolve(root), "exercises", id, "problem");
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
