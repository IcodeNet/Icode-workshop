import test from "node:test";
import assert from "node:assert/strict";
import { groupByStatus, documents } from "./index.mjs";

test("groups titles by status without changing the input", () => {
  const copy = structuredClone(documents);
  assert.deepEqual(groupByStatus(documents), { approved: ["Retention policy", "Security guide"], draft: ["Draft FAQ"] });
  assert.deepEqual(documents, copy);
});
