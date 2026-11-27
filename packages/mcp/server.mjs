#!/usr/bin/env node
import { lessonText } from "../web/lessons.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { courseConfig, readProgress } from "../web/course.mjs";
import { labConfig } from "../web/runtime.mjs";
import { listFiles, readProjectFile } from "../web/files.mjs";
const root = resolve(
  process.env.WORKSHOP_CONTENT || process.argv[2] || "examples",
);
const server = new McpServer({ name: "icode-workshop", version: "0.1.0" });
const id = z.string().regex(/^\d{2}$/);
const variant = z
  .enum(
    process.env.WORKSHOP_MCP_SOLUTIONS === "1"
      ? ["problem", "playground", "solution"]
      : ["problem", "playground"],
  )
  .default("playground");
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const result = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
server.registerTool(
  "list_course",
  {
    description: "Read workshop modules, exercises and ordered lesson IDs.",
    inputSchema: {},
    annotations,
  },
  async () => result(await courseConfig(root)),
);
server.registerTool(
  "read_lesson",
  {
    description:
      "Read lesson instructions and runtime metadata; does not reveal reference solution.",
    inputSchema: { id },
    annotations,
  },
  async ({ id }) => {
    const config = await labConfig(root, id);
    return result({
      id,
      title: config.title,
      description: config.description,
      runtime: config.runtime,
      instructions: (
        await lessonText(root, id)
      ).slice(0, 30000),
    });
  },
);
server.registerTool(
  "list_project_files",
  {
    description:
      "List files in an existing lesson variant. Does not create a playground.",
    inputSchema: { id, variant },
    annotations,
  },
  async ({ id, variant }) => result(await listFiles(root, id, variant)),
);
server.registerTool(
  "read_project_file",
  {
    description:
      "Read one text file using validated project-relative paths. No shell or write access.",
    inputSchema: { id, variant, name: z.string().max(240) },
    annotations,
  },
  async ({ id, variant, name }) =>
    result({ name, code: await readProjectFile(root, id, name, variant) }),
);
server.registerTool(
  "read_progress",
  {
    description:
      "Read self-reported course completion. This is not an assessment result.",
    inputSchema: {},
    annotations,
  },
  async () => result(await readProgress(root)),
);
await server.connect(new StdioServerTransport());
