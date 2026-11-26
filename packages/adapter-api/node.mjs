import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

export async function execute(command, args, context) {
  if (!context || typeof context.workspaceRoot !== 'string') throw new TypeError('workspaceRoot required')
  if (context.signal?.aborted) return { exitCode: null, aborted: true }
  return new Promise((resolve, reject) => {
    // A workshop test may be launched from another node:test process. Do not pass
    // its internal test-runner context to the independent playground process.
    const env = { ...process.env, ...context.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawn(command, args, { cwd: context.workspaceRoot, shell: false, stdio: ['ignore','pipe','pipe'], env })
    let settled = false
    const finish = (result, error) => { if (settled) return; settled = true; context.signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result) }
    const abort = () => child.kill('SIGTERM')
    context.signal?.addEventListener('abort', abort, { once: true })
    const emit = (type, chunk) => context.emit?.({ type, text: chunk.toString() })
    child.stdout.on('data', chunk => emit('stdout', chunk))
    child.stderr.on('data', chunk => emit('stderr', chunk))
    child.on('error', error => finish(null, error))
    child.on('close', code => finish({ exitCode: code, aborted: Boolean(context.signal?.aborted) }))
    if (context.signal?.aborted) abort()
  })
}

export async function fileExists(root, name) {
  try { await access(join(root, name)); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
