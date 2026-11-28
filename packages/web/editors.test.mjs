import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  chmod,
  readFile,
  rm,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  editorArgs,
  editorKind,
  parseEditorSetting,
  detectEditors,
  editorName,
  chooseEditor,
  launchEditor,
  findExecutable,
  publicEditors,
} from "./editors.mjs";

test("editor kinds and line/column arguments", () => {
  assert.equal(editorKind("/usr/bin/code"), "code");
  assert.equal(editorKind("C:\\Tools\\Cursor.exe"), "cursor");
  assert.equal(editorKind("webstorm.sh"), "webstorm");
  assert.equal(editorKind("idea64.exe"), "idea");
  assert.equal(editorKind("nvim"), "nvim");
  assert.equal(editorKind("my-editor"), "generic");
  assert.deepEqual(editorArgs("code", "/a b/x.mjs", 3, 7), [
    "--goto",
    "/a b/x.mjs:3:7",
  ]);
  assert.deepEqual(editorArgs("webstorm", "/x", 2, 4), [
    "--line",
    "2",
    "--column",
    "4",
    "/x",
  ]);
  assert.deepEqual(editorArgs("subl", "/x", 2, 4), ["/x:2:4"]);
  assert.deepEqual(editorArgs("vim", "/x", 5, 1), ["+call cursor(5, 1)", "/x"]);
  assert.deepEqual(editorArgs("generic", "/x; rm -rf /", 1, 1), [
    "/x; rm -rf /",
  ]);
  assert.deepEqual(editorArgs("code", "/x", "bad", -3), ["--goto", "/x:1:1"]);
});

test("ICODE_EDITOR accepts an executable or a JSON argument array", () => {
  assert.deepEqual(parseEditorSetting("code"), ["code"]);
  assert.deepEqual(parseEditorSetting('["/opt/ed","--new-window"]'), [
    "/opt/ed",
    "--new-window",
  ]);
  assert.equal(parseEditorSetting(""), null);
  assert.throws(() => parseEditorSetting("[1]"), /JSON array/);
});

