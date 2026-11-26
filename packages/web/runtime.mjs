import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createAdapterRegistry } from '../adapter-api/index.mjs'
import { nodeAdapter } from '../adapter-api/node-adapter.mjs'
import { createPythonAdapter } from '../adapter-api/python-adapter.mjs'
import { validateId } from '../core/index.mjs'

export const registry = createAdapterRegistry()
registry.register(nodeAdapter)
registry.register(createPythonAdapter())

export async function labConfig(root, id) {
  validateId(id)
  let config
  try { config = JSON.parse(await readFile(join(root,'exercises',id,'lab.json'),'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; config = {runtime:'node',entry:'index.mjs'} }
  if (!['node','python'].includes(config.runtime)) throw new Error('Unsupported lab runtime: ' + config.runtime)
  const entry = config.runtime === 'python' ? 'main.py' : 'index.mjs'
  if (config.entry && config.entry !== entry) throw new Error('Unsupported entry file')
  return {runtime:config.runtime,entry,title:config.title ?? 'Exercise '+id,description:config.description ?? 'Complete the exercise and run its tests.'}
}

export async function testLab(root,id,{timeoutMs=15000}={}) {
  const config=await labConfig(root,id)
  const adapter=registry.require(config.runtime)
  const controller=new AbortController()
  const events=[]
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try {
    const context={workspaceRoot:join(root,'.workshop','playgrounds',id),signal:controller.signal,emit:event=>{if(events.join('').length<50000)events.push(event.text)}}
    const diagnostics=await adapter.detect(context)
    if(diagnostics.some(item=>item.level==='error')) return {passed:false,runtime:config.runtime,output:diagnostics.map(item=>item.message).join('\n')}
    const entries = await readdir(context.workspaceRoot)
    const hasTests = entries.some(name => config.runtime === 'python' ? /^test_.*\.py$|^.*_test\.py$/.test(name) : /(?:^test.*|.*\.test)\.(?:mjs|js|cjs)$/.test(name))
    if (!hasTests) return {passed:false,runtime:config.runtime,output:'No test files found; cannot report a passing lab.'}
    await adapter.prepare(context)
    const result=await adapter.run('test',context)
    return {passed:result.exitCode===0&&!result.aborted,runtime:config.runtime,output:events.join('').slice(0,50000)+(result.aborted?'\nExecution timed out.':'')}
  } catch(error) { return {passed:false,runtime:config.runtime,output:events.join('').slice(0,45000)+'\n'+error.message} }
  finally {clearTimeout(timer)}
}
