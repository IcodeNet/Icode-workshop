import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
test("real MCP stdio handshake, tool discovery, lesson reads and denied paths/solutions", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("packages/mcp/server.mjs"), resolve("examples")],
    stderr: "pipe",
  });
  const client = new Client({ name: "workshop-acceptance", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint));
  const course = await client.callTool({ name: "list_course", arguments: {} });
  assert.equal(
    JSON.parse(course.content[0].text).title,
    "AI Engineering Foundations",
  );
  const lesson = await client.callTool({
    name: "read_lesson",
    arguments: { id: "01" },
  });
  assert.match(JSON.parse(lesson.content[0].text).instructions, /approved/i);
  const unsafe = await client.callTool({
    name: "read_project_file",
    arguments: { id: "01", variant: "problem", name: "../lab.json" },
  });
  assert.equal(unsafe.isError, true);
  const solution = await client.callTool({
    name: "read_project_file",
    arguments: { id: "01", variant: "solution", name: "index.mjs" },
  });
  assert.equal(solution.isError, true);
  const hidden = await client.callTool({
    name: "diff_sides",
    arguments: { a: "01.problem", b: "01.solution" },
  });
  assert.equal(hidden.isError, true, "diffs never reveal hidden solutions");
  const traversal = await client.callTool({
    name: "diff_sides",
    arguments: { a: "../01.problem", b: "02.problem" },
  });
  assert.equal(traversal.isError, true);
  const cross = await client.callTool({
    name: "diff_sides",
    arguments: { a: "01.problem", b: "02.problem" },
  });
  assert.ok(JSON.parse(cross.content[0].text).files.length > 0);
  const touched = await client.callTool({ name: "touched_files", arguments: { id: "01" } });
  const files = JSON.parse(touched.content[0].text).files;
  assert.ok(files.some((f) => f.path === "index.mjs" && f.line === 1));
  assert.ok(files.every((f) => !("hunks" in f)), "no contents");
});