async function fakeBin() {
  const dir = await mkdtemp(join(tmpdir(), "icode-editors-"));
  const log = join(dir, "args.json");
  // A Node script stands in for an editor: it records its arguments.
  const script = join(dir, "record.mjs");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`,
  );
  return { dir, log, script };
}

test(
  "detection honours ICODE_EDITOR, VISUAL/EDITOR and PATH",
  { skip: process.platform === "win32" },
  async () => {
    const { dir } = await fakeBin();
    try {
      await mkdir(join(dir, "bin"));
      for (const name of ["code", "vim"]) {
        await writeFile(join(dir, "bin", name), "#!/bin/sh\n");
        await chmod(join(dir, "bin", name), 0o755);
      }
      const env = {
        PATH: join(dir, "bin"),
        EDITOR: "vim",
        VISUAL: "code --wait",
      };
      assert.equal(findExecutable("code", { env }), join(dir, "bin", "code"));
      const editors = detectEditors({ env, tty: false });
      const visual = editors.find((e) => e.id === "visual");
      assert.equal(visual.kind, "code");
      assert.equal(visual.available, true);
      assert.deepEqual(visual.extraArgs, ["--wait"]);
      const vim = editors.find((e) => e.id === "editor");
      assert.equal(vim.available, false);
      assert.match(vim.reason, /terminal/);
      assert.equal(
        detectEditors({ env, tty: true }).find((e) => e.id === "editor")
          .available,
        true,
      );
      assert.equal(
        editors.some((e) => e.id === "code"),
        false,
        "PATH duplicate of $VISUAL omitted",
      );
      assert.equal(visual.label, "Your visual editor (VS Code)");
      assert.equal(vim.label, "Your editor (vim)");
      assert.equal(visual.source, "VISUAL");
      assert.equal(editors.find((e) => e.id === "cursor").available, false);
      assert.equal(chooseEditor(editors).id, "visual");
      assert.throws(() => chooseEditor(editors, "cursor"), /unavailable/);
      assert.throws(() => chooseEditor(editors, "nope"), /Unknown editor/);
      assert.equal(
        publicEditors(editors)[0].command,
        undefined,
        "paths are not exposed",
      );
      const override = detectEditors({
        env: { ...env, ICODE_EDITOR: "subl" },
        tty: false,
      });
      assert.equal(override[0].id, "override");
      assert.equal(override[0].label, "Configured editor (Sublime Text)");
      assert.equal(override[0].available, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("launch spawns the editor with an argument array, never a shell", async () => {
  const { dir, log, script } = await fakeBin();
  try {
    const target = join(dir, "file with $(spaces) & quotes'.mjs");
    await writeFile(target, "x\n");
    const env = {
      ...process.env,
      ICODE_EDITOR: JSON.stringify([process.execPath, script]),
    };
    const result = await launchEditor(target, { line: 4, column: 2, env });
    assert.equal(result.launched, true);
    let args;
    for (let i = 0; i < 100 && !args; i++) {
      args = await readFile(log, "utf8").catch(() => undefined);
      if (!args) await new Promise((r) => setTimeout(r, 50));
    }
    assert.deepEqual(JSON.parse(args), [target]);
    await assert.rejects(launchEditor("relative.mjs", { env }), /absolute/);
    await assert.rejects(
      launchEditor(join(dir, "missing.mjs"), { env }),
      /not found/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows detection ignores extensionless shell scripts and maps code.cmd to Code.exe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "icode-win-editors-"));
  try {
    // VS Code layout: <root>\bin\code (bash script), <root>\bin\code.cmd, <root>\Code.exe
    await mkdir(join(dir, "bin"));
    await writeFile(join(dir, "bin", "code"), "#!/usr/bin/env sh\n");
    await writeFile(join(dir, "bin", "code.cmd"), "@echo off\n");
    await writeFile(join(dir, "Code.exe"), "MZ");
    // A JetBrains launcher available only as a batch file.
    await writeFile(join(dir, "bin", "idea.cmd"), "@echo off\n");
    const env = { PATH: join(dir, "bin"), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    assert.equal(
      findExecutable("code", { env, platform: "win32" }),
      join(dir, "bin", "code.cmd"),
    );
    const editors = detectEditors({ env, platform: "win32", tty: false });
    const code = editors.find((e) => e.id === "code");
    assert.equal(code.available, true);
    assert.equal(code.command, join(dir, "bin", "..", "Code.exe"));
    const idea = editors.find((e) => e.id === "idea");
    assert.equal(idea.available, false);
    assert.match(idea.reason, /batch file/);
    // An explicit .exe override is used as is.
    assert.equal(
      findExecutable(join(dir, "Code.exe"), { env, platform: "win32" }),
      join(dir, "Code.exe"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("line and column are clamped", () => {
  assert.deepEqual(editorArgs("code", "/x", Infinity, 1e308), [
    "--goto",
    "/x:10000000:10000000",
  ]);
});

test("Windows: Cursor and Insiders launchers map to their executables; script shims are unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "icode-win-editors2-"));
  try {
    // Cursor: <root>\resources\app\bin\cursor.cmd → <root>\Cursor.exe
    const cursorBin = join(dir, "Cursor", "resources", "app", "bin");
    await mkdir(cursorBin, { recursive: true });
    await writeFile(join(cursorBin, "cursor.cmd"), "@echo off\n");
    await writeFile(join(dir, "Cursor", "Cursor.exe"), "MZ");
    // VS Code Insiders: <root>\bin\code-insiders.cmd → <root>\Code - Insiders.exe
    const insidersBin = join(dir, "Insiders", "bin");
    await mkdir(insidersBin, { recursive: true });
    await writeFile(join(insidersBin, "code-insiders.cmd"), "@echo off\n");
    await writeFile(join(dir, "Insiders", "Code - Insiders.exe"), "MZ");
    // Sublime via a .js shim found through PATHEXT.
    const shims = join(dir, "shims");
    await mkdir(shims);
    await writeFile(join(shims, "subl.js"), "WScript.Echo(1)\n");
    const env = {
      PATH: [cursorBin, insidersBin, shims].join(";"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD;.JS",
    };
    const editors = detectEditors({ env, platform: "win32", tty: false });
    const cursor = editors.find((e) => e.id === "cursor");
    assert.equal(cursor.available, true);
    assert.equal(
      cursor.command,
      join(cursorBin, "..", "..", "..", "Cursor.exe"),
    );
    const code = editors.find((e) => e.id === "code");
    assert.equal(code.available, true);
    assert.equal(code.command, join(insidersBin, "..", "Code - Insiders.exe"));
    const subl = editors.find((e) => e.id === "subl");
    assert.equal(subl.available, false);
    assert.match(subl.reason, /script/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EDITOR=vi is never a fallback, even in a terminal", () => {
  const editors = [
    { id: "editor", label: "Your editor (vi)", kind: "vi", terminal: true, available: true },
    { id: "code", label: "VS Code", kind: "code", terminal: false, available: false, reason: "not found on PATH" },
  ];
  assert.throws(() => chooseEditor(editors), /Terminal editors are only used when chosen explicitly/);
  assert.equal(chooseEditor(editors, "editor").id, "editor", "an explicit choice is honoured");
  editors[1].available = true;
  assert.equal(chooseEditor(editors).id, "code", "GUI editor preferred over $EDITOR");
});

test("editor labels are for people: no variable names, placeholders or paths", () => {
  assert.equal(editorName("code"), "VS Code");
  assert.equal(editorName("/usr/local/bin/code"), "VS Code");
  assert.equal(editorName("C:\\Tools\\Code.cmd"), "VS Code");
  assert.equal(editorName("/opt/tools/my-editor.sh"), "my-editor");
  const environments = [
    { PATH: "", EDITOR: "code", VISUAL: "/opt/x/zed --wait", ICODE_EDITOR: "/opt/tools/my-editor" },
    { PATH: "", EDITOR: "vi" },
    { PATH: "", ICODE_EDITOR: "[not json" },
    { PATH: "" },
  ];
  for (const env of environments)
    for (const editor of detectEditors({ env, platform: "linux", tty: false })) {
      assert.doesNotMatch(editor.label, /\$[A-Z_]+|\{\{|undefined|ICODE_|[\\/]/, editor.label);
      assert.ok(editor.label.trim().length > 2);
    }
  const labels = detectEditors({ env: environments[0], platform: "linux", tty: false }).map((e) => e.label);
  assert.deepEqual(labels.slice(0, 3), ["Configured editor (my-editor)", "Your visual editor (zed)", "Your editor (VS Code)"]);
});
