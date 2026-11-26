import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectWorkspace, saveWorkspace, workspacePath } from './workspaces.mjs'

test('exercise playgrounds persist independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'icode-workshop-'))
  try {
    for (const id of ['01','02']) {
      const starter = join(root,'exercises',id,'problem')
      await mkdir(starter,{recursive:true})
      await writeFile(join(starter,'index.mjs'), 'export default '+id+'\n')
    }
    await selectWorkspace(root,'01')
    await saveWorkspace(root,'01','export default 100\n')
    await selectWorkspace(root,'02')
    await saveWorkspace(root,'02','export default 200\n')
    const restored = await selectWorkspace(root,'01')
    assert.equal(restored.code,'export default 100\n')
    assert.equal(await readFile(join(workspacePath(root,'02'),'index.mjs'),'utf8'),'export default 200\n')
    assert.equal(await readFile(join(root,'exercises','01','problem','index.mjs'),'utf8'),'export default 01\n')
  } finally { await rm(root,{recursive:true,force:true}) }
})
