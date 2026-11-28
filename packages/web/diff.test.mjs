import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileIgnore,
  diffFile,
  diffSides,
  diffText,
  expandShortcut,
  LIST_LINE_BUDGET,
  parseSide,
  syncFile,
  touchedFiles,
} from "./diff.mjs";
import { selectWorkspace, workspacePath } from "./workspaces.mjs";
import { savePlayground } from "./saved-playgrounds.mjs";
import { nativeCourse, writeTree } from "./test-support/workspace-course.mjs";

test("diff sides and links are parsed strictly (no traversal)", () => {
  assert.deepEqual(parseSide("01.problem"), { step: "01", variant: "problem" });
  assert.deepEqual(parseSide("02.saved.20261127T101112345Z-abcdef"), { step: "02", variant: "saved", savedId: "20261127T101112345Z-abcdef" });
  for (const bad of ["../01.problem", "01.problem/../..", "01.saved.../..", "01.saved.x", "01.secret", "1.problem", "01.problem.x", "01", "", "01..problem", "01.saved.20261127T101112345Z-abcdef/..", null, "01.Problem"])
    assert.throws(() => parseSide(bad), /Invalid diff side|two digits/, String(bad));
  assert.deepEqual(expandShortcut("03"), ["03.problem", "03.solution"]);
  assert.deepEqual(expandShortcut("03..04"), ["03.solution", "04.problem"]);
  assert.deepEqual(expandShortcut("03.playground"), ["03.playground", "03.solution"]);
  assert.deepEqual(expandShortcut("01.problem..02.playground"), ["01.problem", "02.playground"]);
  for (const bad of ["../x", "01..02..03", "01.problem..../etc", "x".repeat(300)]) assert.throws(() => expandShortcut(bad));
});

test("line diff: hunks, context, whitespace and approximate fallback", () => {
  const r = diffText("a\nb\nc\nd\ne\nf\ng\nh\n", "a\nB\nc\nd\ne\nf\ng\nh\ni\n", { context: 1 });
  assert.equal(r.additions, 2);
  assert.equal(r.deletions, 1);
  assert.equal(r.hunks.length, 2);
  assert.deepEqual(r.hunks[0].lines.map((l) => l.t + l.text), [" a", "-b", "+B", " c"]);
  assert.equal(diffText("x\r\ny\r\n", "x\ny").hunks.length, 0, "line endings and the final newline are normalised");
  assert.equal(diffText("  if (a) {\n", "if (a)   {\n", { whitespace: true }).additions, 0);
  assert.equal(diffText("  if (a) {\n", "if (a)   {\n").additions, 1);
  const full = diffText("1\n2\n3\n4\n5\n6\n7\n8\n9\n", "1\n2\n3\n4\nX\n6\n7\n8\n9\n", { context: -1 });
  assert.equal(full.hunks.length, 1);
  assert.equal(full.hunks[0].lines.length, 10);
  // Randomised round trip: the hunks always reconstruct both inputs.
  for (let t = 0; t < 200; t++) {
    const A = Array.from({ length: (Math.random() * 40) | 0 }, () => "x" + ((Math.random() * 6) | 0));
    const B = Array.from({ length: (Math.random() * 40) | 0 }, () => "x" + ((Math.random() * 6) | 0));
    const lines = diffText(A.join("\n"), B.join("\n"), { context: -1 }).hunks.flatMap((h) => h.lines);
    if (!lines.length) continue;
    assert.deepEqual(lines.filter((l) => l.t !== "+").map((l) => l.text), A);
    assert.deepEqual(lines.filter((l) => l.t !== "-").map((l) => l.text), B);
  }
  const long = diffText("a".repeat(5000), "b".repeat(5000));
  assert.ok(long.hunks[0].lines.every((l) => l.text.length <= 2001), "very long lines are cut");
});

test("gitignore-style ignore rules", () => {
  const ignored = compileIgnore([".*", "node_modules/", "README.*", "data/**", "!data/keep.txt", "/top.txt", "*.log", "# comment", ""]);
  assert.equal(ignored(".env"), true);
  assert.equal(ignored("src/.hidden"), true);
  assert.equal(ignored("node_modules", true), true);
  assert.equal(ignored("node_modules", false), false, "dir-only pattern");
  assert.equal(ignored("README.mdx"), true);
  assert.equal(ignored("data/a/b.json"), true);
  assert.equal(ignored("data/keep.txt"), false);
  assert.equal(ignored("top.txt"), true);
  assert.equal(ignored("src/top.txt"), false, "anchored");
  assert.equal(ignored("src/x.log"), true);
  assert.equal(ignored("src/index.mjs"), false);
});

