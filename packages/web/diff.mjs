// Rich diffs between any two sides (problem, solution, playground or a saved
// playground of any step). Pure JavaScript: no git, no shell. Bounded in
// files, bytes, edit distance and response lines; never follows symlinks.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { validateId } from "../core/index.mjs";
import { APPS_SETTINGS_KEY } from "../core/apps-layout.mjs";
import { assertSafePath, variantRoot } from "./files.mjs";
import { SAVED_ID, savedFilesPath } from "./saved-playgrounds.mjs";
import { compileIgnore } from "./ignore.mjs";
import { outputPatterns } from "./exclusions.mjs";
export { compileIgnore };

export const LARGE_FILE_BYTES = 1024 * 1024;
export const MAX_SIDE_FILES = 5000;
export const MAX_EDIT_DISTANCE = 2000;
export const LIST_LINE_BUDGET = 20_000;
export const FILE_INLINE_LINES = 5_000;
export const SINGLE_FILE_LINES = 50_000;
export const MAX_LINE_CHARS = 2000;
export const SYNC_MAX_BYTES = 20 * 1024 * 1024;
// Never directories by bare name at any depth (src/bin must stay visible):
// node_modules and declared build output come from exclusions.mjs.
export const DEFAULT_IGNORE = [
  ".git/",
  ".DS_Store",
  ".vscode/",
  ".idea/",
  "*.db",
  "*.db-wal",
  "*.db-shm",
  "*.sqlite",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "README.*",
  "package-lock.json",
  APPS_SETTINGS_KEY + "/",
];
const VARIANTS = ["problem", "solution", "playground"];

// ---------------------------------------------------------------- sides

/** Parse `01.problem`, `01.playground` or `01.saved.<savedId>`. Pure. */
export function parseSide(spec) {
  if (typeof spec !== "string" || spec.length > 80) throw new Error("Invalid diff side");
  const parts = spec.split(".");
  const [step, variant, savedId] = parts;
  validateId(step);
  if (parts.length === 2 && VARIANTS.includes(variant)) return { step, variant };
  if (parts.length === 3 && variant === "saved" && SAVED_ID.test(savedId ?? ""))
    return { step, variant, savedId };
  throw new Error("Invalid diff side");
}
export const formatSide = (side) =>
  side.step + "." + side.variant + (side.savedId ? "." + side.savedId : "");

/**
 * Expand a deep-link shortcut into two sides. Pure.
 * `01` → 01.problem..01.solution; `01.playground` → that playground vs the
 * step's solution; `01..02` → 01.solution..02.problem; `a..b` → as given.
 */
export function expandShortcut(value) {
  if (typeof value !== "string" || value.length > 200) throw new Error("Invalid diff link");
  const [left, right, extra] = value.split("..");
  if (extra !== undefined) throw new Error("Invalid diff link");
  if (right === undefined) {
    if (/^\d{2}$/.test(left)) return [left + ".problem", left + ".solution"];
    const side = parseSide(left);
    return [formatSide(side), side.step + ".solution"];
  }
  if (/^\d{2}$/.test(left) && /^\d{2}$/.test(right))
    return [left + ".solution", right + ".problem"];
  return [formatSide(parseSide(left)), formatSide(parseSide(right))];
}

async function sideDirectory(root, side) {
  const dir =
    side.variant === "saved"
      ? await savedFilesPath(root, side.step, side.savedId)
      : variantRoot(root, side.step, side.variant);
  await assertSafePath(dir);
  try {
    if (!(await lstat(dir)).isDirectory()) throw new Error();
  } catch {
    throw new Error(
      side.variant === "playground"
        ? "Playground for " + side.step + " has not been created yet"
        : "Unknown diff side " + formatSide(side),
    );
  }
  return dir;
}

// ---------------------------------------------------------------- ignore

async function readLines(path) {
  try {
    await assertSafePath(path);
    const info = await lstat(path);
    if (!info.isFile() || info.size > 256 * 1024) return [];
    return (await readFile(path, "utf8")).split("\n");
  } catch {
    return [];
  }
}
/**
 * Validate a relative path inside a side. Unlike editor paths, dotfiles are
 * allowed (`.env.example` can be part of a step). Pure.
 */
export function validateRelativePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 240 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid file path");
  return path;
}

