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
  assert.equal(tools.length, 5);
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
});
