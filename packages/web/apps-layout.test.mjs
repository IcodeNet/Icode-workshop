import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSteps } from "../core/layout.mjs";
import { APPS_FORMAT, APPS_VIDEO_TAG } from "../core/apps-layout.mjs";
import { courseConfig } from "./course.mjs";
import { lessonDocuments, lessonMarkdown } from "./lessons.mjs";
import { selectWorkspace, replaceWorkspace } from "./workspaces.mjs";
import { testLab } from "./runtime.mjs";

test("unsupported nested courses never validate as zero steps; the explicit apps layout preserves paths and lessons", async () => {
  const root = await mkdtemp(join(tmpdir(), "icode-apps-"));
  try {
    const base = join(root, "exercises", "01.ping");
    for (const variant of ["problem", "solution"]) {
      const dir = join(base, `01.${variant}.connect`);
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src/index.ts"), "export const value=1;");
      await writeFile(
        join(dir, "README.mdx"),
        `# ${variant}\n<${APPS_VIDEO_TAG} url="https://example.org/video" />`,
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
        format: APPS_FORMAT,
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

test("apps-layout MDX lessons render with components; an exercise intro with DiffLink works", async () => {
  const { appsCourse } = await import("./test-support/workspace-course.mjs");
  const root = await appsCourse({
    files: {
      "exercises/README.mdx": "# Workshop intro\n\n<DiffLink>no step here</DiffLink>\n",
      "exercises/01.basics/README.mdx": "import { Thing } from './thing'\n\n# Basics\n\n<callout-danger>\n\tDo **not** skip.\n</callout-danger>\n\n<DiffLink>See what changes</DiffLink> <NextDiffLink />\n\n```tsx filename=index.tsx lines=1\nexport const App = () => <div>{1}</div>\n```\n",
      "exercises/01.basics/01.problem.start/README.mdx": "# Problem\n\n<InlineFile file=\"src/index.ts\" />\n",
      "exercises/01.basics/FINISHED.mdx": "# Finished\n\n<PrevDiffLink>Back</PrevDiffLink>\n",
    },
  });
  const docs = await lessonDocuments(root, "01", { sandboxOrigin: "http://127.0.0.1:4318" });
  const by = Object.fromEntries(docs.map((d) => [d.title, d]));
  assert.deepEqual(Object.keys(by), ["Course introduction", "Exercise introduction", "Problem lesson", "Exercise wrap-up"]);
  assert.match(by["Exercise introduction"].html, /callout callout-danger[\s\S]*Do <strong>not<\/strong> skip/);
  assert.match(by["Exercise introduction"].html, /href="#diff=step"[^>]*>See what changes/);
  assert.match(by["Exercise introduction"].html, /href="#diff=next"/);
  assert.match(by["Exercise introduction"].html, /<div class="code-title">index\.tsx<\/div><pre class="shiki/);
  assert.doesNotMatch(by["Exercise introduction"].html, /import \{ Thing \}/);
  assert.match(by["Problem lesson"].html, /href="#file=src%2Findex\.ts"/);
  assert.match(by["Exercise wrap-up"].html, /href="#diff=prev"/);
  assert.match(by["Course introduction"].html, /href="#diff=step"/, "inside a step, the course intro's diff link refers to that step");
  // Markdown content (tutor, MCP) is unchanged.
  assert.match(by["Problem lesson"].content, /\[src\/index\.ts\]\(#file=src%2Findex\.ts\)/);
});
