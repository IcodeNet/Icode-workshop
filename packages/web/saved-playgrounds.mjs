// Saved playgrounds: bounded, exact snapshots of a step's playground.
// Layout: .workshop/saved-playgrounds/<step>/<savedId>/{meta.json,files/…}.
// Saved ids are generated here and validated against a strict pattern;
// learner labels are stored only in meta.json and never become paths.
import { safePreferences, validatePreferences } from "./src/ux/preferences.js";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { validateId } from "../core/index.mjs";
import { assertSafePath } from "./files.mjs";
import { pruneBackups, workspacePath } from "./workspaces.mjs";
import { compileIgnore } from "./ignore.mjs";
import { outputPatterns } from "./exclusions.mjs";

/** Predicate for what a saved playground of `id` leaves out (node_modules and declared build output). */
export async function savedExclusions(root, id) {
  return compileIgnore(await outputPatterns(root, [id]));
}

export const SAVED_ID = /^\d{8}T\d{9}Z-[0-9a-f]{6}$/;
export const DEFAULT_LIMIT = 20;
export const DEFAULT_MAX_MEGABYTES = 50;
export const MAX_FILES = 5000;
// eslint-disable-next-line no-control-regex
const UNSAFE_LABEL = /[\p{C}\p{Zl}\p{Zp}]/u;
const REASONS = new Set(["manual", "reset", "replace", "migrate", "restore", "sync"]);

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
}
export function validateSavedId(savedId) {
  if (typeof savedId !== "string" || !SAVED_ID.test(savedId))
    throw new Error("Invalid saved playground id");
  return savedId;
}
export function savedBase(root, id) {
  validateId(id);
  return join(resolve(root), ".workshop", "saved-playgrounds", id);
}

/** Course limits from course.json#savedPlaygrounds. Pure validation exported for tests. */
export function validateSavedConfig(config) {
  const limits = { limit: DEFAULT_LIMIT, maxBytes: DEFAULT_MAX_MEGABYTES * 1024 * 1024, maxFiles: MAX_FILES };
  if (config === undefined) return limits;
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("savedPlaygrounds must be an object");
  if (config.limit !== undefined) {
    if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 100)
      throw new Error("savedPlaygrounds.limit must be 1–100");
    limits.limit = config.limit;
  }
  if (config.maxMegabytes !== undefined) {
    if (!Number.isInteger(config.maxMegabytes) || config.maxMegabytes < 1 || config.maxMegabytes > 500)
      throw new Error("savedPlaygrounds.maxMegabytes must be 1–500");
    limits.maxBytes = config.maxMegabytes * 1024 * 1024;
  }
  return limits;
}
export async function savedConfig(root) {
  const course = (await readJson(join(resolve(root), "course.json"))) ?? {};
  return validateSavedConfig(course.savedPlaygrounds);
}

const preferencesPath = (root) => join(resolve(root), ".workshop", "preferences.json");
export async function readPreferences(root) {
  let stored;
  try {
    stored = await readJson(preferencesPath(root));
  } catch {
    stored = undefined;
  }
  // Stage 4: UI preferences (theme, fonts, motion, shortcuts...). Invalid
  // stored values fall back to defaults; they are never passed through.
  return { savePlaygrounds: stored?.savePlaygrounds !== false, ui: safePreferences(stored?.ui) };
}
export async function writePreferences(root, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Invalid preferences");
  for (const key of Reflect.ownKeys(changes))
    if (!["savePlaygrounds", "ui"].includes(key)) throw new Error("Invalid preferences: unknown key");
  const next = await readPreferences(root);
  if (changes.ui !== undefined) next.ui = { ...next.ui, ...validatePreferences(changes.ui, { partial: true }) };
  if (changes.savePlaygrounds !== undefined) {
    if (typeof changes.savePlaygrounds !== "boolean") throw new Error("Invalid preferences");
    next.savePlaygrounds = changes.savePlaygrounds;
  }
  const path = await assertSafePath(preferencesPath(root));
  await mkdir(join(resolve(root), ".workshop"), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(next, null, 2));
  await rename(temp, path);
  return next;
}

/**
 * Walk a playground for snapshotting. Refuses symlinks, leaves out what
 * `excluded(rel, isDir)` matches (recorded in `skipped`), and enforces count
 * and size limits before anything is copied.
 */
