import test from 'node:test'
import assert from 'node:assert/strict'
import { approvedOnly } from './index.mjs'
test('returns only approved documents',()=>{
  assert.deepEqual(approvedOnly([{id:1,status:'approved'},{id:2,status:'draft'}]),[{id:1,status:'approved'}])
})
