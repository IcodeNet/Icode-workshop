// Every operation that replaces a step's playground goes through here:
// pre-set-playground hook → automatic save → stop preview → change →
// post-set-playground hook → restart the preview if it was running.
import { lstat } from "node:fs/promises";
import { resolveHooks, runHook } from "./hooks.mjs";
import { autoSave } from "./saved-playgrounds.mjs";
import { workspacePath } from "./workspaces.mjs";
import { runningPreviews, startPreview, stopPreview } from "./previews.mjs";

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param operation create | reset | replace | migrate | restore | sync
 * @param source {step, variant, savedId?} where the new content comes from
 * @param srcDir absolute directory of the source (for apps-layout per-app hooks)
 * @param change async () => result (performs the replacement)
 * @param options.save save the current playground first (default: true unless create)
 */
export async function withPlaygroundHooks(root, id, { operation, source, srcDir, save = operation !== "create", hooks: runHooks = true }, change, { onSpawn } = {}) {
  const destDir = workspacePath(root, id);
  // Per-app hook files (apps layout) are trusted only in authored directories,
  // never in learner-controlled ones (playgrounds, backups, saved playgrounds).
  const authored = ["problem", "solution"].includes(source?.variant);
  const hooks = runHooks ? await resolveHooks(root, { stepId: id, srcDir: authored ? srcDir : undefined }) : {};
  const preview = runningPreviews().find((p) => p.id === id);
  // Resolved before any hook starts; hooks never see a Promise.
  const wasRunning = Boolean(preview && preview.variant === "playground");
  const timestamp = Date.now();
  const base = { operation, step: id, source, srcDir: srcDir ?? null, destDir, timestamp, wasRunning };
  const results = [];
  if (hooks.preSetPlayground) {
    const pre = await runHook(root, hooks.preSetPlayground, {
      name: "pre-set-playground",
      context: base,
      timeoutSeconds: hooks.timeoutSeconds,
      onSpawn,
    });
    results.push(pre);
    if (pre.status !== "passed")
      throw Object.assign(new Error("The pre-set-playground hook " + pre.status + "; the playground was not changed."), { hooks: results });
  }
  const saved = save ? await autoSave(root, id, operation, source) : null;
  if (preview) await stopPreview(id);
  let result;
  try {
    result = await change();
  } catch (e) {
    e.hooks = results;
    throw e;
  }
  // The engine stopped the preview above, so it is not still running.
  const isStillRunning = runningPreviews().some((p) => p.id === id && p.variant === "playground");
  const restartPlayground = wasRunning && !isStillRunning;
  if (hooks.postSetPlayground)
    results.push(
      await runHook(root, hooks.postSetPlayground, {
        name: "post-set-playground",
        context: { ...base, isStillRunning, restartPlayground },
        timeoutSeconds: hooks.timeoutSeconds,
        onSpawn,
      }),
    );
  let previewRestarted = null;
  if (restartPlayground) {
    try {
      previewRestarted = (await startPreview(root, id, "playground")).url;
    } catch (e) {
      previewRestarted = { error: e.message };
    }
  }
  return {
    ...result,
    hooks: results,
    saved: saved?.saved ? { savedId: saved.saved.savedId } : null,
    savedSkipped: saved?.skipped ?? null,
    previewRestarted,
    exists: await exists(destDir),
  };
}