export async function inventory(dir, { maxBytes = Infinity, maxFiles = MAX_FILES, excluded = () => false } = {}) {
  const files = [],
    dirs = [],
    skipped = [];
  let bytes = 0;
  async function walk(current, prefix) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const rel = prefix ? prefix + "/" + item.name : item.name;
      const abs = join(current, item.name);
      const info = await lstat(abs);
      if (!info.isSymbolicLink() && excluded(rel, info.isDirectory())) {
        skipped.push(rel);
        continue;
      }
      if (info.isSymbolicLink()) throw new Error("Symlinks are not supported: " + rel);
      if (info.isDirectory()) {
        dirs.push({ rel, mode: info.mode });
        await walk(abs, rel);
      } else if (info.isFile()) {
        bytes += info.size;
        files.push({ rel, size: info.size, mode: info.mode, mtime: info.mtime, atime: info.atime });
        if (files.length > maxFiles)
          throw Object.assign(new Error("Playground has more than " + maxFiles + " files"), { code: "TOO_LARGE" });
        if (bytes > maxBytes)
          throw Object.assign(
            new Error("Playground exceeds the saved-playground size limit (" + Math.round(maxBytes / 1048576) + " MB)"),
            { code: "TOO_LARGE" },
          );
      }
    }
  }
  await walk(dir, "");
  return { files, dirs, bytes, skipped };
}
/** Copy an inventory exactly (content, mode, timestamps, empty directories). */
async function copyTree(from, to, { files, dirs }) {
  await mkdir(to, { recursive: true });
  for (const d of dirs) await mkdir(join(to, ...d.rel.split("/")), { recursive: true });
  for (const f of files) {
    const target = join(to, ...f.rel.split("/"));
    await copyFile(join(from, ...f.rel.split("/")), target);
    await utimes(target, f.atime, f.mtime);
  }
}

function newSavedId(now = new Date()) {
  const iso = now.toISOString(); // 2026-11-27T10:11:12.345Z
  const compact = iso.replace(/[-:]/g, "").replace(".", "");
  return compact + "-" + randomBytes(3).toString("hex");
}
function cleanLabel(label) {
  if (label === undefined || label === null || label === "") return "";
  if (typeof label !== "string" || label.length > 80 || UNSAFE_LABEL.test(label))
    throw new Error("Label must be at most 80 printable characters");
  return label.trim();
}

export async function listSaved(root, id) {
  const base = savedBase(root, id);
  await assertSafePath(base);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAVED_ID.test(entry.name)) continue;
    const meta = await readJson(join(base, entry.name, "meta.json")).catch(() => undefined);
    if (!meta) continue;
    result.push({
      savedId: entry.name,
      step: id,
      label: typeof meta.label === "string" ? meta.label : "",
      reason: REASONS.has(meta.reason) ? meta.reason : "manual",
      source: meta.source && typeof meta.source === "object" ? meta.source : null,
      createdAt: meta.createdAt,
      files: meta.files,
      bytes: meta.bytes,
      pinned: meta.pinned === true,
    });
  }
  return result.sort((a, b) => b.savedId.localeCompare(a.savedId));
}
/** Absolute path of a saved playground's files after validating that it exists. */
export async function savedFilesPath(root, id, savedId) {
  validateSavedId(savedId);
  if (!(await listSaved(root, id)).some((s) => s.savedId === savedId))
    throw new Error("Unknown saved playground");
  const path = join(savedBase(root, id), savedId, "files");
  await assertSafePath(path);
  return path;
}

async function prune(root, id, limit) {
  const saved = await listSaved(root, id);
  if (saved.length <= limit) return [];
  // Oldest first; unpinned before pinned.
  const order = [...saved].reverse().sort((a, b) => Number(a.pinned) - Number(b.pinned));
  const removed = [];
  for (const item of order.slice(0, saved.length - limit)) {
    await rm(join(savedBase(root, id), item.savedId), { recursive: true, force: true });
    removed.push(item.savedId);
  }
  return removed;
}

