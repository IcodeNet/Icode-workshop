// Live reload: watch a step's playground and fan change events out to
// subscribers (the UI over server-sent events). One fs.watch per playground,
// closed when the last subscriber leaves.
import { watch } from "node:fs";
import { workspacePath } from "./workspaces.mjs";
import { assertSafePath } from "./files.mjs";

const IGNORED =
  /(^|[\\/])(node_modules|__pycache__|target|bin|obj)([\\/]|$)|(^|[\\/])\./;
const watchers = new Map();

/** True when a changed relative path is something the editor would show. */
export function isWatchedPath(name) {
  return (
    Boolean(name) &&
    !IGNORED.test(name) &&
    !/\.(sqlite|db)(-wal|-shm)?$/.test(name)
  );
}

/**
 * Subscribe to changes in the playground for `id`. `listener` receives
 * `{ id, name }` (name uses forward slashes) after a short debounce.
 * Returns an unsubscribe function.
 */
export async function watchPlayground(
  root,
  id,
  listener,
  { debounceMs = 120 } = {},
) {
  const path = await assertSafePath(workspacePath(root, id));
  let entry = watchers.get(path);
  if (!entry) {
    const listeners = new Set();
    const timers = new Map();
    const watcher = watch(
      path,
      { recursive: true, persistent: false },
      (_event, filename) => {
        const name = filename ? String(filename).replaceAll("\\", "/") : "";
        if (name && !isWatchedPath(name)) return;
        clearTimeout(timers.get(name));
        timers.set(
          name,
          setTimeout(() => {
            timers.delete(name);
            for (const item of listeners) item({ id, name });
          }, debounceMs),
        );
      },
    );
    watcher.on("error", () => {
      for (const item of listeners)
        item({ id, name: "", error: "watch failed" });
    });
    entry = { watcher, listeners, timers };
    watchers.set(path, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) {
      for (const timer of entry.timers.values()) clearTimeout(timer);
      entry.watcher.close();
      if (watchers.get(path) === entry) watchers.delete(path);
    }
  };
}
export function closeAllWatchers() {
  for (const entry of watchers.values()) entry.watcher.close();
  watchers.clear();
}
