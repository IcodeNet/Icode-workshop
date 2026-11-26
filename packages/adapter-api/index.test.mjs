import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdapterRegistry, validateAdapter } from './index.mjs'

const sample = (id = 'python') => ({ id, apiVersion: 1, async detect(){ return [] }, async prepare(){}, async run(){ return { exitCode: 0 } } })
test('registers a valid third-party adapter explicitly', () => {
  const registry = createAdapterRegistry()
  const adapter = sample()
  assert.equal(registry.register(adapter), adapter)
  assert.equal(registry.require('python'), adapter)
  assert.deepEqual(registry.list(), ['python'])
})
test('rejects duplicate, malformed and incompatible adapters', () => {
  const registry = createAdapterRegistry()
  registry.register(sample())
  assert.throws(() => registry.register(sample()), /Duplicate/)
  assert.throws(() => validateAdapter({...sample(),apiVersion:2}), /Unsupported/)
  assert.throws(() => validateAdapter({...sample(),id:'../escape'}), /Invalid/)
  assert.throws(() => validateAdapter({...sample(),run:null}), /requires run/)
  assert.throws(() => registry.require('rust'), /not registered/)
})
