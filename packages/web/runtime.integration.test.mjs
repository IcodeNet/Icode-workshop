import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectWorkspace, saveWorkspace } from "./workspaces.mjs";
import { testLab } from "./runtime.mjs";

async function fixture(runtime) {
  const root = await mkdtemp(join(tmpdir(), "icode-runtime-"));
  const id = "01",
    dir = join(root, "exercises", id, "problem");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(root, "exercises", id, "lab.json"),
    JSON.stringify({ runtime }),
  );
  if (runtime === "node") {
    await writeFile(join(dir, "index.mjs"), "export const answer = () => 0\n");
    await writeFile(
      join(dir, "answer.test.mjs"),
      `import test from 'node:test'; import assert from 'node:assert/strict'; import {answer} from './index.mjs'; test('answer',()=>assert.equal(answer(),42))\n`,
    );
  } else {
    await writeFile(join(dir, "main.py"), "def answer():\n    return 0\n");
    await writeFile(
      join(dir, "test_main.py"),
      "from main import answer\n\ndef test_answer():\n    assert answer() == 42\n",
    );
  }
  return { root, id };
}
for (const runtime of ["node", "python"]) {
  test(`${runtime}: failing starter becomes passing after editing the playground`, async (t) => {
    const { root, id } = await fixture(runtime);
    try {
      await selectWorkspace(root, id);
      const before = await testLab(root, id);
      if (
        runtime === "python" &&
        /Python unavailable|No module named pytest|ENOENT/.test(before.output)
      ) {
        if (process.env.CI) assert.fail(before.output);
        t.skip(
          "Python and pytest must be installed to run this integration test",
        );
        return;
      }
      assert.equal(before.passed, false, before.output);
      await saveWorkspace(
        root,
        id,
        runtime === "node"
          ? "export const answer = () => 42\n"
          : "def answer():\n    return 42\n",
      );
      const after = await testLab(root, id);
      assert.equal(after.passed, true, after.output);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("nested Node test discovery and empty-workspace failure", async () => {
  const { root, id } = await fixture("node");
  try {
    await selectWorkspace(root, id);
    const { rename } = await import("node:fs/promises");
    const dir = join(root, ".workshop", "playgrounds", id);
    await mkdir(join(dir, "tests"));
    await rename(
      join(dir, "answer.test.mjs"),
      join(dir, "tests", "answer.test.mjs"),
    );
    await writeFile(
      join(dir, "tests", "answer.test.mjs"),
      `import test from 'node:test';import assert from 'node:assert/strict';import {answer} from '../index.mjs';test('nested',()=>assert.equal(answer(),42))`,
    );
    assert.equal((await testLab(root, id)).passed, false);
    await saveWorkspace(root, id, "export const answer=()=>42");
    assert.equal((await testLab(root, id)).passed, true);
    await rm(join(dir, "tests"), { recursive: true });
    const noTests = await testLab(root, id);
    assert.equal(noTests.passed, false);
    assert.match(noTests.output, /No test files/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicitly loaded third-party runtime executes through the web host',async()=>{
 const {registry}=await import('./runtime.mjs')
 const {loadAdapters}=await import('../adapter-api/index.mjs')
 await loadAdapters(registry,[new URL('../../examples/adapters/custom-node.mjs',import.meta.url).href])
 const {root,id}=await fixture('node')
 try{
  await writeFile(join(root,'exercises',id,'lab.json'),JSON.stringify({schemaVersion:1,runtime:'custom-node',entry:'index.mjs'}))
  await selectWorkspace(root,id)
  assert.equal((await testLab(root,id)).passed,false)
  await saveWorkspace(root,id,'export const answer=()=>42')
  assert.equal((await testLab(root,id)).passed,true)
 }finally{await rm(root,{recursive:true,force:true})}
})
