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
