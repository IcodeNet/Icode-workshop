import { fileURLToPath } from "node:url";
import { stepLayout, hostConfig } from "../core/layout.mjs";
import { courseEnvironment, npmCLI } from "./setup.mjs";
import { execute } from "../adapter-api/node.mjs";
import {
  createRustAdapter,
  createDotnetAdapter,
  createJupyterAdapter,
  createDockerAdapter,
} from "../adapter-api/extra-adapters.mjs";
import { validateMedia } from "./course.mjs";
import { validatePreview } from "./previews.mjs";
import { validateTools } from "./tools.mjs";
import { validateApp, validateCloudEditor } from "./content-config.mjs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createAdapterRegistry, loadAdapters } from "../adapter-api/index.mjs";
import { nodeAdapter } from "../adapter-api/node-adapter.mjs";
import { createPythonAdapter } from "../adapter-api/python-adapter.mjs";
import { validateId } from "../core/index.mjs";

export const registry = createAdapterRegistry();
registry.register(nodeAdapter);
registry.register(createPythonAdapter());
for (const adapter of [
  createRustAdapter(),
  createDotnetAdapter(),
  createJupyterAdapter(),
  createDockerAdapter(),
])
  registry.register(adapter);
// Explicit operator configuration, never derived from exercise manifests.
await loadAdapters(registry, JSON.parse(process.env.WORKSHOP_ADAPTERS || "[]"));

export async function labConfig(root, id) {
  validateId(id);
  let config;
  const layout = stepLayout(root, id);
  const host = hostConfig(root);
  try {
    config = JSON.parse(
      await readFile(join(root, "exercises", id, "lab.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    config = layout.apps
      ? {
          runtime: "node",
          entry: "src/index.ts",
          title: layout.title,
          description: layout.module,
          testScript: host.testScript,
          testArgs: host.testArgs,
          preview: host.inspector
            ? {
                command: [
                  process.execPath,
                  fileURLToPath(
                    new URL("../cli/inspector.mjs", import.meta.url),
                  ),
                ],
                port: 4400 + Number(id),
              }
            : undefined,
        }
      : { runtime: "node", entry: "index.mjs" };
  }
  if (!registry.get(config.runtime))
    throw new Error("Unsupported lab runtime: " + config.runtime);
  const entry =
    config.runtime === "python"
      ? "main.py"
      : config.runtime === "node"
        ? "index.mjs"
        : config.entry;
  if (!entry) throw new Error("Third-party runtime requires an entry file");
  if (config.schemaVersion !== undefined && config.schemaVersion !== 1)
    throw new Error("Unsupported manifest version");
  if (config.entry && !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(config.entry))
    throw new Error("Invalid entry file");
  if (config.entry?.split("/").includes(".."))
    throw new Error("Invalid entry file");
  return {
    testScript: config.testScript,
    testArgs: config.testArgs,
    media: validateMedia(config.media),
    tools: validateTools(config.tools),
    preview: validatePreview(config.preview),
    // Optional: app served by the sandbox, in-browser tests,
    // cloud-editor overrides, test tab.
    app: validateApp(config.app),
    cloudEditor: validateCloudEditor(config.cloudEditor),
    testTab: config.testTab === undefined ? undefined : config.testTab === false ? false : (() => { throw new Error("testTab must be false or omitted"); })(),
    runtime: config.runtime,
    entry: config.entry || entry,
    title: config.title ?? "Exercise " + id,
    description:
      config.description ?? "Complete the exercise and run its tests.",
  };
}

async function runLab(
  root,
  id,
  { timeoutMs, workspaceRoot, emit, signal, onSpawn } = {},
) {
  const config = await labConfig(root, id);
  const adapter = registry.require(config.runtime);
  const controller = new AbortController();
  const events = [];
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? (["node", "python"].includes(config.runtime) ? 15000 : 120000),
  );
  try {
    const context = {
      workspaceRoot:
        workspaceRoot || join(root, ".workshop", "playgrounds", id),
      signal: controller.signal,
      env: courseEnvironment(root),
      onSpawn,
      emit: (event) => {
        if (events.join("").length < 50000) {
          events.push(event.text);
          emit?.(event);
        }
      },
    };
    const diagnostics = await adapter.detect(context);
    if (diagnostics.some((item) => item.level === "error"))
      return {
        passed: false,
        status: "unavailable",
        diagnostics,
        runtime: config.runtime,
        output: diagnostics.map((item) => item.message).join("\n"),
      };
    const entries = await readdir(context.workspaceRoot, { recursive: true });
    const hasTests =
      (config.runtime !== "node" && config.runtime !== "python") ||
      entries.some((path) => {
        const name = path.split("/").at(-1);
        return config.runtime === "python"
          ? /^test_.*\.py$|^.*_test\.py$/.test(name)
          : /(?:^test.*|.*\.test)\.(?:mjs|js|cjs|ts|tsx|mts)$/.test(name);
      });
    if (!hasTests)
      return {
        passed: false,
        runtime: config.runtime,
        status: "no-tests",
        output: "No test files found; cannot report a passing lab.",
      };
    await adapter.prepare(context);
    if (
      config.testScript &&
      (!/^[a-zA-Z0-9:_-]+$/.test(config.testScript) ||
        !Array.isArray(config.testArgs) ||
        config.testArgs.some((x) => typeof x !== "string"))
    )
      throw new Error("Invalid test script configuration");
    const result = config.testScript
      ? await execute(
          process.execPath,
          [npmCLI(), "run", config.testScript, "--", ...config.testArgs],
          context,
        )
      : await adapter.run("test", context);
    return {
      passed: result.exitCode === 0 && !result.aborted,
      status: result.aborted
        ? signal?.aborted
          ? "cancelled"
          : "timeout"
        : result.exitCode === 0
          ? "passed"
          : "failed",
      exitCode: result.exitCode,
      diagnostics,
      runtime: config.runtime,
      output:
        events.join("").slice(0, 50000) +
        (result.aborted ? "\nExecution timed out." : ""),
    };
  } catch (error) {
    return {
      passed: false,
      runtime: config.runtime,
      status: controller.signal.aborted
        ? signal?.aborted
          ? "cancelled"
          : "timeout"
        : "error",
      output: events.join("").slice(0, 45000) + "\n" + error.message,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function testLab(root, id, options = {}) {
  const started = Date.now();
  const result = await runLab(root, id, options);
  return {
    ...result,
    summary: {
      status: result.status || (result.passed ? "passed" : "failed"),
      runtime: result.runtime,
      durationMs: Date.now() - started,
      exitCode: result.exitCode ?? null,
      diagnostics: result.diagnostics || [],
    },
  };
}
