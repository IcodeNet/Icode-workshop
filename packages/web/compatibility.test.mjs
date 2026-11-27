import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSteps } from "../core/layout.mjs";
import { courseConfig } from "./course.mjs";
import { lessonDocuments, lessonMarkdown } from "./lessons.mjs";
import { selectWorkspace, replaceWorkspace } from "./workspaces.mjs";
import { testLab } from "./runtime.mjs";

test("unsupported nested courses never validate as zero steps; explicit compatibility preserves paths and lessons", async () => {
  const root = await mkdtemp(join(tmpdir(), "icode-compat-"));
  try {
    const base = join(root, "exercises", "01.ping");
    for (const variant of ["problem", "solution"]) {
      const dir = join(base, `01.${variant}.connect`);
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src/index.ts"), "export const value=1;");
      await writeFile(
        join(dir, "README.mdx"),
        `# ${variant}\n<EpicVideo url="https://example.org/video" />`,
      );
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
      );
      await writeFile(
        join(dir, "example.test.mjs"),
        'import test from "node:test";test("works",()=>{});',
      );
    }
    assert.throws(() => discoverSteps(root), /No supported course/);
    await writeFile(
      join(root, "workshop.json"),
      JSON.stringify({
        schemaVersion: 1,
        format: "epic",
        title: "Course",
        testScript: "test",
        testArgs: [],
      }),
    );
    assert.equal((await courseConfig(root)).ids.length, 1);
    assert.match(discoverSteps(root)[0].problem, /01\.ping/);
    assert.equal((await lessonDocuments(root, "01")).length, 2);
    assert.match(
      lessonMarkdown('<InlineFile file="src/index.ts" />'),
      /#file=/,
    );
    await selectWorkspace(root, "01");
    assert.equal((await testLab(root, "01")).passed, true);
    const replaced = await replaceWorkspace(root, "01");
    assert.ok(replaced.backup);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
