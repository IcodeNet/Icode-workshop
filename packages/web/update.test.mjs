import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUpdate, changedSteps, checkForUpdates, updateStatus } from "./update.mjs";
import { listProcesses } from "./processes.mjs";
import { writeTree } from "./test-support/workspace-course.mjs";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const IDENTITY = {
  GIT_AUTHOR_NAME: "Author",
  GIT_AUTHOR_EMAIL: "author@example.test",
  GIT_COMMITTER_NAME: "Author",
  GIT_COMMITTER_EMAIL: "author@example.test",
};
function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}
const head = (cwd) => git(cwd, "rev-parse", "HEAD");
// Git for Windows may convert line endings on checkout.
const text = async (path) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

/** remote.git (bare), author clone for pushing upstream changes, course clone. */
async function repos() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "icode-update-")));
  const remote = join(base, "remote.git"),
    author = join(base, "author"),
    course = join(base, "course");
  git(base, "init", "--bare", "-b", "main", remote);
  await mkdir(author);
  git(author, "init", "-b", "main");
  await writeTree(author, {
    "course.json": { schemaVersion: 1, title: "Update course", hooks: { postUpdate: "postupdate" } },
    "package.json": { name: "update-course", private: true, scripts: { postupdate: "node post.mjs" } },
    "post.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(".workshop-postupdate.json", JSON.stringify({ hook: process.env.ICODE_HOOK, from: process.env.ICODE_UPDATE_FROM, to: process.env.ICODE_UPDATE_TO, context: JSON.parse(process.env.ICODE_HOOK_CONTEXT) })); console.log("post update ran");\n`,
    ".gitignore": ".workshop/\n.workshop-postupdate.json\n",
    "exercises/01/problem/index.mjs": "export default 1\n",
    "exercises/01/solution/index.mjs": "export default 2\n",
    "exercises/02/problem/index.mjs": "export default 3\n",
    "exercises/02/solution/index.mjs": "export default 4\n",
  });
  git(author, "add", ".");
  git(author, "commit", "-m", "initial");
  git(author, "remote", "add", "origin", remote);
  git(author, "push", "-u", "origin", "main");
  git(base, "clone", remote, course);
  return { base, remote, author, course };
}
async function pushUpstream(author, files, message = "upstream change") {
  await writeTree(author, files);
  git(author, "add", ".");
  git(author, "commit", "-m", message);
  git(author, "push");
}