/** Snapshot the step's playground. Throws if it does not exist or exceeds limits. */
export async function savePlayground(root, id, { label, reason = "manual", source, pinned = false } = {}) {
  const playground = workspacePath(root, id);
  await assertSafePath(playground);
  if (!(await exists(playground))) throw new Error("This step has no playground yet");
  if (!REASONS.has(reason)) throw new Error("Invalid reason");
  label = cleanLabel(label);
  const limits = await savedConfig(root);
  const tree = await inventory(playground, { ...limits, excluded: await savedExclusions(root, id) });
  const base = savedBase(root, id);
  await assertSafePath(base);
  await mkdir(base, { recursive: true });
  // Saves are serialised by the mutation gate; anything still partial is from a crash.
  for (const entry of await readdir(base))
    if (entry.endsWith(".partial")) await rm(join(base, entry), { recursive: true, force: true });
  const savedId = newSavedId();
  const partial = join(base, savedId + ".partial");
  try {
    await copyTree(playground, join(partial, "files"), tree);
    const meta = {
      schemaVersion: 1,
      label,
      reason,
      source: source ?? null,
      createdAt: new Date().toISOString(),
      files: tree.files.length,
      bytes: tree.bytes,
      excluded: tree.skipped.slice(0, 100),
      pinned: Boolean(pinned),
    };
    await writeFile(join(partial, "meta.json"), JSON.stringify(meta, null, 2));
    await rename(partial, join(base, savedId));
    const pruned = await prune(root, id, limits.limit);
    return { savedId, step: id, ...meta, pruned };
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
}

/**
 * Automatic save before an operation replaces the playground. Never throws:
 * returns {saved}, {skipped: reason} or null (no playground / disabled).
 */
export async function autoSave(root, id, reason, source) {
  try {
    if (!(await readPreferences(root)).savePlaygrounds) return null;
    if (!(await exists(workspacePath(root, id)))) return null;
    return { saved: await savePlayground(root, id, { reason, source }) };
  } catch (e) {
    return { skipped: e.message };
  }
}

export async function updateSaved(root, id, savedId, { label, pinned } = {}) {
  await savedFilesPath(root, id, savedId);
  const path = join(savedBase(root, id), savedId, "meta.json");
  const meta = await readJson(path);
  if (label !== undefined) meta.label = cleanLabel(label);
  if (pinned !== undefined) {
    if (typeof pinned !== "boolean") throw new Error("Invalid pinned flag");
    meta.pinned = pinned;
  }
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(meta, null, 2));
  await rename(temp, path);
  return (await listSaved(root, id)).find((s) => s.savedId === savedId);
}
export async function deleteSaved(root, id, savedId) {
  await savedFilesPath(root, id, savedId);
  await rm(join(savedBase(root, id), savedId), { recursive: true, force: true });
  return { deleted: true };
}

/**
 * Replace the playground with a saved playground: every saved file and
 * directory comes back as saved. What saves leave out (node_modules and
 * declared build output) is carried over from the current playground, at the
 * same relative path, so the app still runs. Staged, then renamed into place; the previous playground is returned
 * as `previous` (a path) for the caller to keep or remove.
 */
export async function restoreSaved(root, id, savedId) {
  const source = await savedFilesPath(root, id, savedId);
  const path = workspacePath(root, id);
  await assertSafePath(path);
  const tree = await inventory(source, { maxBytes: Infinity, maxFiles: Infinity });
  const token = Date.now() + "-" + randomUUID();
  const staging = path + ".staging-" + token,
    previous = path + ".backup-" + token;
  await mkdir(join(resolve(root), ".workshop", "playgrounds"), { recursive: true });
  const moved = [];
  try {
    await copyTree(source, staging, tree);
    const hadPrevious = await exists(path);
    let carried = [];
    if (hadPrevious)
      try {
        carried = (await inventory(path, { maxFiles: Infinity, excluded: await savedExclusions(root, id) })).skipped;
      } catch {
        // A symlink in the current playground: nothing is carried over.
      }
    if (hadPrevious) {
      await rename(path, previous);
      for (const rel of carried) {
        const target = join(staging, ...rel.split("/"));
        if (await exists(target)) continue;
        await mkdir(join(target, ".."), { recursive: true });
        await rename(join(previous, ...rel.split("/")), target);
        moved.push(rel);
      }
    }
    try {
      await rename(staging, path);
    } catch (e) {
      for (const rel of moved) await rename(join(staging, ...rel.split("/")), join(previous, ...rel.split("/"))).catch(() => {});
      if (hadPrevious) await rename(previous, path);
      throw e;
    }
    await pruneBackups(root, id);
    return { path, previous: hadPrevious ? previous : null, files: tree.files.length };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
