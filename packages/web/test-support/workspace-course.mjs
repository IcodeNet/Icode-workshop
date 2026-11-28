// Fixtures for Stage 2 (hooks, saved playgrounds, diffs, update).
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function writeTree(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, ...name.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

// macOS's tmpdir (/var/folders/…) is reached through the /var symlink, which
// the engine refuses on purpose; use the real path.
const tempRoot = async (prefix) => realpath(await mkdtemp(join(tmpdir(), prefix)));

/** Native course: two steps, optional hooks/scripts/extra files. */
export async function nativeCourse({ hooks, scripts = {}, files = {}, course = {} } = {}) {
  const root = await tempRoot("icode-ws-");
  await writeTree(root, {
    "course.json": { schemaVersion: 1, title: "Workspace course", ...(hooks ? { hooks } : {}), ...course },
    "package.json": { name: "workspace-course", private: true, scripts },
    "exercises/01/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "First" },
    "exercises/01/problem/index.mjs": "export const value = 1;\n// TODO\n",
    "exercises/01/problem/util.mjs": "export const same = true;\n",
    "exercises/01/problem/README.md": "problem readme\n",
    "exercises/01/solution/index.mjs": "export const value = 2;\n// TODO\n",
    "exercises/01/solution/util.mjs": "export const same = true;\n",
    "exercises/01/solution/extra.mjs": "export const extra = 3;\n",
    "exercises/01/solution/README.md": "solution readme\n",
    "exercises/02/lab.json": { schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Second" },
    "exercises/02/problem/index.mjs": "export const value = 2;\n",
    "exercises/02/solution/index.mjs": "export const value = 3;\n",
    ...files,
  });
  return root;
}

/** Epic-layout course with per-app and root hook files. */
export async function epicCourse({ files = {}, pkg = {} } = {}) {
  const root = await tempRoot("icode-epic-ws-");
  await writeTree(root, {
    "workshop.json": { schemaVersion: 1, format: "epic" },
    "package.json": { name: "epic-course", private: true, ...pkg },
    "exercises/01.basics/01.problem.start/src/index.ts": "export const a = 1\n",
    "exercises/01.basics/01.solution.start/src/index.ts": "export const a = 2\n",
    ...files,
  });
  return root;
}

/** A hook script that records its environment to `<root>/<name>.json`. */
export const recorderScript = (name) => `import { writeFileSync, appendFileSync } from "node:fs";
const keys = Object.keys(process.env).filter((k) => k.startsWith("ICODE_") || k.startsWith("EPICSHOP_"));
writeFileSync(${JSON.stringify(name + ".json")}, JSON.stringify(Object.fromEntries(keys.map((k) => [k, process.env[k]]))));
appendFileSync("order.log", ${JSON.stringify(name)} + "\\n");
console.log("\\x1b[32mhook ${name} ran\\x1b[0m");
`;
