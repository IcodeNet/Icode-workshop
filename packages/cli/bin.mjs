#!/usr/bin/env node
import { setupCourse, doctor } from "../web/setup.mjs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { startProcess } from "../adapter-api/node.mjs";
import { fileURLToPath } from "node:url";
import { courseConfig, readProgress } from "../web/course.mjs";
import { selectWorkspace, replaceWorkspace } from "../web/workspaces.mjs";
import { testLab, labConfig } from "../web/runtime.mjs";
import { listFiles, readProjectFile } from "../web/files.mjs";
import { courseOperations } from "../web/operations.mjs";
const args = process.argv.slice(2),
  command = args[0],
  contentFlag = args.indexOf("--content");
const content = resolve(contentFlag < 0 ? "." : (args[contentFlag + 1] ?? "."));
const id = args[1];
async function main() {
  if (command === "doctor") { const report = await doctor(content); console.log(JSON.stringify(report,null,2)); process.exitCode = report.ok ? 0 : 1; return; }
  if (command === "setup") return console.log(JSON.stringify(await setupCourse(content, {emit: e=>process.stdout.write(e.text)}),null,2));
  if (command === "list")
    return console.log((await courseConfig(content)).ids.join("\n"));
  if (command === "set") return console.log(await selectWorkspace(content, id));
  if (command === "reset")
    return console.log(await replaceWorkspace(content, id));
  if (command === "progress")
    return console.log(JSON.stringify(await readProgress(content), null, 2));
  if (command === "test") {
    const result = await testLab(content, id, {
      emit: (e) => process.stdout.write(e.text),
    });
    console.log(result.passed ? "\nPASS" : "\nFAIL\n" + result.output);
    process.exitCode = result.passed ? 0 : 1;
    return;
  }
  if (command === "validate") {
    const course = await courseConfig(content);
    for (const step of course.ids) {
      const config = await labConfig(content, step);
      for (const variant of ["problem", "solution"]) {
        const files = await listFiles(content, step, variant);
        if (!files.includes(config.entry))
          throw new Error(step + ": missing entry in " + variant);
        for (const name of files)
          await readProjectFile(content, step, name, variant);
      }
    }
    const operations = await courseOperations(content);
    return console.log(
      "Valid course: " +
        course.title +
        " (" +
        course.ids.length +
        " steps, " +
        operations.actions.length +
        " actions, " +
        operations.indicators.length +
        " indicators, " +
        operations.sidecars.length +
        " sidecars)",
    );
  }
  if (command === "diff") {
    const names = new Set([
      ...(await listFiles(content, id)),
      ...(await listFiles(content, id, "solution")),
    ]);
    for (const name of names) {
      const read = async (variant) => {
        try {
          return await readProjectFile(content, id, name, variant);
        } catch (e) {
          if (e.code === "ENOENT") return null;
          throw e;
        }
      };
      const before = await read("playground"),
        after = await read("solution");
      if (before !== after)
        console.log(JSON.stringify({ name, before, after }));
    }
    return;
  }
  if (command === "start") {
    const cwd = fileURLToPath(new URL("../web/", import.meta.url));
    const env = { ...process.env, WORKSHOP_CONTENT: content };
    const require = createRequire(
      new URL("../web/package.json", import.meta.url),
    );
    const vite = resolve(
      require.resolve("vite/package.json"),
      "../bin/vite.js",
    );
    const context = {
      workspaceRoot: cwd,
      env,
      emit: ({ type, text }) => process[type].write(text),
    };
    const sessions = [];
    let closing;
    const stop = () =>
      (closing ??= Promise.allSettled(sessions.map((s) => s.stop())));
    const onSignal = () => {
      void stop();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      sessions.push(startProcess(process.execPath, ["server.mjs"], context));
      sessions.push(
        startProcess(process.execPath, [vite, "--host", "127.0.0.1"], context),
      );
      const result = await Promise.race(sessions.map((s) => s.completion));
      if (!closing) process.exitCode = result.exitCode ?? 1;
    } finally {
      await stop();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
    return;
  }
  throw new Error(
    "Usage: workshop setup|doctor|list|set <id>|reset <id>|test <id>|diff <id>|progress|validate|start --content <path>",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
