import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { listExercises, validateId } from '../core/index.mjs'
import { selectWorkspace, saveWorkspace, workspacePath } from './workspaces.mjs'

const root = resolve(process.env.WORKSHOP_CONTENT ?? fileURLToPath(new URL('../../examples', import.meta.url)))
const port = Number(process.env.WORKSHOP_API_PORT ?? 4317)
const host = '127.0.0.1'
const allowedOrigin = 'http://127.0.0.1:5173'
const json = (res, code, body) => { res.writeHead(code, {'content-type':'application/json; charset=utf-8','access-control-allow-origin':allowedOrigin,'vary':'Origin'}); res.end(JSON.stringify(body)) }
async function readBody(req) {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > 100_000) throw new Error('Request too large') }
  return JSON.parse(body || '{}')
}
async function readText(path) { return readFile(path, 'utf8') }
async function load(id) {
  validateId(id)
  const base = join(root, 'exercises', id)
  return { id, title: id === '01' ? 'Approved documents only' : 'Exercise '+id, topic: 'AI engineering', description: id === '01' ? 'Implement a retrieval filter that returns approved documents only. Run the tests to confirm unapproved documents never appear in results.' : 'Complete the exercise and run its tests.', problem: await readText(join(base,'problem','index.mjs')), solution: await readText(join(base,'solution','index.mjs')) }
}
function testPlayground(id) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test'], { cwd:workspacePath(root,id), shell:false, env:{PATH:process.env.PATH ?? ''}, stdio:['ignore','pipe','pipe'] })
    let output = ''
    const add = chunk => { output = (output + chunk.toString()).slice(0,50000) }
    child.stdout.on('data',add); child.stderr.on('data',add)
    const timeout = setTimeout(() => child.kill('SIGKILL'),15000)
    child.on('error',error => { clearTimeout(timeout); done({passed:false,output:error.message}) })
    child.on('close',code => { clearTimeout(timeout); done({passed:code===0,output}) })
  })
}
const server = createServer(async (req,res) => {
  if (req.headers.origin && req.headers.origin !== allowedOrigin) return json(res,403,{error:'Origin denied'})
  if (req.method === 'OPTIONS') { res.writeHead(204,{'access-control-allow-origin':allowedOrigin,'access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'content-type'}); return res.end() }
  try {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/api/exercises') return json(res,200,{ids:await listExercises(root)})
    if (req.method === 'GET' && url.pathname === '/api/exercise') return json(res,200,await load(url.searchParams.get('id')))
    if (req.method === 'GET' && url.pathname === '/api/playground') {
      const path=join(workspacePath(root,url.searchParams.get('id')),'index.mjs')
      try { return json(res,200,{code:await readText(path)}) } catch(error) { if(error.code==='ENOENT') return json(res,404,{error:'Playground not created'}); throw error }
    }
    if (req.method === 'POST' && url.pathname === '/api/select') {
      const {id}=await readBody(req); validateId(id)
      const result=await selectWorkspace(root,id)
      return json(res,200,{code:result.code,restored:true})
    }
    if (req.method === 'PUT' && url.pathname === '/api/playground') {
      const {id,code}=await readBody(req)
      validateId(id)
      await saveWorkspace(root,id,code)
      return json(res,200,{saved:true})
    }
    if (req.method === 'POST' && url.pathname === '/api/test') { const {id}=await readBody(req); validateId(id); return json(res,200,await testPlayground(id)) }
    return json(res,404,{error:'Not found'})
  } catch(error) { json(res,400,{error:error.message}) }
})
server.listen(port,host,()=>console.log('Icode Workshop API on http://'+host+':'+port+' using '+root))
