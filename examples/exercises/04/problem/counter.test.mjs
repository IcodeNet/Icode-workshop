import test from "node:test";
import assert from "node:assert/strict";
import { next } from "./counter.mjs";

test("next adds one", () => {
  assert.equal(next(0), 1);
  assert.equal(next(41), 42);
});
