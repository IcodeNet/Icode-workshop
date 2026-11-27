import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { variantRoot, assertSafePath, listFiles } from "./files.mjs";

// References execute in disposable copies, never in author-owned source trees.
export async function executionWorkspace(root, id, variant = "playground") {
  const source = variantRoot(root, id, variant);
  await assertSafePath(source);
  if (variant === "playground")
    return { path: source, cleanup: async () => {} };
  await listFiles(root, id, variant);
  const base = await assertSafePath(join(root, ".workshop", "runs"));
  await mkdir(base, { recursive: true });
  const path = await mkdtemp(join(base, id + "-" + variant + "-"));
  try {
    await cp(source, path, { recursive: true, dereference: false });
  } catch (e) {
    await rm(path, { recursive: true, force: true });
    throw e;
  }
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
