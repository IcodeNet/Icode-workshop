// Workshop update: fast-forward the course repository to its upstream, then
// reinstall dependencies if needed and run the post-update hook. Offline-safe
// (a failed fetch changes nothing), never prompts for credentials, never
// resets, rebases or force-pulls, and requires typed confirmation.
import { lstat, mkdir, realpath, rename, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { startProcess } from "../adapter-api/node.mjs";
import { discoverSteps } from "../core/layout.mjs";
import { registerProcess } from "./processes.mjs";
import { courseEnvironment, installChecks, npmCLI } from "./setup.mjs";
import { resolveHooks, runHook } from "./hooks.mjs";

export const CONFIRM_WORD = "update";
const EXCLUDE_WORKSHOP = ":(exclude).workshop";
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  LC_ALL: "C",
};

// ssh never prompts either (GIT_TERMINAL_PROMPT does not cover it), unless the
// learner configured their own ssh command.
const sshEnvironment = () =>
  process.env.GIT_SSH_COMMAND || process.env.GIT_SSH ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };

/** Run git without a shell. Resolves {code, stdout, stderr}; never rejects for a non-zero exit. */
export async function git(root, args, { timeoutMs = 30_000, onSpawn, emit, label } = {}) {
  let stdout = "",
    stderr = "";
  let session;
  try {
    session = startProcess("git", args, {
      workspaceRoot: root,
      env: { ...GIT_ENV, ...sshEnvironment() },
      outputLimit: Infinity,
      emit: (event) => {
        if (event.type === "stdout") stdout = (stdout + event.text).slice(-200_000);
        else stderr = (stderr + event.text).slice(-50_000);
        emit?.(event);
      },
    });
  } catch (e) {
    return { code: null, stdout, stderr: e.message };
  }
  const registration = label
    ? registerProcess({ kind: "update", label, command: ["git", ...args], session, stop: () => session.stop({ graceMs: 1000 }) })
    : null;
  if (registration) onSpawn?.(registration.id);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    session.stop({ graceMs: 1000 }).catch(() => {});
  }, timeoutMs);
  try {
    const result = await session.completion;
    return { code: timedOut ? null : result.exitCode, stdout, stderr: timedOut ? stderr + "\n[git timed out]" : stderr, timedOut };
  } catch (e) {
    return { code: null, stdout, stderr: stderr + e.message };
  } finally {
    clearTimeout(timer);
  }
}
const out = (r) => r.stdout.trim();

/** Paths from `git status --porcelain=v1 -z` (renames contribute both paths). Pure. */
export function parsePorcelain(text) {
  const parts = text.split("\0");
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") paths.push(parts[++i]);
  }
  return paths.filter(Boolean);
}

const nulList = (text) => text.split("\0").filter(Boolean);
const isWorkshopState = (path) => path === ".workshop" || path.startsWith(".workshop/");
async function existsLocally(root, path) {
  try {
    await lstat(join(root, ...path.split("/")));
    return true;
  } catch {
    return false;
  }
}
/**
 * What the incoming commits would do to files git does not protect: paths in
 * `.workshop/` (the engine's state and learner playgrounds: always refused)
 * and added paths that already exist locally as ignored or untracked files
 * (a fast-forward overwrites ignored files silently). Includes a local file
 * standing where the update needs a directory.
 */
export async function incomingConflicts(root) {
  const all = await git(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD", "@{u}"]);
  const added = await git(root, ["diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", "HEAD", "@{u}"]);
  if (all.code !== 0 || added.code !== 0) throw new Error("Could not compare with the upstream: " + (all.stderr || added.stderr).trim());
  const protectedPaths = nulList(all.stdout).filter(isWorkshopState);
  const overwrites = new Set();
  for (const path of nulList(added.stdout)) {
    if (isWorkshopState(path)) continue;
    if (await existsLocally(root, path)) {
      overwrites.add(path);
      continue;
    }
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      try {
        if (!(await lstat(join(root, ...parts.slice(0, i)))).isDirectory()) overwrites.add(parent);
        else continue;
      } catch {}
      break;
    }
  }
  return { protectedPaths: protectedPaths.slice(0, 50), overwrites: [...overwrites].sort() };
}