test("not a repository, nested repository and missing upstream are reported, not errors", { skip: !hasGit }, async () => {
  const plain = await realpath(await mkdtemp(join(tmpdir(), "icode-update-plain-")));
  const { base, course } = await repos();
  try {
    assert.equal((await updateStatus(plain)).git, false);
    await assert.rejects(applyUpdate(plain, { confirm: "update" }), /not a git repository/);
    await mkdir(join(course, "nested"));
    assert.match((await updateStatus(join(course, "nested"))).message, /inside another repository/);
    git(course, "checkout", "-b", "local-only");
    const status = await updateStatus(course);
    assert.equal(status.upstream, null);
    assert.match(status.message, /no upstream/);
  } finally {
    await rm(plain, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
});

test("check fetches, lists commits and changed steps; apply needs the typed word", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    assert.equal((await checkForUpdates(course)).behind, 0);
    await pushUpstream(author, { "exercises/02/problem/index.mjs": "export default 30\n" }, "Improve step 02");
    const before = head(course);
    const offlineStatus = await updateStatus(course);
    assert.equal(offlineStatus.behind, 0, "status alone never touches the network");
    const checked = await checkForUpdates(course);
    assert.equal(checked.behind, 1);
    assert.deepEqual(checked.commits.map((c) => c.subject), ["Improve step 02"]);
    assert.deepEqual(checked.changedSteps, ["02"]);
    for (const confirm of [undefined, "", "Update", "yes", true])
      await assert.rejects(applyUpdate(course, { confirm }), /typing "update"/);
    assert.equal(head(course), before, "nothing changed without confirmation");
    const events = [];
    const result = await applyUpdate(course, { confirm: "update", emit: (e) => events.push(e) });
    assert.equal(result.updated, true);
    assert.deepEqual(result.changedSteps, ["02"]);
    assert.equal(head(course), head(author));
    assert.equal(result.hooks[0].status, "passed");
    const post = JSON.parse(await readFile(join(course, ".workshop-postupdate.json"), "utf8"));
    assert.equal(post.hook, "post-update");
    assert.equal(post.from, before);
    assert.equal(post.to, head(author));
    assert.deepEqual(post.context.changedSteps, ["02"]);
    assert.ok(events.some((e) => e.type === "step" && e.step === "merge"));
    assert.ok(events.some((e) => /post update ran/.test(e.text ?? "")));
    assert.equal(listProcesses().filter((p) => p.kind === "update" || p.kind === "hook").length, 0);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a dirty tree is refused unless stashed; learner data in .workshop never counts", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    await writeTree(course, { ".workshop/playgrounds/01/index.mjs": "learner\n" });
    assert.equal((await updateStatus(course)).dirtyCount, 0);
    await pushUpstream(author, { "exercises/01/problem/index.mjs": "export default 10\n" });
    await writeFile(join(course, "exercises/02/problem/index.mjs"), "local edit\n");
    const before = head(course);
    await assert.rejects(applyUpdate(course, { confirm: "update" }), (e) => e.code === "DIRTY" && e.dirty.includes("exercises/02/problem/index.mjs"));
    assert.equal(head(course), before);
    const result = await applyUpdate(course, { confirm: "update", stash: true });
    assert.equal(result.updated, true);
    assert.deepEqual(result.stash, { restored: true });
    assert.equal(await text(join(course, "exercises/02/problem/index.mjs")), "local edit\n", "local edit kept");
    assert.equal(await text(join(course, "exercises/01/problem/index.mjs")), "export default 10\n");
    assert.equal(await text(join(course, ".workshop/playgrounds/01/index.mjs")), "learner\n");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("offline: an unreachable remote changes nothing", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    await pushUpstream(author, { "exercises/01/problem/index.mjs": "export default 11\n" });
    git(course, "remote", "set-url", "origin", join(base, "missing.git"));
    const before = head(course);
    const checked = await checkForUpdates(course);
    assert.equal(checked.offline, true);
    assert.match(checked.message, /Could not reach/);
    await assert.rejects(applyUpdate(course, { confirm: "update" }), /Could not reach/);
    assert.equal(head(course), before);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("local commits are never rebased, reset or force-pulled", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    await pushUpstream(author, { "exercises/01/problem/index.mjs": "export default 12\n" });
    await writeTree(course, { "notes.md": "mine\n" });
    git(course, "add", ".");
    git(course, "commit", "-m", "local work");
    const before = head(course);
    await assert.rejects(applyUpdate(course, { confirm: "update" }), /only fast-forwards/);
    assert.equal(head(course), before);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("changed paths map to native step ids", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "icode-steps-")));
  try {
    await writeTree(base, {
      "exercises/01/problem/a.mjs": "",
      "exercises/01/solution/a.mjs": "",
      "exercises/02/problem/a.mjs": "",
      "exercises/02/solution/a.mjs": "",
    });
    assert.deepEqual(changedSteps(base, ["exercises/02/solution/a.mjs", "exercises/01/README.md", "package.json"]), ["01", "02"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("porcelain -z parsing keeps odd names and both sides of renames", async () => {
  const { parsePorcelain } = await import("./update.mjs");
  assert.deepEqual(parsePorcelain(" M a b.txt\0R  new.txt\0old.txt\0?? dir/\"q\".md\0"), ["a b.txt", "new.txt", "old.txt", 'dir/"q".md']);
  assert.deepEqual(parsePorcelain(""), []);
});

test("hostile upstream: tracking .workshop/ is refused and learner playgrounds are untouched", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    await writeTree(course, { ".workshop/playgrounds/01/index.mjs": "learner work\n" });
    await writeFile(join(author, ".gitignore"), "");
    await pushUpstream(author, { ".workshop/playgrounds/01/index.mjs": "upstream text\n" }, "Track the workshop state");
    const before = head(course);
    const checked = await checkForUpdates(course);
    assert.deepEqual(checked.protectedPaths, [".workshop/playgrounds/01/index.mjs"]);
    for (const options of [{}, { stash: true, backupOverwritten: true }])
      await assert.rejects(applyUpdate(course, { confirm: "update", ...options }), (e) => e.code === "PROTECTED");
    assert.equal(head(course), before);
    assert.equal(await text(join(course, ".workshop/playgrounds/01/index.mjs")), "learner work\n");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("ignored or untracked local files an update would overwrite are refused, or backed up by exact path", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    await writeFile(join(course, ".git", "info", "exclude"), "my.local\n");
    await writeTree(course, { "my.local": "learner secret\n", "notes": "a file where upstream needs a directory\n" });
    await pushUpstream(author, { "my.local": "upstream\n", "notes/readme.md": "upstream notes\n" }, "Add files");
    const before = head(course);
    const checked = await checkForUpdates(course);
    assert.deepEqual(checked.overwrites, ["my.local", "notes"]);
    await assert.rejects(applyUpdate(course, { confirm: "update" }), (e) => e.code === "OVERWRITE" && e.paths.includes("my.local"));
    assert.equal(head(course), before);
    assert.equal(await text(join(course, "my.local")), "learner secret\n");
    const result = await applyUpdate(course, { confirm: "update", backupOverwritten: true });
    assert.equal(result.updated, true);
    assert.deepEqual(result.backedUp.paths, ["my.local", "notes"]);
    assert.equal(await text(join(course, result.backedUp.dir, "my.local")), "learner secret\n");
    assert.equal(await text(join(course, result.backedUp.dir, "notes")), "a file where upstream needs a directory\n");
    assert.equal(await text(join(course, "my.local")), "upstream\n");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("stash takes exactly the dirty paths: an unignored .workshop is neither dirty nor stashed", { skip: !hasGit, timeout: 60000 }, async () => {
  const { base, author, course } = await repos();
  try {
    await writeFile(join(course, ".gitignore"), "");
    git(course, "update-index", "--assume-unchanged", ".gitignore");
    await writeTree(course, { ".workshop/playgrounds/01/index.mjs": "learner\n" });
    assert.equal((await updateStatus(course)).dirtyCount, 0, ".workshop is never dirty");
    // Upstream and learner change the same line, so the stash cannot pop cleanly.
    await pushUpstream(author, { "exercises/01/problem/index.mjs": "export default 100\n" });
    await writeFile(join(course, "exercises/01/problem/index.mjs"), "learner change\n");
    const result = await applyUpdate(course, { confirm: "update", stash: true });
    assert.equal(result.stash.restored, false);
    const stashed = git(course, "stash", "show", "--include-untracked", "--name-only", "stash@{0}").split("\n").filter(Boolean);
    assert.deepEqual(stashed, ["exercises/01/problem/index.mjs"]);
    assert.equal(await text(join(course, ".workshop/playgrounds/01/index.mjs")), "learner\n", "not stashed away");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
