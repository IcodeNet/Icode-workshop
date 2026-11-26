import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdapterRegistry } from './index.mjs'
import { nodeAdapter } from './node-adapter.mjs'
import { createPythonAdapter } from './python-adapter.mjs'

test('Node adapter executes a real local test', async () => {
  const root = await mkdtemp(join(tmpdir(), 'icode-node-'))
  try {
    await writeFile(join(root,'example.test.mjs'), 'import {test} from "node:test"; import {strict as assert} from "node:assert"; test("works",()=>assert.equal(2+2,4))')
    const events=[]
    const registry=createAdapterRegistry(); registry.register(nodeAdapter)
    const result=await registry.require('node').run('test',{workspaceRoot:root,emit:event=>events.push(event)})
    assert.equal(result.exitCode,0)
    assert.ok(Array.isArray(events))
  } finally { await rm(root,{recursive:true,force:true}) }
})
test('Python adapter reports missing interpreter without throwing from detection', async () => {
  const root=await mkdtemp(join(tmpdir(),'icode-python-'))
  try {
    const adapter=createPythonAdapter({executable:'icode-nonexistent-python-executable'})
    const registry=createAdapterRegistry();registry.register(adapter)
    const diagnostics=await registry.require('python').detect({workspaceRoot:root})
    assert.equal(diagnostics[0].level,'error')
  } finally { await rm(root,{recursive:true,force:true}) }
})
