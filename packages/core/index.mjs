import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

async function exists(path) {
  try { await stat(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
export function validateId(id) {
  if (!/^[0-9]{2}$/.test(id ?? '')) throw new Error('Exercise ID must contain exactly two digits')
  return id
}
export async function listExercises(contentRoot) {
  const entries = await readdir(join(resolve(contentRoot), 'exercises'), { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory() && /^[0-9]{2}$/.test(entry.name)).map((entry) => entry.name).sort()
}
export async function setExercise(contentRoot, id) {
  validateId(id)
  const root = resolve(contentRoot)
  const source = join(root, 'exercises', id, 'problem')
  const playground = join(root, 'playground')
  if (!(await exists(source))) throw new Error('Unknown exercise')
  let backup = null
  if (await exists(playground)) {
    backup = join(root, 'playground.backup-' + Date.now())
    await rename(playground, backup)
  }
  try {
    await cp(source, playground, { recursive: true, force: false, errorOnExist: true })
  } catch (error) {
    if (backup && !(await exists(playground))) await rename(backup, playground)
    throw error
  }
  return { playground, backup }
}
export function runTests(contentRoot) {
  const playground = join(resolve(contentRoot), 'playground')
  const result = spawnSync(process.execPath, ['--test'], { cwd: playground, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}
export function showDiff(contentRoot, id) {
  validateId(id)
  const root = resolve(contentRoot)
  const result = spawnSync('diff', ['-ru', join(root, 'playground'), join(root, 'exercises', id, 'solution')], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (![0, 1].includes(result.status)) throw new Error('Diff command failed')
  return result.status
}
