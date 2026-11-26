#!/usr/bin/env node
import { resolve } from 'node:path'
import { listExercises, setExercise, runTests, showDiff } from '../core/index.mjs'

const args = process.argv.slice(2)
const command = args[0]
const contentFlag = args.indexOf('--content')
const content = resolve(contentFlag < 0 ? '.' : (args[contentFlag + 1] ?? '.'))
const id = args[1]
async function main() {
  if (command === 'list') return console.log((await listExercises(content)).join('\n'))
  if (command === 'set') return console.log(await setExercise(content, id))
  if (command === 'test') { process.exitCode = runTests(content); return }
  if (command === 'diff') { showDiff(content, id ?? '01'); return }
  throw new Error('Usage: workshop list|set <id>|test|diff [id] --content <path>')
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
