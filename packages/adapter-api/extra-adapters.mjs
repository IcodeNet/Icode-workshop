import { execute, fileExists } from "./node.mjs";
import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const diagnostic = (context, message) =>
  context.emit?.({ type: "diagnostic", text: message + "\n" });
async function detect(executable, args, context, label) {
  try {
    const result = await execute(executable, args, context);
    return [
      {
        level: result.exitCode === 0 ? "info" : "error",
        message:
          label + (result.exitCode === 0 ? " available" : " is not ready"),
      },
    ];
  } catch {
    return [
      {
        level: "error",
        message:
          label +
          " unavailable. Install/configure its toolchain before running this lab.",
      },
    ];
  }
}
async function requireFile(context, name) {
  if (!(await fileExists(context.workspaceRoot, name)))
    throw new Error("Required project file missing: " + name);
}
function requireTests(context, count, result) {
  if (result.exitCode === 0 && !result.aborted && count < 1) {
    diagnostic(
      context,
      "No executed tests were reported; cannot pass this lab.",
    );
    return { ...result, exitCode: 1 };
  }
  return result;
}
export function createRustAdapter({ executable = "cargo" } = {}) {
  return {
    id: "rust",
    apiVersion: 1,
    detect: (context) =>
      detect(executable, ["--version"], context, "Rust/Cargo"),
    prepare: (context) => requireFile(context, "Cargo.toml"),
    async run(command, context) {
      if (!["test", "build", "run"].includes(command))
        throw new Error("Unsupported Rust command");
      let output = "";
      const result = await execute(
        executable,
        [
          command,
          "--offline",
          ...(command === "test" ? ["--", "--nocapture"] : []),
        ],
        {
          ...context,
          emit: (event) => {
            output = (output + event.text).slice(-50000);
            context.emit?.(event);
          },
        },
      );
      const count = [
        ...output.matchAll(/test result:.*?\b(\d+) passed;/g),
      ].reduce((n, match) => n + Number(match[1]), 0);
      return command === "test" ? requireTests(context, count, result) : result;
    },
  };
}
export function createDotnetAdapter({ executable = "dotnet" } = {}) {
  return {
    id: "dotnet",
    apiVersion: 1,
    detect: (context) => detect(executable, ["--version"], context, ".NET SDK"),
    async prepare(context) {
      if (
        !(await readdir(context.workspaceRoot)).some((name) =>
          /\.(csproj|sln|slnx)$/.test(name),
        )
      )
        throw new Error(
          "A .NET project or solution is required at the project root",
        );
    },
    async run(command, context) {
      if (!["test", "build", "run"].includes(command))
        throw new Error("Unsupported .NET command");
      const reports = join(
        context.workspaceRoot,
        ".workshop-results-" + randomUUID(),
      );
      await mkdir(reports);
      try {
        const args =
          command === "test"
            ? ["test", "--logger", "trx", "--results-directory", reports]
            : [command];
        const result = await execute(executable, args, context);
        let executed = 0;
        if (command === "test" && result.exitCode === 0) {
          for (const name of await readdir(reports))
            if (name.endsWith(".trx")) {
              const xml = await readFile(join(reports, name), "utf8");
              const counters = xml.match(/<Counters\b[^>]*>/)?.[0] || "";
              executed += Number(
                counters.match(/\bexecuted="(\d+)"/)?.[1] || 0,
              );
              if (Number(counters.match(/\bfailed="(\d+)"/)?.[1] || 0))
                return { ...result, exitCode: 1 };
            }
        }
        return command === "test"
          ? requireTests(context, executed, result)
          : result;
      } finally {
        await rm(reports, { recursive: true, force: true });
      }
    },
  };
}
export function createJupyterAdapter({
  executable = process.env.WORKSHOP_JUPYTER_PYTHON || "python3",
} = {}) {
  return {
    id: "jupyter",
    apiVersion: 1,
    detect: (context) =>
      detect(
        executable,
        [
          "-c",
          "import nbclient, nbformat, ipykernel, zmq; c=zmq.Context(); s=c.socket(zmq.REP); s.bind('tcp://127.0.0.1:*'); s.close(); c.term()",
        ],
        context,
        "Jupyter Python kernel/nbclient",
      ),
    prepare: (context) => requireFile(context, "notebook.ipynb"),
    async run(command, context) {
      if (!["test", "run"].includes(command))
        throw new Error("Notebook supports run/test only");
      return execute(
        executable,
        [
          fileURLToPath(new URL("./notebook-runner.py", import.meta.url)),
          command,
        ],
        context,
      );
    },
  };
}
export function createDockerAdapter({ executable = "docker" } = {}) {
  return {
    id: "docker",
    apiVersion: 1,
    async detect(context) {
      const daemon = await detect(
        executable,
        ["info"],
        { ...context, emit: undefined },
        "Docker daemon",
      );
      if (daemon.some((item) => item.level === "error")) return daemon;
      return detect(
        executable,
        ["compose", "version"],
        context,
        "Docker Compose",
      );
    },
    prepare: (context) => requireFile(context, "compose.yaml"),
    async run(command, context) {
      if (command !== "test")
        throw new Error(
          "Docker adapter supports the compose test service only",
        );
      const project = "icode-" + randomUUID(),
        report = join(context.workspaceRoot, ".workshop-results.json");
      await rm(report, { force: true });
      try {
        const result = await execute(
          executable,
          ["compose", "-p", project, "run", "--rm", "--no-deps", "test"],
          context,
        );
        if (result.exitCode !== 0 || result.aborted) return result;
        let data;
        try {
          data = JSON.parse(await readFile(report, "utf8"));
        } catch {
          diagnostic(
            context,
            "Container must write .workshop-results.json with passed and failed counts.",
          );
          return { ...result, exitCode: 1 };
        }
        if (
          !Number.isInteger(data.passed) ||
          data.passed < 1 ||
          data.failed !== 0
        )
          return { ...result, exitCode: 1 };
        return result;
      } finally {
        // Cancellation must also stop owned containers; killing the CLI alone is insufficient.
        await execute(
          executable,
          [
            "compose",
            "-p",
            project,
            "down",
            "--remove-orphans",
            "--timeout",
            "2",
          ],
          { ...context, signal: AbortSignal.timeout(15000) },
        );
      }
    },
  };
}