/** All ignore patterns for a pair of side directories (and the steps they belong to). */
export async function ignorePatterns(root, dirs, steps = []) {
  root = resolve(root);
  let course = {};
  try {
    course = JSON.parse(await readFile(join(root, "course.json"), "utf8"));
  } catch {}
  const configured = course?.diff?.ignore;
  if (configured !== undefined && (!Array.isArray(configured) || configured.length > 200 || configured.some((p) => typeof p !== "string" || p.length > 200)))
    throw new Error("course.json diff.ignore must be a list of patterns");
  const patterns = [...DEFAULT_IGNORE, ...(await outputPatterns(root, steps)), ...(configured ?? [])];
  patterns.push(...(await readLines(join(root, ".gitignore"))));
  patterns.push(...(await readLines(join(root, APPS_SETTINGS_KEY, ".diffignore"))));
  for (const dir of dirs) {
    patterns.push(...(await readLines(join(dir, ".gitignore"))));
    patterns.push(...(await readLines(join(dir, APPS_SETTINGS_KEY, ".diffignore"))));
  }
  return patterns;
}

// ---------------------------------------------------------------- walking

/** Walk a side: Map rel → {size, symlink}. Never follows symlinks. */
export async function walkSide(dir, ignored, { maxFiles = MAX_SIDE_FILES } = {}) {
  const files = new Map();
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const item of entries) {
      const rel = prefix ? prefix + "/" + item.name : item.name;
      if (item.isSymbolicLink()) {
        if (!ignored(rel, false)) files.set(rel, { size: 0, symlink: true });
      } else if (item.isDirectory()) {
        if (!ignored(rel, true)) await walk(join(current, item.name), rel);
      } else if (item.isFile()) {
        if (ignored(rel, false)) continue;
        const info = await lstat(join(current, item.name));
        files.set(rel, { size: info.size, symlink: false });
      }
      if (files.size > maxFiles)
        throw new Error("Too many files to compare (more than " + maxFiles + ")");
    }
  }
  await walk(dir, "");
  return files;
}
function hashStream(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}
async function content(dir, rel, info) {
  if (!info) return null;
  if (info.symlink) return { symlink: true, hash: "symlink" };
  const path = join(dir, ...rel.split("/"));
  if (info.size > LARGE_FILE_BYTES) return { large: true, size: info.size, hash: await hashStream(path) };
  const buffer = await readFile(path);
  const binary = buffer.subarray(0, 8000).includes(0);
  return {
    binary,
    size: buffer.length,
    hash: createHash("sha256").update(buffer).digest("hex"),
    text: binary ? null : buffer.toString("utf8"),
  };
}

// ---------------------------------------------------------------- line diff

const splitLines = (text) => {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};
const normaliseWhitespace = (line) => line.replace(/\s+/g, " ").trim();

/** Myers O(ND) on integer arrays. Returns edit ops or null when D > maxD. */
function myers(a, b, maxD) {
  const n = a.length,
    m = b.length,
    limit = Math.min(n + m, maxD);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  v[offset + 1] = 0;
  const trace = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}
function backtrack(trace, n, m) {
  const ops = [];
  let x = n,
    y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const row = trace[d];
    const at = (k) => row[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK),
      prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push([" ", --x, --y]);
    }
    if (d > 0) {
      if (x === prevX) ops.push(["+", x, --y]);
      else ops.push(["-", --x, y]);
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}
/**
 * Diff two texts. Returns {additions, deletions, hunks, approximate,
 * truncated, equalAfterNormalising}. `context` < 0 means the whole file.
 */
