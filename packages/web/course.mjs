import { discoverSteps, hostConfig } from "../core/layout.mjs";
import { APPS_FORMAT } from "../core/apps-layout.mjs";
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
  if (!course && hostConfig(root).format === APPS_FORMAT) {
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
  // Operations and content settings (served validated by
  // /api/content/*) are not part of the course outline.
  const { actions, indicators, sidecars, hooks, savedPlaygrounds, diff, backups, buildOutput, pages, notifications, notificationsFeed, forms, support, community, repository, instructor, product, appType, ...rest } = course;
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
// Per-question progress (check questions): {step: {question: entry}}.
export const QUESTION_STATUSES = ["correct", "incorrect", "revealed"];
export const QUESTION_MARKS = ["got-it", "review"];
const QUESTION_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_QUESTIONS_PER_STEP = 200;
function cleanQuestionEntry(entry) {
  if (!entry || typeof entry !== "object" || !QUESTION_STATUSES.includes(entry.status)) return null;
  const out = { status: entry.status };
  if (QUESTION_MARKS.includes(entry.mark)) out.mark = entry.mark;
  if (typeof entry.at === "string" && entry.at.length <= 40 && !Number.isNaN(Date.parse(entry.at))) out.at = entry.at;
  if (Number.isInteger(entry.choice) && entry.choice >= 0 && entry.choice < 10) out.choice = entry.choice;
  return out;
}
/** Saved question progress, keeping only valid entries of known steps. */
export function cleanQuestions(questions, ids) {
  const out = {};
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) return out;
  for (const [step, entries] of Object.entries(questions)) {
    if (!ids.includes(step) || !entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    const kept = {};
    for (const [qid, entry] of Object.entries(entries).slice(0, MAX_QUESTIONS_PER_STEP)) {
      const clean = QUESTION_KEY.test(qid) && cleanQuestionEntry(entry);
      if (clean) kept[qid] = clean;
    }
    if (Object.keys(kept).length) out[step] = kept;
  }
  return out;
}
export async function readProgress(root) {
  const { ids } = await courseConfig(root);
  const path = await assertSafePath(join(root, ".workshop", "progress.json"));
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(data.completed))
      throw new Error("Invalid saved progress");
    return { completed: data.completed.filter((id) => ids.includes(id)), questions: cleanQuestions(data.questions, ids) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return { completed: [], questions: {} };
  }
}
let queue = Promise.resolve();
async function writeProgress(root, data) {
  const path = await assertSafePath(join(root, ".workshop", "progress.json"));
  await mkdir(join(root, ".workshop"), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2), { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
// Every progress write (steps and questions) is serialised here.
function serialised(task) {
  const operation = queue.catch(() => {}).then(task);
  queue = operation;
  return operation;
}
export function updateProgress(root, id, complete) {
  return serialised(async () => {
    validateId(id);
    if (typeof complete !== "boolean" || !(await courseConfig(root)).ids.includes(id))
      throw new Error("Invalid progress update");
    const data = await readProgress(root);
    data.completed = data.completed.filter((item) => item !== id);
    if (complete) data.completed.push(id);
    await writeProgress(root, data);
    return data;
  });
}
/**
 * Record one question's progress. `change` is {status} (after a check or a
 * reveal, set by the server), {mark} (self-marking after a reveal or check)
 * The caller has already checked that the question exists.
 */
export function updateQuestionProgress(root, id, question, change) {
  return serialised(async () => {
    validateId(id);
    if (!QUESTION_KEY.test(String(question ?? ""))) throw new Error("Invalid question id");
    const data = await readProgress(root);
    if (!(await courseConfig(root)).ids.includes(id)) throw new Error("Invalid progress update");
    const step = { ...(data.questions[id] || {}) };
    const at = new Date().toISOString();
    if (change.status !== undefined) {
      if (!QUESTION_STATUSES.includes(change.status)) throw new Error("Invalid question status");
      // A new attempt keeps an earlier self-mark only for revealed answers.
      const mark = change.status === "revealed" ? step[question]?.mark : undefined;
      step[question] = { status: change.status, ...(mark ? { mark } : {}), ...(Number.isInteger(change.choice) ? { choice: change.choice } : {}), at };
    } else if (change.mark !== undefined) {
      if (!QUESTION_MARKS.includes(change.mark)) throw new Error("Invalid question mark");
      if (!step[question]) throw new Error("Check or reveal the answer before marking it");
      step[question] = { ...step[question], mark: change.mark, at };
    } else throw new Error("Invalid question progress update");
    if (Object.keys(step).length > MAX_QUESTIONS_PER_STEP) throw new Error("Too many questions in one step");
    data.questions = { ...data.questions, [id]: step };
    await writeProgress(root, data);
    return data;
  });
}
