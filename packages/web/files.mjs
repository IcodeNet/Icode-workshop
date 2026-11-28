import { stepLayout } from "../core/layout.mjs";
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
import { readFileSync, statSync } from "node:fs";
import { mayHoldQuestions } from "./markdown.mjs";

// Epic layout: the lesson (README.md/.mdx at an app's root) lives inside the
// problem and solution apps. When it holds check questions it is kept out of
// file lists, the editor and the playground copy, so their answers are not
// one click away. (Files on disk stay readable: this avoids spoilers only.)
const LESSON_FILE = /^readme\.mdx?$/i;
export function isQuestionLessonFile(path, name) {
  if (!LESSON_FILE.test(name)) return false;
  try {
    if (!statSync(path).isFile() || statSync(path).size > 1024 * 1024) return false;
    return mayHoldQuestions(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}
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
    : stepLayout(root, id)[variant];
}
export async function listFiles(root, id, variant) {
  const base = variantRoot(root, id, variant),
    files = [];
  async function walk(dir, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (
        item.name.startsWith(".") || /\.(sqlite|db)(-wal|-shm)?$/.test(item.name) ||
        ["node_modules", "__pycache__", "target", "bin", "obj"].includes(
          item.name,
        )
      )
        continue;
      const name = prefix + item.name;
      if (!prefix && item.isFile() && isQuestionLessonFile(join(dir, item.name), item.name)) continue;
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
  if (!name.includes("/") && LESSON_FILE.test(name) && mayHoldQuestions(code))
    throw new Error("This lesson file holds check questions: read it in the lesson");
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
