import {
  listFiles,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
} from "./files.mjs";
import { replaceWorkspace } from "./workspaces.mjs";
import { labConfig } from "./runtime.mjs";

// Three-way, whole-file reconciliation: conflicts are explicit and never silently overwritten.
export async function planMigration(root, sourceId, targetId) {
  if (sourceId === targetId)
    throw new Error("Choose a different source lesson");
  const [source, target] = await Promise.all([
    labConfig(root, sourceId),
    labConfig(root, targetId),
  ]);
  if (source.runtime !== target.runtime)
    throw new Error("Migration requires matching runtimes");
  const [base, ours, theirs] = await Promise.all([
    listFiles(root, sourceId, "problem"),
    listFiles(root, sourceId, "playground"),
    listFiles(root, targetId, "problem"),
  ]);
  const changes = [],
    conflicts = [];
  for (const name of [...new Set([...base, ...ours, ...theirs])].sort()) {
    const b = base.includes(name)
      ? await readProjectFile(root, sourceId, name, "problem")
      : null;
    const o = ours.includes(name)
      ? await readProjectFile(root, sourceId, name)
      : null;
    const t = theirs.includes(name)
      ? await readProjectFile(root, targetId, name, "problem")
      : null;
    if (o === b || o === t) continue;
    if (t === b) changes.push({ name, code: o });
    else conflicts.push({ name, base: b, source: o, target: t });
  }
  return { sourceId, targetId, changes, conflicts };
}
export async function migrateWorkspace(root, sourceId, targetId) {
  const plan = await planMigration(root, sourceId, targetId);
  if (plan.conflicts.length) return { applied: false, ...plan };
  const replacement = await replaceWorkspace(root, targetId, {
    variant: "problem",
  });
  try {
    for (const { name, code } of plan.changes) {
      if (code === null) await deleteProjectFile(root, targetId, name);
      else await writeProjectFile(root, targetId, name, code);
    }
  } catch (error) {
    if (replacement.backup)
      await replaceWorkspace(root, targetId, {
        backup: replacement.backup.split(/[\\/]/).at(-1),
      });
    throw error;
  }
  return { applied: true, ...plan, backup: replacement.backup };
}
