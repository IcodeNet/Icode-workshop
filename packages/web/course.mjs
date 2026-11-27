import { discoverSteps, hostConfig } from "../core/layout.mjs";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { listExercises, validateId } from "../core/index.mjs";
import { assertSafePath } from "./files.mjs";

export async function courseConfig(root) {
  const ids = await listExercises(root);
  let course;
  try {
    course = JSON.parse(await readFile(join(root, "course.json"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  // A manifest may declare only operations (actions, indicators, sidecars)
  // and an optional title; module order then falls back to discovery.
  const title =
    course && course.modules === undefined && typeof course.title === "string" && course.title.trim()
      ? course.title
      : undefined;
  if (course && course.modules === undefined) {
    if (course.schemaVersion !== 1) throw new Error("Invalid course manifest");
    course = undefined;
  }
  if (!course && hostConfig(root).format === "epic") {
    const steps = discoverSteps(root), groups = new Map();
    for (const step of steps) {
      if (!groups.has(step.module)) groups.set(step.module, { id: step.module, title: step.module.replace(/^\d+\./, "").replaceAll("-", " "), steps: [] });
      groups.get(step.module).steps.push(step.id);
    }
    return {schemaVersion:1, title:title || hostConfig(root).title || "Workshop", modules:[...groups.values()], ids};
  }
  if (!course)
    return {
      schemaVersion: 1,
      title: title || "AI Engineering Labs",
      modules: [{ id: "labs", title: "Labs", steps: ids }],
      ids,
    };
  if (
    course.schemaVersion !== 1 ||
    typeof course.title !== "string" ||
    !course.title.trim() ||
    !Array.isArray(course.modules)
  )
    throw new Error("Invalid course manifest");
  const seen = new Set(),
    modules = new Set();
  for (const module of course.modules) {
    if (
      !module ||
      typeof module.id !== "string" ||
      !module.id ||
      modules.has(module.id) ||
      typeof module.title !== "string" ||
      (!Array.isArray(module.steps) && !Array.isArray(module.exercises))
    )
      throw new Error("Invalid course module");
    modules.add(module.id);
    if (module.exercises !== undefined) {
      if (!Array.isArray(module.exercises) || module.steps !== undefined)
        throw new Error("Use either module steps or exercises");
      const exerciseIds = new Set();
      for (const exercise of module.exercises) {
        if (
          !exercise ||
          typeof exercise.id !== "string" ||
          !exercise.id ||
          exerciseIds.has(exercise.id) ||
          typeof exercise.title !== "string" ||
          !Array.isArray(exercise.steps)
        )
          throw new Error("Invalid course exercise");
        exerciseIds.add(exercise.id);
      }
      module.steps = module.exercises.flatMap((exercise) => exercise.steps);
    }
    for (const id of module.steps) {
      validateId(id);
      if (!ids.includes(id) || seen.has(id))
        throw new Error("Unknown or duplicate course step: " + id);
      seen.add(id);
    }
  }
  if (seen.size !== ids.length)
    throw new Error("Every exercise must belong to a course module");
  const { actions, indicators, sidecars, ...rest } = course;
  return { ...rest, ids: [...seen] };
}
export function validateMedia(media) {
  if (media === undefined) return undefined;
  if (!media || typeof media !== "object")
    throw new Error("Invalid lesson media");
  const safeUrl = (value) => {
    if (typeof value !== "string") throw new Error("Invalid media URL");
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid media URL");
    return value;
  };
  if (media.transcript !== undefined && typeof media.transcript !== "string")
    throw new Error("Invalid transcript");
  return {
    src: media.src ? safeUrl(media.src) : undefined,
    captions: media.captions ? safeUrl(media.captions) : undefined,
    transcript: media.transcript || "",
  };
}
export async function readProgress(root) {
  const { ids } = await courseConfig(root);
  const path = await assertSafePath(join(root, ".workshop", "progress.json"));
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(data.completed))
      throw new Error("Invalid saved progress");
    return { completed: data.completed.filter((id) => ids.includes(id)) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return { completed: [] };
  }
}
let queue = Promise.resolve();
export function updateProgress(root, id, complete) {
  const operation = queue
    .catch(() => {})
    .then(async () => {
      validateId(id);
      if (
        typeof complete !== "boolean" ||
        !(await courseConfig(root)).ids.includes(id)
      )
        throw new Error("Invalid progress update");
      const data = await readProgress(root);
      data.completed = data.completed.filter((item) => item !== id);
      if (complete) data.completed.push(id);
      const path = await assertSafePath(
        join(root, ".workshop", "progress.json"),
      );
      await mkdir(join(root, ".workshop"), { recursive: true });
      const temporary = path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, JSON.stringify(data, null, 2), {
          flag: "wx",
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return data;
    });
  queue = operation;
  return operation;
}
