import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ansiToHtml, stripAnsi } from "./src/ansi.js";
import { watchPlayground, isWatchedPath } from "./watch.mjs";
import { selectWorkspace } from "./workspaces.mjs";

test("ANSI output is escaped before colour markup is added", () => {
  assert.equal(ansiToHtml("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
  assert.equal(
    ansiToHtml("\x1b[31mfail\x1b[0m ok"),
    '<span class="ansi-fg-red">fail</span> ok',
  );
  assert.equal(
    ansiToHtml("\x1b[1;92m<pass>\x1b[22;39m"),
    '<span class="ansi-bold ansi-fg-bright-green">&lt;pass&gt;</span>',
  );
  assert.equal(
    ansiToHtml("\x1b[38;5;196mx"),
    '<span style="color:rgb(255,0,0)">x</span>',
  );
  assert.equal(
    ansiToHtml("\x1b[48;2;1;2;3my"),
    '<span style="background-color:rgb(1,2,3)">y</span>',
  );
  assert.equal(ansiToHtml("\x1b[2K\x1b[1Gline\x1b]0;title\x07"), "line");
  assert.equal(
    ansiToHtml('\x1b[31m"onload=x'),
    '<span class="ansi-fg-red">&quot;onload=x</span>',
  );
  assert.equal(stripAnsi("\x1b[32m✔\x1b[39m pass"), "✔ pass");
});

test(
  "playground changes are reported to watchers",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "icode-watch-"));
    try {
      await mkdir(join(root, "exercises", "01", "problem"), {
        recursive: true,
      });
      await writeFile(
        join(root, "exercises", "01", "problem", "index.mjs"),
        "1\n",
      );
      await selectWorkspace(root, "01");
      const events = [];
      const stop = await watchPlayground(
        root,
        "01",
        (event) => events.push(event),
        { debounceMs: 20 },
      );
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(
        join(root, ".workshop", "playgrounds", "01", "index.mjs"),
        "2\n",
      );
      await mkdir(join(root, ".workshop", "playgrounds", "01", "src"), {
        recursive: true,
      });
      await writeFile(
        join(root, ".workshop", "playgrounds", "01", "src", "a.mjs"),
        "3\n",
      );
      for (
        let i = 0;
        i < 100 && !events.some((e) => e.name === "src/a.mjs");
        i++
      )
        await new Promise((r) => setTimeout(r, 50));
      stop();
      assert.ok(
        events.some((e) => e.name === "index.mjs"),
        JSON.stringify(events),
      );
      assert.ok(
        events.some((e) => e.name === "src/a.mjs"),
        JSON.stringify(events),
      );
      assert.ok(events.every((e) => e.id === "01"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    assert.equal(isWatchedPath("node_modules/x/index.js"), false);
    assert.equal(isWatchedPath(".git/HEAD"), false);
    assert.equal(isWatchedPath("src/.env"), false);
    assert.equal(isWatchedPath("data.sqlite-wal"), false);
    assert.equal(isWatchedPath("src/app.mjs"), true);
  },
);
