import { existsSync, realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, dirname, delimiter, resolve } from "node:path";
import { createRequire } from "node:module";
import { execute } from "../adapter-api/node.mjs";
import { hostConfig, discoverSteps } from "../core/layout.mjs";

export function npmCLI() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const p = join(directory, process.platform === "win32" ? "npm.cmd" : "npm");
    if (existsSync(p)) {
      if (process.platform === "win32")
        candidates.push(join(directory, "node_modules/npm/bin/npm-cli.js"));
      else candidates.push(realpathSync(p));
    }
  }
  const cli = candidates.find(
    (p) => p && /npm-cli\.js$/.test(p) && existsSync(p),
  );
  if (!cli)
    throw new Error("npm CLI not found. Install Node.js with npm and retry.");
  return cli;
}
export function courseEnvironment(root) {
  return {
    PATH:
      join(resolve(root), "node_modules", ".bin") +
      delimiter +
      process.env.PATH,
    WORKSHOP_CONTENT: resolve(root),
  };
}
export async function prepareWorkspace(root, workspaceRoot) {
  const config = hostConfig(root);
  if (!config.seed) return;
  if (
    typeof config.seed !== "string" ||
    !/^[\w/-]+\.(ts|js|mjs)$/.test(config.seed) ||
    config.seed.split("/").includes("..")
  )
    throw new Error("Invalid seed path");
  const seed = join(workspaceRoot, config.seed);
  try {
    await access(seed);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  const require = createRequire(join(resolve(root), "package.json"));
  const loader = require.resolve("tsx");
  let output = "";
  const result = await execute(process.execPath, ["--import", loader, seed], {
    workspaceRoot,
    env: courseEnvironment(root),
    signal: AbortSignal.timeout(30000),
    emit: (e) => {
      output += e.text;
    },
  });
  if (result.exitCode !== 0 || result.aborted)
    throw new Error("Workspace seed failed: " + output.slice(-2000));
}
async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return undefined;
    throw new Error("Could not parse " + path + ": " + e.message);
  }
}
const quote = (path) => '"' + path.replaceAll('"', '\\"') + '"';
const summarise = (names) =>
  names.slice(0, 8).join(", ") + (names.length > 8 ? ` and ${names.length - 8} more` : "");
/**
 * Check that the course root dependencies are installed and match
 * package-lock.json. Never runs npm; reads package.json files only.
 */