test("problem vs solution: modified, added, ignored, renamed and package.json name-only", async () => {
  const root = await nativeCourse({
    course: { diff: { ignore: ["fixtures/**", "!fixtures/shown.json"] } },
    files: {
      ".gitignore": "*.generated.js\n",
      "exercises/01/problem/package.json": JSON.stringify({ name: "problem", version: "1.0.0" }),
      "exercises/01/solution/package.json": JSON.stringify({ name: "solution", version: "1.0.0" }),
      "exercises/02/problem/package.json": JSON.stringify({ name: "p", dependencies: { a: "1" } }),
      "exercises/02/solution/package.json": JSON.stringify({ name: "s", dependencies: { a: "2" } }),
      "exercises/01/problem/old-name.mjs": "export const moved = true;\n",
      "exercises/01/solution/new-name.mjs": "export const moved = true;\n",
      "exercises/01/solution/fixtures/big.json": "{}\n",
      "exercises/01/solution/fixtures/shown.json": "{}\n",
      "exercises/01/solution/out.generated.js": "x\n",
      "exercises/01/solution/epicshop/.diffignore": "secret.txt\n",
      "exercises/01/solution/secret.txt": "hidden\n",
    },
  });
  try {
    const result = await diffSides(root, "01.problem", "01.solution");
    const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
    assert.deepEqual(Object.keys(byPath).sort(), ["extra.mjs", "fixtures/shown.json", "index.mjs", "new-name.mjs"]);
    assert.equal(byPath["index.mjs"].status, "modified");
    assert.deepEqual(byPath["index.mjs"].hunks[0].lines.map((l) => l.t + l.text), ["-export const value = 1;", "+export const value = 2;", " // TODO"]);
    assert.equal(byPath["extra.mjs"].status, "added");
    assert.equal(byPath["new-name.mjs"].status, "renamed");
    assert.equal(byPath["new-name.mjs"].from, "old-name.mjs");
    assert.deepEqual(result.stats, { files: 4, additions: 3, deletions: 1, hiddenWhitespaceOnly: 0 });
    const other = await diffSides(root, "02.problem", "02.solution");
    assert.ok(other.files.some((f) => f.path === "package.json"), "real package.json changes are shown");
    // Any two steps can be compared.
    const cross = await diffSides(root, "01.solution", "02.problem", { context: -1 });
    assert.ok(cross.files.some((f) => f.path === "index.mjs"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("whitespace-only changes are hidden on request", async () => {
  const root = await nativeCourse({
    files: {
      "exercises/02/problem/fmt.mjs": "if (a) {\n  b();\n}\n",
      "exercises/02/solution/fmt.mjs": "if (a) {\n    b();\n}\n",
    },
  });
  try {
    assert.ok((await diffSides(root, "02.problem", "02.solution")).files.some((f) => f.path === "fmt.mjs"));
    const ws = await diffSides(root, "02.problem", "02.solution", { whitespace: true });
    assert.equal(ws.files.some((f) => f.path === "fmt.mjs"), false);
    assert.equal(ws.stats.hiddenWhitespaceOnly, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("huge diffs stay within budget: binary, 5 MB, 60,000-line and 1,500-file cases", { timeout: 120000 }, async () => {
  const many = {};
  for (let i = 0; i < 1500; i++) {
    const n = String(i).padStart(4, "0");
    many["exercises/02/problem/many/f" + n + ".txt"] = Array.from({ length: 20 }, (_, j) => "p" + j).join("\n");
    many["exercises/02/solution/many/f" + n + ".txt"] = Array.from({ length: 20 }, (_, j) => "s" + j).join("\n");
  }
  const root = await nativeCourse({
    files: {
      "exercises/01/problem/blob.bin": Buffer.from([1, 0, 2, 3]),
      "exercises/01/solution/blob.bin": Buffer.from([1, 0, 2, 4]),
      "exercises/01/problem/huge.txt": "a".repeat(5 * 1024 * 1024),
      "exercises/01/solution/huge.txt": "b".repeat(5 * 1024 * 1024),
      "exercises/01/problem/long.txt": Array.from({ length: 60000 }, (_, i) => "left " + i).join("\n"),
      "exercises/01/solution/long.txt": Array.from({ length: 60000 }, (_, i) => "right " + i).join("\n"),
      ...many,
    },
  });
  try {
    let started = Date.now();
    const one = await diffSides(root, "01.problem", "01.solution");
    const byPath = Object.fromEntries(one.files.map((f) => [f.path, f]));
    assert.equal(byPath["blob.bin"].binary, true);
    assert.equal(byPath["blob.bin"].hunks, null);
    assert.equal(byPath["huge.txt"].large, true);
    assert.equal(byPath["huge.txt"].hunks, null);
    assert.equal(byPath["long.txt"].approximate, true);
    assert.equal(byPath["long.txt"].additions, 60000);
    assert.ok(JSON.stringify(one).length < 3_000_000, "bounded response");
    assert.ok(Date.now() - started < 30000);
    started = Date.now();
    const lots = await diffSides(root, "02.problem", "02.solution");
    assert.equal(lots.files.length, 1501);
    const emitted = lots.files.reduce((n, f) => n + (f.hunks ?? []).reduce((m, h) => m + h.lines.length, 0), 0);
    assert.ok(emitted <= LIST_LINE_BUDGET, "list response within line budget");
    const deferred = lots.files.filter((f) => f.deferred);
    assert.ok(deferred.length > 0);
    assert.ok(deferred.every((f) => f.additions === 20 && f.deletions === 20), "deferred files keep their stats");
    const single = await diffFile(root, "02.problem", "02.solution", deferred.at(-1).path);
    assert.equal(single.file.hunks[0].lines.length, 40);
    assert.ok(Date.now() - started < 60000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single-file diff refuses paths outside the diff", async () => {
  const root = await nativeCourse();
  try {
    for (const bad of ["../course.json", "../../package.json", "/etc/passwd", "a/../../x", "..\\..\\x", "", ".env", "C:/x"])
      await assert.rejects(diffFile(root, "01.problem", "01.solution", bad), /Invalid file path|not part of this diff/, bad);
    await assert.rejects(diffFile(root, "01.problem", "../01.solution", "index.mjs"), /Invalid diff side|two digits/);
    await assert.rejects(diffSides(root, "01.playground", "01.solution"), /has not been created/);
    const ok = await diffFile(root, "01.problem", "01.solution", "index.mjs");
    assert.equal(ok.file.additions, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlinks on a side are listed, never followed", { skip: process.platform === "win32" }, async () => {
  const root = await nativeCourse();
  try {
    await selectWorkspace(root, "01");
    await symlink("/etc/hostname", join(workspacePath(root, "01"), "link.txt"));
    const result = await diffSides(root, "01.playground", "01.problem");
    const link = result.files.find((f) => f.path === "link.txt");
    assert.equal(link.symlink, true);
    assert.equal(link.hunks, null);
    await assert.rejects(syncFile(root, "02", "link.txt", "01.playground"), /not been created|Symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("touched files track the step's problem files against the playground", async () => {
  const root = await nativeCourse({
    files: {
      "exercises/01/problem/gone.mjs": "export const gone = 1;\n",
      "exercises/01/problem/edit-me.mjs": "a\nb\nc\nd\ne\n",
      "exercises/01/solution/edit-me.mjs": "a\nb\nc\nD\ne\n",
    },
  });
  try {
    const before = await touchedFiles(root, "01");
    assert.equal(before.playgroundExists, false);
    assert.ok(before.files.every((f) => f.playground === "no-playground"));
    await selectWorkspace(root, "01");
    const pg = workspacePath(root, "01");
    await writeFile(join(pg, "index.mjs"), "export const value = 2;\n// TODO\n"); // matches solution
    await writeFile(join(pg, "edit-me.mjs"), "a\nb\nc\nd!\ne\n"); // edited
    await writeFile(join(pg, "mine.mjs"), "learner file\n"); // extra
    await rm(join(pg, "util.mjs")); // extra deletion
    const result = await touchedFiles(root, "01");
    const by = Object.fromEntries(result.files.map((f) => [f.path, f]));
    assert.equal(by["index.mjs"].playground, "done");
    assert.equal(by["edit-me.mjs"].playground, "edited");
    assert.equal(by["edit-me.mjs"].line, 4, "first changed line");
    assert.equal(by["extra.mjs"].playground, "missing");
    assert.equal(by["gone.mjs"].status, "deleted");
    assert.equal(by["gone.mjs"].playground, "unchanged");
    assert.deepEqual(result.extra, [
      { path: "mine.mjs", status: "added" },
      { path: "util.mjs", status: "deleted" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync copies one file into a playground; removal is explicit; paths are confined", async () => {
  const root = await nativeCourse({
    files: { "exercises/01/solution/assets/logo.bin": Buffer.from([0, 255, 0, 7]) },
  });
  try {
    await selectWorkspace(root, "01");
    const pg = workspacePath(root, "01");
    await writeFile(join(pg, "index.mjs"), "broken\n");
    await syncFile(root, "01", "index.mjs", "01.problem");
    assert.equal(await readFile(join(pg, "index.mjs"), "utf8"), "export const value = 1;\n// TODO\n");
    await syncFile(root, "01", "assets/logo.bin", "01.solution");
    assert.deepEqual([...(await readFile(join(pg, "assets/logo.bin")))], [0, 255, 0, 7]);
    await writeTree(pg, { "mine.mjs": "x\n" });
    await assert.rejects(syncFile(root, "01", "mine.mjs", "01.solution"), /does not exist/);
    assert.deepEqual(await syncFile(root, "01", "mine.mjs", "01.solution", { remove: true }), { synced: true, removed: true, name: "mine.mjs" });
    for (const bad of ["../../course.json", "../01/solution/index.mjs", "/etc/passwd", ".env", "a\\b"])
      await assert.rejects(syncFile(root, "01", bad, "01.solution"), /Invalid file path/);
    await assert.rejects(syncFile(root, "01", "index.mjs", "01.playground"), /onto itself/);
    await assert.rejects(syncFile(root, "01", "index.mjs", "../02.solution"), /Invalid diff side|two digits/);
    // Saved playgrounds are diff sides too.
    const saved = await savePlayground(root, "01");
    await writeFile(join(pg, "index.mjs"), "after save\n");
    const result = await diffSides(root, "01.saved." + saved.savedId, "01.playground");
    assert.deepEqual(result.files.map((f) => f.path), ["index.mjs"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
