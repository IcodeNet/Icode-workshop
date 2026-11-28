import test from 'node:test'
import assert from 'node:assert/strict'
import { validateId, listExercises } from '../index.mjs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const examples = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples')
test('rejects unsafe exercise identifiers', () => {
  for (const id of ['../', '1', '01/../../', 'abc']) assert.throws(() => validateId(id))
})
test('discovers example exercise', async () => {
  assert.deepEqual(await listExercises(examples), ['01', '02', '03', '04', '05'])
})