export function diffText(before, after, { whitespace = false, context = 3, maxLines = FILE_INLINE_LINES, maxD = MAX_EDIT_DISTANCE } = {}) {
  const a = splitLines(before),
    b = splitLines(after);
  const ids = new Map();
  const key = (line) => {
    const k = whitespace ? normaliseWhitespace(line) : line;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    return id;
  };
  const ka = Int32Array.from(a, key),
    kb = Int32Array.from(b, key);
  let pre = 0;
  while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++;
  let suf = 0;
  while (suf < ka.length - pre && suf < kb.length - pre && ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]) suf++;
  const midA = ka.subarray(pre, ka.length - suf),
    midB = kb.subarray(pre, kb.length - suf);
  let middle = myers(midA, midB, maxD);
  let approximate = false;
  if (!middle) {
    approximate = true;
    middle = [];
    for (let i = 0; i < midA.length; i++) middle.push(["-", i, 0]);
    for (let j = 0; j < midB.length; j++) middle.push(["+", 0, j]);
  }
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push([" ", i, i]);
  for (const [t, x, y] of middle) ops.push([t, x + pre, y + pre]);
  for (let i = suf; i > 0; i--) ops.push([" ", ka.length - i, kb.length - i]);
  let additions = 0,
    deletions = 0;
  for (const op of ops) {
    if (op[0] === "+") additions++;
    else if (op[0] === "-") deletions++;
  }
  // Group into hunks with `context` lines around changes.
  const C = context < 0 ? Infinity : context;
  const hunks = [];
  let emitted = 0,
    truncated = false;
  const changes = [];
  ops.forEach((op, index) => op[0] !== " " && changes.push(index));
  let i = 0;
  while (i < changes.length && !truncated) {
    const start = Math.max(0, changes[i] - C);
    let end = changes[i];
    while (i + 1 < changes.length && changes[i + 1] - end <= 2 * C + 1) end = changes[++i];
    i++;
    const stop = Math.min(ops.length - 1, end + C);
    const lines = [];
    let aStart = null,
      bStart = null,
      aCount = 0,
      bCount = 0;
    for (let j = start; j <= stop; j++) {
      if (emitted >= maxLines) {
        truncated = true;
        break;
      }
      const [t, x, y] = ops[j];
      const text = t === "+" ? b[y] : a[x];
      const line = {
        t,
        a: t === "+" ? null : x + 1,
        b: t === "-" ? null : y + 1,
        text: text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) + "…" : text,
      };
      if (t !== "+") {
        aStart ??= x + 1;
        aCount++;
      }
      if (t !== "-") {
        bStart ??= y + 1;
        bCount++;
      }
      lines.push(line);
      emitted++;
    }
    if (lines.length)
      hunks.push({ aStart: aStart ?? (ops[start][1] || 0), aLines: aCount, bStart: bStart ?? (ops[start][2] || 0), bLines: bCount, lines });
  }
  if (truncated && i < changes.length) truncated = true;
  return {
    additions,
    deletions,
    hunks,
    approximate,
    truncated,
    lines: { a: a.length, b: b.length },
    emitted,
  };
}

// ---------------------------------------------------------------- side diff