export async function installCheck(root) {
  root = resolve(root);
  const name = "Course dependencies";
  const manifest = await readJsonFile(join(root, "package.json"));
  if (!manifest)
    return { name, ok: true, status: "no-package", message: "No package.json at the course root." };
  const declared = {
    ...manifest.optionalDependencies,
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  if (!Object.keys(declared).length)
    return { name, ok: true, status: "no-dependencies", message: "No dependencies declared." };
  const lock = await readJsonFile(join(root, "package-lock.json"));
  const installCommand = `cd ${quote(root)} && npm ${lock ? "ci" : "install"}`;
  const installed = async (path) =>
    (await readJsonFile(join(root, path, "package.json")))?.version;
  if (!lock || !lock.packages) {
    const missing = [];
    for (const dependency of Object.keys(declared))
      if (!(await installed(join("node_modules", dependency)))) missing.push(dependency);
    return missing.length
      ? {
          name,
          ok: false,
          status: "missing",
          missing,
          message: (lock ? "package-lock.json is too old to verify (lockfileVersion 1). " : "No package-lock.json. ") + "Missing: " + summarise(missing),
          fix: installCommand,
        }
      : {
          name,
          ok: true,
          status: lock ? "installed" : "unlocked",
          message: lock ? "Installed (lockfile too old to verify versions)." : "Installed, but there is no package-lock.json to verify versions against.",
        };
  }
  const locked = lock.packages[""] || {};
  const lockedDeclared = {
    ...locked.optionalDependencies,
    ...locked.devDependencies,
    ...locked.dependencies,
  };
  const stale = Object.keys(declared).filter((d) => lockedDeclared[d] !== declared[d]);
  if (stale.length)
    return {
      name,
      ok: false,
      status: "lock-outdated",
      message: "package-lock.json does not match package.json for: " + summarise(stale),
      fix: `cd ${quote(root)} && npm install`,
    };
  const missing = [],
    mismatched = [];
  const entries = Object.entries(lock.packages).filter(
    ([path, info]) => path.startsWith("node_modules/") &&
      // Lockfile keys are confined to the course root.
      !path.split("/").some((part) => part === ".." || part === "." || !part) &&
      !path.includes("\\") &&
      !info.link &&
      !info.extraneous,
  );
  for (let i = 0; i < entries.length; i += 64)
    await Promise.all(
      entries.slice(i, i + 64).map(async ([path, info]) => {
        const version = await installed(path);
        const label = path.replace(/^(.*\/)?node_modules\//, "");
        if (version === undefined) {
          if (!info.optional && !info.devOptional) missing.push(label);
        } else if (info.version && version !== info.version)
          mismatched.push(label + " (" + version + " ≠ " + info.version + ")");
      }),
    );
  if (missing.length || mismatched.length)
    return {
      name,
      ok: false,
      status: missing.length ? "missing" : "mismatch",
      missing,
      mismatched,
      message: [
        missing.length && "Missing: " + summarise(missing),
        mismatched.length && "Different from package-lock.json: " + summarise(mismatched),
      ]
        .filter(Boolean)
        .join(". "),
      fix: installCommand,
    };
  return {
    name,
    ok: true,
    status: "installed",
    message: `${entries.length} packages match package-lock.json.`,
  };
}
const workspacePattern = (pattern) =>
  new RegExp(
    "^" +
      pattern
        .replace(/^\.\//, "")
        .replace(/\/+$/, "")
        .split("/")
        .map((part) => (part === "**" ? ".*" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")))
        .join("/") +
      "$",
  );
/**
 * Independent package roots of a course (Epic's B7 also checks apps with
 * their own package.json): every directory with a package.json, except
 * dependency, dot and .workshop directories and workspace members of a root.
 * Paths are relative, with "/"; the course root is "".
 */
export async function packageRoots(root, { maxDepth = 6, maxRoots = 200 } = {}) {
  root = resolve(root);
  const { readdir } = await import("node:fs/promises");
  const found = [];
  async function walk(dir, rel, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "package.json")) found.push(rel);
    if (depth >= maxDepth || found.length >= maxRoots) return;
    for (const entry of entries)
      if (entry.isDirectory() && !entry.name.startsWith(".") && !["node_modules", "__pycache__", "target", "bin", "obj"].includes(entry.name))
        await walk(join(dir, entry.name), rel ? rel + "/" + entry.name : entry.name, depth + 1);
  }
  await walk(root, "", 0);
  const members = new Set();
  for (const rel of found) {
    const manifest = await readJsonFile(join(root, rel, "package.json")).catch(() => undefined);
    const patterns = Array.isArray(manifest?.workspaces) ? manifest.workspaces : manifest?.workspaces?.packages ?? [];
    for (const pattern of patterns.filter((p) => typeof p === "string" && !p.startsWith("!"))) {
      const regex = workspacePattern(pattern);
      for (const other of found) {
        const inner = rel ? (other.startsWith(rel + "/") ? other.slice(rel.length + 1) : null) : other;
        if (inner && regex.test(inner)) members.add(other);
      }
    }
  }
  return found.filter((rel) => !members.has(rel));
}
/** installCheck for every independent package root; the course root first. */
export async function installChecks(root) {
  const results = [];
  for (const rel of await packageRoots(root)) {
    const check = await installCheck(join(resolve(root), rel));
    results.push({ ...check, dir: rel, name: rel ? "Course dependencies (" + rel + ")" : check.name });
  }
  if (!results.length || results[0].dir !== "") results.unshift({ ...(await installCheck(root)), dir: "" });
  return results;
}
export async function doctor(root) {
  const config = hostConfig(root),
    steps = discoverSteps(root),
    checks = [];
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8").catch((e) => {
      if (e.code === "ENOENT") return "{}";
      throw e;
    }),
  );
  const minimum = manifest.engines?.node;
  const match = minimum?.match(/^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  const current = process.versions.node.split(".").map(Number);
  const required = match
    ? match.slice(1).map((x) => Number(x || 0))
    : [22, 0, 0];
  const ok =
    current[0] > required[0] ||
    (current[0] === required[0] &&
      (current[1] > required[1] ||
        (current[1] === required[1] && current[2] >= required[2])));
  checks.push({
    name: "Node.js",
    ok,
    message: `${process.versions.node}; requires ${minimum || ">=22"}`,
  });
  try {
    npmCLI();
    checks.push({ name: "npm", ok: true });
  } catch (e) {
    checks.push({ name: "npm", ok: false, message: e.message });
  }
  if (config.format === "epic")
    for (const dependency of [
      "vitest",
      "tsx",
      "@modelcontextprotocol/inspector",
    ]) {
      try {
        createRequire(join(resolve(root), "package.json")).resolve(
          dependency + "/package.json",
        );
        checks.push({ name: dependency, ok: true });
      } catch {
        checks.push({
          name: dependency,
          ok: false,
          message: "Run workshop setup to install course dependencies.",
        });
      }
    }
  const [rootCheck, ...nested] = await installChecks(root);
  checks.push(rootCheck);
  // Other package roots are reported only when they need attention.
  checks.push(...nested.filter((c) => !c.ok));
  return { ok: checks.every((c) => c.ok), steps: steps.length, checks };
}
export async function setupCourse(root, { emit } = {}) {
  discoverSteps(root);
  const before = await doctor(root);
  if (before.checks.some((c) => ["Node.js", "npm"].includes(c.name) && !c.ok))
    throw new Error(JSON.stringify(before));
  const result = await execute(
    process.execPath,
    [npmCLI(), "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    { workspaceRoot: resolve(root), emit, signal: AbortSignal.timeout(300000) },
  );
  if (result.exitCode !== 0 || result.aborted)
    throw new Error(
      "Dependency installation failed; fix package-lock.json or connectivity before retrying.",
    );
  // Seed only newly created persistent workspaces; never overwrite learner work on repeated setup.
  const { selectWorkspace } = await import("./workspaces.mjs");
  await selectWorkspace(root, discoverSteps(root)[0].id);
  const resultDoctor = await doctor(root);
  if (!resultDoctor.ok) throw new Error(JSON.stringify(resultDoctor));
  return resultDoctor;
}
