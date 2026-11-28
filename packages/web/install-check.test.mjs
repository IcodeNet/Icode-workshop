import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCheck, doctor } from "./setup.mjs";

async function course({ pkg, lock, installed = {} }) {
  const root = await mkdtemp(join(tmpdir(), "icode-install-"));
  await mkdir(join(root, "exercises", "01", "problem"), { recursive: true });
  if (pkg) await writeFile(join(root, "package.json"), JSON.stringify(pkg));
  if (lock)
    await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
  for (const [name, version] of Object.entries(installed)) {
    await mkdir(join(root, "node_modules", name), { recursive: true });
    await writeFile(
      join(root, "node_modules", name, "package.json"),
      JSON.stringify({ name, version }),
    );
  }
  return root;
}
const pkg = {
  name: "c",
  dependencies: { left: "^1.0.0" },
  devDependencies: { tool: "2.0.0" },
};
const lock = {
  lockfileVersion: 3,
  packages: {
    "": {
      name: "c",
      dependencies: { left: "^1.0.0" },
      devDependencies: { tool: "2.0.0" },
    },
    "node_modules/left": { version: "1.2.0" },
    "node_modules/tool": { version: "2.0.0", dev: true },
    "node_modules/tool/node_modules/nested": { version: "0.1.0" },
    "node_modules/@esbuild/other-os": { version: "0.1.0", optional: true },
    "node_modules/workspace-pkg": { resolved: "packages/x", link: true },
  },
};

test("install check reports missing, mismatched, stale and installed dependencies", async () => {
  const cases = [
    [{}, "no-package", true],
    [{ pkg: { name: "c" } }, "no-dependencies", true],
    [{ pkg, lock }, "missing", false],
    [
      {
        pkg,
        lock,
        installed: {
          left: "1.2.0",
          tool: "2.0.0",
          "tool/node_modules/nested": "0.1.0",
        },
      },
      "installed",
      true,
    ],
    [
      {
        pkg,
        lock,
        installed: {
          left: "1.1.0",
          tool: "2.0.0",
          "tool/node_modules/nested": "0.1.0",
        },
      },
      "mismatch",
      false,
    ],
    [
      { pkg: { ...pkg, dependencies: { left: "^2.0.0" } }, lock },
      "lock-outdated",
      false,
    ],
    [{ pkg }, "missing", false],
    [{ pkg, installed: { left: "1.0.0", tool: "2.0.0" } }, "unlocked", true],
  ];
  for (const [input, status, ok] of cases) {
    const root = await course(input);
    try {
      const result = await installCheck(root);
      assert.equal(result.status, status, JSON.stringify(result));
      assert.equal(result.ok, ok);
      if (!ok) assert.match(result.fix, /^cd ".*" && npm (ci|install)$/);
      if (status === "missing" && input.lock) {
        assert.deepEqual(result.missing.sort(), ["left", "nested", "tool"]);
        assert.match(result.fix, /npm ci$/);
      }
      if (status === "mismatch")
        assert.match(result.message, /left \(1\.1\.0 ≠ 1\.2\.0\)/);
      if (status === "lock-outdated") assert.match(result.fix, /npm install$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("doctor includes the install check", async () => {
  const root = await course({ pkg, lock });
  try {
    const report = await doctor(root);
    const check = report.checks.find((c) => c.name === "Course dependencies");
    assert.equal(check.ok, false);
    assert.equal(report.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("independent package roots are checked too; workspace members are not", async () => {
  const root = await course({ pkg: { name: "root", workspaces: ["packages/*"] } });
  try {
    const { packageRoots, installChecks } = await import("./setup.mjs");
    const write = async (dir, manifest) => {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, "package.json"), JSON.stringify(manifest));
    };
    await write("packages/member", { name: "member", dependencies: { left: "1.0.0" } });
    await write("exercises/01/problem", { name: "app", dependencies: { left: "1.0.0" } });
    await write("node_modules/ignored", { name: "ignored" });
    await write(".workshop/playgrounds/01", { name: "learner" });
    assert.deepEqual(await packageRoots(root), ["", "exercises/01/problem"]);
    const checks = await installChecks(root);
    assert.deepEqual(checks.map((c) => [c.dir, c.ok]), [["", true], ["exercises/01/problem", false]]);
    const report = await doctor(root);
    const nested = report.checks.find((c) => c.name === "Course dependencies (exercises/01/problem)");
    assert.equal(nested.ok, false);
    assert.match(nested.fix, /npm install/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