function packageNameOnly(a, b) {
  try {
    const { name: _a, ...x } = JSON.parse(a);
    const { name: _b, ...y } = JSON.parse(b);
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

async function prepare(root, aSpec, bSpec) {
  const a = parseSide(aSpec),
    b = parseSide(bSpec);
  const [aDir, bDir] = [await sideDirectory(root, a), await sideDirectory(root, b)];
  const ignored = compileIgnore(await ignorePatterns(root, [aDir, bDir], [a.step, b.step]));
  const [aFiles, bFiles] = await Promise.all([walkSide(aDir, ignored), walkSide(bDir, ignored)]);
  return { a, b, aDir, bDir, aFiles, bFiles };
}

function fileEntry(path, A, B, options, budget) {
  const entry = {
    path,
    status: !A ? "added" : !B ? "deleted" : "modified",
    sizeA: A?.size ?? null,
    sizeB: B?.size ?? null,
    additions: 0,
    deletions: 0,
    hunks: null,
  };
  if (A?.symlink || B?.symlink) return { ...entry, symlink: true, note: "Symbolic links are not compared" };
  if (A?.large || B?.large) return { ...entry, large: true, note: "File larger than 1 MB; compared by content hash only" };
  if (A?.binary || B?.binary) return { ...entry, binary: true, note: "Binary file; compared by content hash only" };
  const result = diffText(A?.text ?? "", B?.text ?? "", {
    whitespace: options.whitespace,
    context: options.context,
    maxLines: Math.min(budget.perFile, Math.max(0, budget.remaining)),
  });
  entry.additions = result.additions;
  entry.deletions = result.deletions;
  entry.lines = result.lines;
  if (result.approximate) entry.approximate = true;
  if (A && B && result.additions === 0 && result.deletions === 0) {
    entry.equivalent = true;
    entry.note = options.whitespace ? "Only whitespace differs" : "Only line endings or the final newline differ";
    entry.hunks = [];
    return entry;
  }
  if (budget.remaining <= 0 || (result.truncated && budget.defer)) {
    entry.deferred = true;
    return entry;
  }
  budget.remaining -= result.emitted;
  entry.hunks = result.hunks;
  if (result.truncated) entry.truncated = true;
  return entry;
}

/**
 * Compare two sides. Options: whitespace (bool), context (int, -1 = all).
 * Files over the response budget are `deferred` (stats only).
 */
export async function diffSides(root, aSpec, bSpec, { whitespace = false, context = 3, lineBudget = LIST_LINE_BUDGET } = {}) {
  context = normaliseContext(context);
  const { a, b, aDir, bDir, aFiles, bFiles } = await prepare(root, aSpec, bSpec);
  const paths = [...new Set([...aFiles.keys(), ...bFiles.keys()])].sort();
  const loaded = new Map();
  for (const path of paths) {
    const [A, B] = await Promise.all([content(aDir, path, aFiles.get(path)), content(bDir, path, bFiles.get(path))]);
    if (A && B && A.hash === B.hash) continue;
    if (A && B && path.split("/").pop() === "package.json" && A.text != null && B.text != null && packageNameOnly(A.text, B.text)) continue;
    loaded.set(path, { A, B });
  }
  // Renames: an added and a deleted file with identical content.
  // Only unambiguous pairs: non-empty content that appears once on each side.
  const count = (pick) => {
    const map = new Map();
    for (const [path, entry] of loaded) {
      const item = pick(entry);
      if (item && !item.symlink && item.size > 0) map.set(item.hash, map.has(item.hash) ? null : path);
    }
    return map;
  };
  const deleted = count(({ A, B }) => (A && !B ? A : null));
  const added = count(({ A, B }) => (!A && B ? B : null));
  const renamed = new Map();
  for (const [hash, to] of added) {
    const from = deleted.get(hash);
    if (to && from) renamed.set(from, to);
  }
  const budget = { remaining: lineBudget, perFile: FILE_INLINE_LINES, defer: true };
  const files = [];
  let equivalent = 0;
  for (const [path, { A, B }] of loaded) {
    if (renamed.has(path)) continue;
    const from = [...renamed].find(([, to]) => to === path)?.[0];
    if (from) {
      files.push({ path, from, status: "renamed", sizeA: A?.size ?? B.size, sizeB: B.size, additions: 0, deletions: 0, hunks: [] });
      continue;
    }
    const entry = fileEntry(path, A, B, { whitespace, context }, budget);
    if (entry.equivalent && whitespace) {
      equivalent++;
      continue;
    }
    files.push(entry);
  }
  return {
    a: formatSide(a),
    b: formatSide(b),
    whitespace,
    context,
    files,
    truncated: files.some((f) => f.deferred),
    stats: {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      hiddenWhitespaceOnly: equivalent,
    },
  };
}
function normaliseContext(context) {
  const value = Number(context);
  if (!Number.isInteger(value) || value < -1 || value > 1000) throw new Error("Invalid context");
  return value;
}

/** One file of a diff, with a larger budget. `path` must exist on a side. */
export async function diffFile(root, aSpec, bSpec, path, { whitespace = false, context = 3 } = {}) {
  validateRelativePath(path);
  context = normaliseContext(context);
  const { a, b, aDir, bDir, aFiles, bFiles } = await prepare(root, aSpec, bSpec);
  if (!aFiles.has(path) && !bFiles.has(path)) throw new Error("File is not part of this diff");
  const [A, B] = await Promise.all([content(aDir, path, aFiles.get(path)), content(bDir, path, bFiles.get(path))]);
  const entry = fileEntry(path, A, B, { whitespace, context }, { remaining: SINGLE_FILE_LINES, perFile: SINGLE_FILE_LINES, defer: false });
  if (A && B && A.hash === B.hash) Object.assign(entry, { identical: true, hunks: [] });
  return { a: formatSide(a), b: formatSide(b), file: entry };
}

// ---------------------------------------------------------------- touched files

/**
 * Files this step changes (problem → solution), with the first changed line,
 * checked against the learner's playground.
 */
export async function touchedFiles(root, id) {
  validateId(id);
  const problemSpec = id + ".problem",
    solutionSpec = id + ".solution";
  const { aDir, bDir, aFiles, bFiles } = await prepare(root, problemSpec, solutionSpec);
  const step = await diffSides(root, problemSpec, solutionSpec, { context: 0, lineBudget: 1e9 });
  let pgDir = null,
    pgFiles = null;
  try {
    pgDir = await sideDirectory(root, { step: id, variant: "playground" });
    const ignored = compileIgnore(await ignorePatterns(root, [aDir, bDir, pgDir], [id]));
    pgFiles = await walkSide(pgDir, ignored);
  } catch {}
  const hash = async (dir, files, path) => (files?.has(path) ? (await content(dir, path, files.get(path))).hash : null);
  const files = [];
  const covered = new Set();
  for (const file of step.files) {
    covered.add(file.path);
    if (file.from) covered.add(file.from);
    const first = file.hunks?.[0];
    const item = {
      path: file.path,
      from: file.from,
      status: file.status,
      // A pure insertion is reported at the line where the new text goes.
      line: first ? Math.max(1, first.aLines ? first.aStart : (first.aStart || 0) + 1) : 1,
      solutionLine: first ? Math.max(1, first.bLines ? first.bStart : (first.bStart || 0) + 1) : 1,
      additions: file.additions,
      deletions: file.deletions,
      playground: "no-playground",
    };
    if (pgFiles) {
      const pg = await hash(pgDir, pgFiles, file.path);
      const problem = await hash(aDir, aFiles, file.from || file.path);
      const solution = await hash(bDir, bFiles, file.path);
      if (file.status === "deleted") item.playground = pg === null ? "done" : pg === problem ? "unchanged" : "edited";
      else if (pg === null) item.playground = "missing";
      else if (pg === solution) item.playground = "done";
      else if (pg === problem) item.playground = "unchanged";
      else item.playground = "edited";
    }
    files.push(item);
  }
  const extra = [];
  if (pgFiles) {
    for (const path of [...new Set([...aFiles.keys(), ...pgFiles.keys()])].sort()) {
      if (covered.has(path)) continue;
      const pg = await hash(pgDir, pgFiles, path);
      const problem = await hash(aDir, aFiles, path);
      if (pg === problem) continue;
      extra.push({ path, status: problem === null ? "added" : pg === null ? "deleted" : "modified" });
    }
  }
  return { id, playgroundExists: Boolean(pgFiles), files, extra };
}

// ---------------------------------------------------------------- sync

/**
 * Copy one file from a side into a step's playground (per-file sync;
 * "reset file to problem" is `from = <id>.problem`). With `remove`,
 * a file absent from the source side is deleted from the playground.
 */
export async function syncFile(root, id, name, fromSpec, { remove = false, dryRun = false } = {}) {
  validateId(id);
  validateRelativePath(name);
  const from = parseSide(fromSpec);
  if (from.step === id && from.variant === "playground") throw new Error("Cannot sync a playground onto itself");
  const fromDir = await sideDirectory(root, from);
  const playground = await sideDirectory(root, { step: id, variant: "playground" });
  const source = await assertSafePath(join(fromDir, ...name.split("/")));
  const target = await assertSafePath(join(playground, ...name.split("/")));
  if (!resolve(target).startsWith(resolve(playground) + sep)) throw new Error("Invalid file path");
  let info = null;
  try {
    info = await lstat(source);
  } catch (e) {
    if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
  }
  if (!info) {
    if (!remove) throw new Error(name + " does not exist in " + formatSide(from));
    if (dryRun) return { synced: false, dryRun: true };
    try {
      if (!(await lstat(target)).isFile()) throw new Error("Not a file");
    } catch (e) {
      if (e.code === "ENOENT") return { synced: true, removed: false, name };
      throw e;
    }
    await rm(target);
    return { synced: true, removed: true, name };
  }
  if (!info.isFile()) throw new Error("Only regular files can be synced");
  if (info.size > SYNC_MAX_BYTES) throw new Error("File is too large to sync");
  if (dryRun) return { synced: false, dryRun: true };
  await mkdir(dirname(target), { recursive: true });
  await assertSafePath(dirname(target));
  await copyFile(source, target);
  return { synced: true, removed: false, name, from: formatSide(from) };
}
