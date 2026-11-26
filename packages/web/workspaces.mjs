import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validateId } from '../core/index.mjs'
import { labConfig } from './runtime.mjs'

async function exists(path) {
  try { await stat(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
export function workspacePath(root, id) {
  validateId(id)
  return join(resolve(root), '.workshop', 'playgrounds', id)
}
export async function selectWorkspace(root, id) {
  const path = workspacePath(root, id)
  const starter = join(resolve(root), 'exercises', id, 'problem')
  if (!(await exists(starter))) throw new Error('Unknown exercise')
  if (!(await exists(path))) {
    await mkdir(join(resolve(root), '.workshop', 'playgrounds'), { recursive: true })
    await cp(starter, path, { recursive: true, force: false, errorOnExist: true })
  }
  const config=await labConfig(root,id)
  return { path, code: await readFile(join(path,config.entry),'utf8') }
}
export async function saveWorkspace(root, id, code) {
  if (typeof code !== 'string' || code.length > 50000) throw new Error('Invalid code')
  const path = workspacePath(root, id)
  if (!(await exists(path))) throw new Error('Select the exercise first')
  const config=await labConfig(root,id)
  await writeFile(join(path,config.entry), code, 'utf8')
}