/** Map changed paths to step ids (native and Epic layouts). */
export function changedSteps(root, paths) {
  let steps;
  try {
    steps = discoverSteps(root);
  } catch {
    return [];
  }
  const rel = (p) => relative(resolve(root), p).split(sep).join("/");
  const prefixes = steps.map((s) => ({ id: s.id, dirs: [rel(s.problem), rel(s.solution), s.epic ? null : rel(s.base)].filter(Boolean) }));
  const ids = new Set();
  for (const path of paths)
    for (const step of prefixes)
      if (step.dirs.some((dir) => path === dir || path.startsWith(dir + "/"))) ids.add(step.id);
  return [...ids].sort();
}

/** Local status; no network. */
export async function updateStatus(root) {
  root = resolve(root);
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { git: false, message: "The course is not a git repository, so it cannot be updated from here." };
  const [a, b] = await Promise.all([realpath(out(top)).catch(() => out(top)), realpath(root)]);
  if (resolve(a) !== resolve(b))
    return { git: false, message: "The course is inside another repository (" + out(top) + "); update that repository instead." };
  const branch = out(await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]));
  const head = out(await git(root, ["rev-parse", "--short", "HEAD"]));
  const upstreamResult = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const upstream = upstreamResult.code === 0 ? out(upstreamResult) : null;
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", EXCLUDE_WORKSHOP]);
  const dirty = status.code === 0 ? parsePorcelain(status.stdout) : [];
  let ahead = 0,
    behind = 0;
  if (upstream) {
    const counts = await git(root, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
    if (counts.code === 0) [ahead, behind] = out(counts).split(/\s+/).map(Number);
  }
  let lastFetch = null;
  const fetchHead = await git(root, ["rev-parse", "--git-path", "FETCH_HEAD"]);
  if (fetchHead.code === 0)
    lastFetch = await stat(resolve(root, out(fetchHead)))
      .then((s) => s.mtime.toISOString())
      .catch(() => null);
  return {
    git: true,
    branch,
    head,
    upstream,
    ahead,
    behind,
    dirty: dirty.slice(0, 50),
    allDirty: dirty,
    dirtyCount: dirty.length,
    lastFetch,
    message: !upstream
      ? "Branch " + branch + " has no upstream to update from."
      : behind
        ? behind + " update(s) available from " + upstream + "."
        : "Up to date with " + upstream + " as of the last check.",
  };
}

/** Fetch from the upstream (the only network step), then report what would change. */
export async function checkForUpdates(root, { onSpawn } = {}) {
  root = resolve(root);
  const before = await updateStatus(root);
  if (!before.git || !before.upstream) return before;
  const fetched = await git(root, ["fetch", "--quiet", "--no-tags"], { timeoutMs: 60_000, onSpawn, label: "Update: git fetch" });
  if (fetched.code !== 0)
    return { ...before, offline: true, message: "Could not reach " + before.upstream + "; nothing changed. " + fetched.stderr.trim().slice(-400) };
  const status = await updateStatus(root);
  let commits = [],
    steps = [];
  if (status.behind) {
    const log = await git(root, ["log", "--format=%h%x09%s", "-n", "20", "HEAD..@{u}"]);
    commits = out(log).split("\n").filter(Boolean).map((l) => {
      const [hash, ...subject] = l.split("\t");
      return { hash, subject: subject.join("\t") };
    });
    const changed = await git(root, ["diff", "--name-only", "HEAD...@{u}"]);
    steps = changedSteps(root, out(changed).split("\n").filter(Boolean));
    return { ...status, commits, changedSteps: steps, ...(await incomingConflicts(root)) };
  }
  return { ...status, commits, changedSteps: steps, protectedPaths: [], overwrites: [] };
}

