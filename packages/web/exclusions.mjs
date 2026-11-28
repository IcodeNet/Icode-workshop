// What a saved playground, a diff and touched files leave out. Everything is
// included except `node_modules` (anywhere) and build output that the step's
// runtime adapter or the course declares — as root-anchored paths ("/target/")
// or explicit globs ("**/*.pyc"). Directories are never dropped by bare name
// at any depth, so `src/bin` or `cli/bin` are always kept.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { registry, labConfig } from "./runtime.mjs";

export const ALWAYS_EXCLUDED = ["node_modules/"];

/** A declared output pattern must be root-anchored or an explicit glob. Pure. */
export function validateOutputPatterns(list, where = "buildOutput") {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 100)
    throw new Error(where + " must be a list of at most 100 patterns");
  for (const pattern of list) {
    if (
      typeof pattern !== "string" ||
      !pattern ||
      pattern.length > 200 ||
      pattern.includes("\\") ||
      pattern.includes("\0") ||
      pattern.startsWith("!") ||
      !(pattern.startsWith("/") || pattern.includes("*")) ||
      pattern.split("/").some((part) => part === "..")
    )
      throw new Error(
        "Invalid " + where + " pattern '" + pattern + "': use a root-anchored path such as /dist/ or an explicit glob such as **/*.pyc",
      );
  }
  return list;
}

async function courseBuildOutput(root) {
  let course;
  try {
    course = JSON.parse(await readFile(join(resolve(root), "course.json"), "utf8"));
  } catch {
    return [];
  }
  return validateOutputPatterns(course?.buildOutput, "course.json buildOutput");
}
/** Output patterns for a set of steps: node_modules, adapter outputs, course buildOutput. */
export async function outputPatterns(root, steps) {
  const patterns = [...ALWAYS_EXCLUDED];
  for (const step of new Set(steps)) {
    const runtime = (await labConfig(root, step)).runtime;
    patterns.push(...validateOutputPatterns(registry.get(runtime)?.outputs, "adapter " + runtime + " outputs"));
  }
  patterns.push(...(await courseBuildOutput(root)));
  return [...new Set(patterns)];
}
