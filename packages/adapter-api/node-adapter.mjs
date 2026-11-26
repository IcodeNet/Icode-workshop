import { execute, fileExists } from './node.mjs'
export const nodeAdapter = {
  id: 'node', apiVersion: 1,
  async detect(context) { return [{ level: 'info', message: 'Node.js ' + process.version }] },
  async prepare(context) { if (!(await fileExists(context.workspaceRoot, 'package.json'))) return },
  async run(command, context) {
    if (command === 'test') return execute(process.execPath, ['--test'], context)
    if (command === 'run') return execute(process.execPath, ['index.mjs'], context)
    throw new Error('Unsupported Node command: ' + command)
  }
}