/** Reinstall every package root whose dependencies do not match (npm ci, or npm install for an outdated lock). */
async function reinstall(root, { emit, onSpawn }) {
  const pending = (await installChecks(root)).filter((c) => !c.ok);
  if (!pending.length) return { status: "skipped", message: "Dependencies match." };
  const results = [];
  for (const check of pending) {
    const dir = join(root, check.dir);
    const args = [npmCLI(), check.status === "lock-outdated" || !check.fix?.endsWith("npm ci") ? "install" : "ci"];
    emit({ type: "step", step: "install", text: "npm " + args[1] + " in " + (check.dir || "the course root") + "\n" });
    const session = startProcess(process.execPath, args, {
      workspaceRoot: dir,
      env: courseEnvironment(root),
      outputLimit: Infinity,
      emit,
    });
    const registration = registerProcess({ kind: "update", label: "Update: npm " + args[1] + (check.dir ? " (" + check.dir + ")" : ""), command: ["npm", args[1]], session, stop: () => session.stop({ graceMs: 2000 }) });
    onSpawn?.(registration.id);
    const timer = setTimeout(() => session.stop({ graceMs: 2000 }).catch(() => {}), 600_000);
    try {
      const result = await session.completion;
      results.push({ dir: check.dir, exitCode: result.exitCode });
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: results.every((r) => r.exitCode === 0) ? "passed" : "failed", roots: results };
}

/**
 * Apply an update. `confirm` must be the typed word "update". A dirty tree is
 * refused unless `stash` is true. Emits {type: step|stdout|stderr, …}.
 */
export async function applyUpdate(root, { confirm, stash = false, backupOverwritten = false, emit = () => {}, onSpawn } = {}) {
  root = resolve(root);
  if (confirm !== CONFIRM_WORD) throw new Error('Updating requires typing "' + CONFIRM_WORD + '" to confirm');
  if (typeof stash !== "boolean") throw new Error("Invalid stash flag");
  if (typeof backupOverwritten !== "boolean") throw new Error("Invalid backup flag");
  const step = (name, text) => emit({ type: "step", step: name, text: text + "\n" });
  const run = (args, label, timeoutMs) => git(root, args, { emit, onSpawn, label, timeoutMs });
  // Validate the post-update hook before changing anything.
  const hooks = await resolveHooks(root);
  step("fetch", "Fetching from upstream…");
  const checked = await checkForUpdates(root, { onSpawn });
  if (!checked.git) throw new Error(checked.message);
  if (!checked.upstream) throw new Error(checked.message);
  if (checked.offline) throw new Error(checked.message);
  if (checked.ahead > 0)
    throw new Error("This branch has " + checked.ahead + " local commit(s) that are not upstream. Icode only fast-forwards; update it with git yourself.");
  if (!checked.behind) {
    const install = await reinstall(root, { emit, onSpawn });
    return { updated: false, message: "Already up to date.", install, hooks: [] };
  }
  if (checked.protectedPaths.length)
    throw Object.assign(
      new Error("The update would change the workshop's own state in .workshop/ (" + checked.protectedPaths.slice(0, 5).join(", ") + "). Icode never lets a course update touch learner playgrounds; ask the course author to stop tracking .workshop/."),
      { code: "PROTECTED", paths: checked.protectedPaths },
    );
  let backedUp = null;
  if (checked.overwrites.length) {
    if (!backupOverwritten)
      throw Object.assign(
        new Error("The update would overwrite local files that git does not track (" + checked.overwrites.slice(0, 5).join(", ") + (checked.overwrites.length > 5 ? ", …" : "") + "). Choose to back them up first, or move them yourself."),
        { code: "OVERWRITE", paths: checked.overwrites },
      );
    // Move each file to .workshop/update-backups/<time>/<same path> before git can touch it.
    const dir = join(".workshop", "update-backups", new Date().toISOString().replace(/[:.]/g, "-"));
    step("backup", "Backing up " + checked.overwrites.length + " local file(s) to " + dir.split(sep).join("/") + "…");
    for (const path of checked.overwrites) {
      const target = join(root, dir, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await rename(join(root, ...path.split("/")), target);
    }
    backedUp = { dir: dir.split(sep).join("/"), paths: checked.overwrites };
    Object.assign(checked, await updateStatus(root));
  }
  if (checked.dirtyCount && !stash)
    throw Object.assign(new Error("The course has uncommitted changes (" + checked.dirty.slice(0, 5).join(", ") + (checked.dirtyCount > 5 ? ", …" : "") + "). Commit them, or choose to stash them during the update."), { code: "DIRTY", dirty: checked.dirty });
  const from = out(await git(root, ["rev-parse", "HEAD"]));
  let stashed = false;
  const stashName = "icode-update-" + new Date().toISOString();
  if (checked.dirtyCount && stash) {
    step("stash", "Stashing local changes as " + stashName + "…");
    // git stash records a commit; supply an identity only if none is configured.
    const identity = out(await git(root, ["config", "user.email"])) ? [] : ["-c", "user.name=Icode Workshop", "-c", "user.email=workshop@localhost"];
    if (checked.allDirty.length > 500) throw new Error("Too many local changes to stash safely; commit or stash them with git yourself.");
    // Exactly the reported paths (learner data in .workshop is never included).
    const pathspecs = checked.allDirty.map((p) => ":(literal)" + p);
    const r = await run([...identity, "stash", "push", "--include-untracked", "-m", stashName, "--", ...pathspecs], "Update: git stash");
    if (r.code !== 0) throw new Error("Could not stash changes; nothing changed. " + r.stderr.trim());
    stashed = true;
  }
  step("merge", "Fast-forwarding to " + checked.upstream + "…");
  const merged = await run(["merge", "--ff-only", "@{u}"], "Update: git merge --ff-only", 120_000);
  if (merged.code !== 0) {
    if (stashed) await run(["stash", "pop"], "Update: git stash pop");
    throw new Error("Fast-forward failed; nothing changed. " + merged.stderr.trim().slice(-400));
  }
  const to = out(await git(root, ["rev-parse", "HEAD"]));
  const changed = out(await git(root, ["diff", "--name-only", from, to])).split("\n").filter(Boolean);
  let stashResult = null;
  if (stashed) {
    step("unstash", "Re-applying your stashed changes…");
    const popped = await run(["stash", "pop"], "Update: git stash pop");
    stashResult = popped.code === 0
      ? { restored: true }
      : { restored: false, message: "Your changes could not be re-applied cleanly. They are kept in the stash \"" + stashName + "\"; resolve with git stash pop. " + (popped.stderr + popped.stdout).trim().slice(-400) };
  }
  let install = { status: "skipped", message: "Dependencies unchanged." };
  if (changed.some((p) => /(^|\/)package(-lock)?\.json$/.test(p)) || (await installChecks(root)).some((c) => !c.ok)) {
    step("install", "Reinstalling dependencies…");
    install = await reinstall(root, { emit, onSpawn });
  }
  const results = [];
  if (hooks.postUpdate) {
    step("hook", "Running post-update hook (" + hooks.postUpdate.label + ")…");
    results.push(
      await runHook(root, hooks.postUpdate, {
        name: "post-update",
        context: { operation: "update", from, to, changedSteps: changedSteps(root, changed) },
        timeoutSeconds: hooks.timeoutSeconds,
        onSpawn,
        emit,
      }),
    );
  }
  return {
    updated: true,
    from: from.slice(0, 12),
    to: to.slice(0, 12),
    commits: checked.commits,
    changedSteps: changedSteps(root, changed),
    stash: stashResult,
    backedUp,
    install,
    hooks: results,
    message: "Updated " + from.slice(0, 7) + " → " + to.slice(0, 7) + ".",
  };
}
