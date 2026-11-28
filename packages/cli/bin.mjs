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
import { resolveHooks } from "../web/hooks.mjs";
import { readFile } from "node:fs/promises";
import { validateBackupConfig } from "../web/workspaces.mjs";
import { outputPatterns } from "../web/exclusions.mjs";
import { listSaved, savePlayground, restoreSaved, savedConfig, savedFilesPath } from "../web/saved-playgrounds.mjs";
import { withPlaygroundHooks } from "../web/playground-ops.mjs";
import { diffSides, ignorePatterns, compileIgnore } from "../web/diff.mjs";
import { updateStatus, checkForUpdates, applyUpdate } from "../web/update.mjs";
import { contentConfig } from "../web/content-config.mjs";
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
    // Hooks, saved-playground limits and diff ignore rules fail validation loudly.
    for (const step of course.ids) await resolveHooks(content, { stepId: step });
    await savedConfig(content);
    const manifest = JSON.parse(await readFile(resolve(content, "course.json"), "utf8").catch(() => "{}"));
    validateBackupConfig(manifest.backups);
    await outputPatterns(content, course.ids);
    compileIgnore(await ignorePatterns(content, []));
    // Stage 3 content settings are optional: invalid ones are dropped, reported here.
    for (const warning of (await contentConfig(content)).warnings) console.warn("Content warning: " + warning);
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
  if (command === "saved") {
    const sub = args[2];
    if (!sub || sub === "list") return console.log(JSON.stringify(await listSaved(content, id), null, 2));
    if (sub === "save")
      return console.log(JSON.stringify(await savePlayground(content, id, { label: args[3] && !args[3].startsWith("--") ? args[3] : "", source: { step: id, variant: "playground" } }), null, 2));
    if (sub === "restore") {
      const savedId = args[3];
      const srcDir = await savedFilesPath(content, id, savedId);
      const result = await withPlaygroundHooks(content, id, { operation: "restore", source: { step: id, variant: "saved", savedId }, srcDir }, async () => {
        const restored = await restoreSaved(content, id, savedId);
        return { ...(await selectWorkspace(content, id)), backup: restored.previous };
      });
      const { code, ...summary } = result;
      return console.log(JSON.stringify(summary, null, 2));
    }
    throw new Error("Usage: workshop saved <id> [list|save [label]|restore <savedId>]");
  }
  if (command === "update") {
    if (!args.includes("--apply")) return console.log(JSON.stringify(args.includes("--offline") ? await updateStatus(content) : await checkForUpdates(content), null, 2));
    const confirmAt = args.indexOf("--confirm");
    const result = await applyUpdate(content, {
      confirm: confirmAt < 0 ? undefined : args[confirmAt + 1],
      stash: args.includes("--stash"),
      emit: (e) => process.stdout.write(e.text ?? ""),
    });
    return console.log(JSON.stringify(result, null, 2));
  }
  if (command === "diff" && args[2] && !args[2].startsWith("--")) {
    const result = await diffSides(content, args[1], args[2], { whitespace: args.includes("--ignore-whitespace") });
    for (const file of result.files) {
      console.log("--- " + result.a + "/" + (file.from ?? file.path));
      console.log("+++ " + result.b + "/" + file.path + (file.note ? "  (" + file.note + ")" : ""));
      for (const hunk of file.hunks ?? [])
        console.log("@@ -" + hunk.aStart + "," + hunk.aLines + " +" + hunk.bStart + "," + hunk.bLines + " @@\n" + hunk.lines.map((l) => l.t + l.text).join("\n"));
    }
    return;
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
    "Usage: workshop setup|doctor|list|set <id>|reset <id>|test <id>|diff <id>|diff <side> <side>|saved <id> [list|save|restore <savedId>]|update [--offline|--apply --confirm update [--stash]]|progress|validate|start --content <path>",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
