import test from "node:test";
import assert from "node:assert/strict";
import { validateTools } from "./tools.mjs";
test("tool views accept explicit local services and reject unsafe targets", () => {
  const tool = {
    id: "cosmos",
    title: "Cosmos Explorer",
    url: "http://localhost:1234",
    mode: "embed",
  };
  assert.equal(validateTools([tool])[0].url, "http://localhost:1234/");
  for (const url of [
    "javascript:alert(1)",
    "https://example.com",
    "http://user:pass@localhost:1234",
    "http://localhost:4317",
    "http://127.0.0.1:5173",
  ])
    assert.throws(() => validateTools([{ ...tool, url }]));
});
