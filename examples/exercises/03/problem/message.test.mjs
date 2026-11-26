import test from 'node:test'
import assert from 'node:assert/strict'
import {message} from './message.mjs'
test('greets the learner',()=>assert.equal(message(),'Hello, Icode Workshop!'))
