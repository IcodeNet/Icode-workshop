#!/usr/bin/env node
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { courseConfig, readProgress } from "../web/course.mjs";
import { selectWorkspace, replaceWorkspace } from "../web/workspaces.mjs";
import { testLab, labConfig } from "../web/runtime.mjs";
import { listFiles, readProjectFile } from "../web/files.mjs";
const args = process.argv.slice(2),
  command = args[0],
  contentFlag = args.indexOf("--content");
const content = resolve(contentFlag < 0 ? "." : (args[contentFlag + 1] ?? "."));
const id = args[1];
async function main() {
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
    return console.log(
      "Valid course: " + course.title + " (" + course.ids.length + " steps)",
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
    const api = spawn(process.execPath, ["server.mjs"], {
      cwd,
      env,
      stdio: "inherit",
    });
    const web = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["dev"],
      { cwd, env, stdio: "inherit" },
    );
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      api.kill();
      web.kill();
    };
    for (const child of [api, web]) {
      child.on("error", (e) => {
        console.error(e.message);
        process.exitCode = 1;
        stop();
      });
      child.on("exit", (code) => {
        if (!closing && code) process.exitCode = code;
        stop();
      });
    }
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }
  throw new Error(
    "Usage: workshop list|set <id>|reset <id>|test <id>|diff <id>|progress|validate|start --content <path>",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
