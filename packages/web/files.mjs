import {
  lstat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rm,
  rename,
} from "node:fs/promises";
import { resolve, join, dirname, parse, sep } from "node:path";
import { workspacePath } from "./workspaces.mjs";
import { validateId } from "../core/index.mjs";
export function validateFile(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 240 ||
    name.includes("\\") ||
    name
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith("."))
  )
    throw new Error("Invalid file path");
  return name;
}
async function safe(base, name) {
  validateFile(name);
  return assertSafePath(resolve(base, name));
}
export async function assertSafePath(absolute) {
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Symlinks are not supported");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return current;
}
export function variantRoot(root, id, variant = "playground") {
  validateId(id);
  if (!["playground", "problem", "solution"].includes(variant))
    throw new Error("Invalid variant");
  return variant === "playground"
    ? workspacePath(root, id)
    : join(resolve(root), "exercises", id, variant);
}
export async function listFiles(root, id, variant) {
  const base = variantRoot(root, id, variant),
    files = [];
  async function walk(dir, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (
        item.name.startsWith(".") ||
        ["node_modules", "__pycache__", "target", "bin", "obj"].includes(
          item.name,
        )
      )
        continue;
      const name = prefix + item.name;
      await safe(base, name);
      if (item.isDirectory()) await walk(join(dir, item.name), name + "/");
      else if (item.isFile()) files.push(name);
      if (files.length > 1000) throw new Error("Project exceeds 1000 files");
    }
  }
  await walk(base);
  return files.sort();
}
export async function readProjectFile(root, id, name, variant) {
  const path = await safe(variantRoot(root, id, variant), name);
  if ((await lstat(path)).size > 100000)
    throw new Error("File exceeds editor limit");
  const code = await readFile(path, "utf8");
  if (code.includes("\0")) throw new Error("Binary files cannot be edited");
  return code;
}
export async function writeProjectFile(
  root,
  id,
  name,
  code,
  { create = false } = {},
) {
  if (typeof code !== "string" || Buffer.byteLength(code) > 100000)
    throw new Error("Invalid file content");
  const base = variantRoot(root, id),
    path = await safe(base, name);
  await lstat(base);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, code, { flag: create ? "wx" : "w" });
}
export async function deleteProjectFile(root, id, name) {
  await rm(await safe(variantRoot(root, id), name));
}
export async function renameProjectFile(root, id, name, to) {
  const base = variantRoot(root, id),
    destination = await safe(base, to);
  try {
    await lstat(destination);
    throw new Error("Destination already exists");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await mkdir(dirname(destination), { recursive: true });
  await rename(await safe(base, name), destination);
}
