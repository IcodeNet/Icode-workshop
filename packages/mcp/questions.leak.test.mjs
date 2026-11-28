// BL-1 property test: for courses whose lessons hold check questions in every
// container Markdown allows, no API response, MCP tool result or tutor request
// contains an answer or explanation before an attempt (native and Epic layout).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { nativeCourse, epicCourse } from "../web/test-support/workspace-course.mjs";
import { askTutor } from "../web/tutor.mjs";

const SECRET = /SECRET-[A-Za-z0-9-]+|hidden reasoning words|model answer words/;
let n = 0;
const q = (extra = "") => {
  const tag = "q" + ++n;
  return `\`\`\`question\nid: ${tag}\nprompt: Prompt ${tag}?\n${extra}answer: |\n  The model answer words SECRET-${tag}-ANSWER\nexplanation: |\n  Some hidden reasoning words SECRET-${tag}-EXPLANATION\n\`\`\``;
};
const mc = () => {
  const tag = "q" + ++n;
  return `\`\`\`question\nid: ${tag}\nprompt: Pick ${tag}\noptions: [alpha, beta]\nanswer: beta\nexplanation: The hidden reasoning words SECRET-${tag}-EXPLANATION\n\`\`\``;
};
const indent = (block, prefix, first = prefix) => block.split("\n").map((l, i) => (i ? prefix : first) + l).join("\n");
function lesson(title) {
  return [
    `# ${title}`,
    "",
    indent(q(), "  ", "- "),
    "",
    indent(mc(), "   ", "1. "),
    "",
    indent(q(), ">   ", "> - "),
    "",
    "A footnote.[^a]",
    "",
    indent(q(), "    ", "[^a]: "),
    "",
    q().replace(/^```/, "~~~").replace(/```$/, "~~~"),
    "",
    "<details>\n<summary>More</summary>\n\n" + mc() + "\n\n</details>",
    "",
    q(),
    "",
    mc(),
    "",
    "The end.",
  ].join("\r\n");
}
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}
const until = async (check, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Condition not met in time");
};
async function start(root) {
  const port = await freePort();
  const server = spawn(process.execPath, [fileURLToPath(new URL("../web/server.mjs", import.meta.url))], {
    env: { ...process.env, WORKSHOP_CONTENT: root, WORKSHOP_API_PORT: String(port), WORKSHOP_SANDBOX_PORT: String(await freePort()), ICODE_SIDECARS: "0", ICODE_UPDATE_CHECK: "0", ICODE_NOTIFICATIONS_FEED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const closed = once(server, "close");
  const base = `http://127.0.0.1:${port}/api`;
  await until(() => fetch(base + "/exercises").then((r) => r.ok).catch(() => false));
  const call = async (path, { method = "GET", body } = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: r.status, text: await r.text() };
  };
  return { call, log: () => log, stop: async () => (server.kill("SIGTERM"), await closed) };
}
const clean = (label, text) => assert.doesNotMatch(String(text), SECRET, label + " leaks an answer");

async function scan(root, expected) {
  const outputs = [];
  const api = await start(root);
  try {
    const record = async (path, options) => {
      const r = await api.call(path, options);
      outputs.push([path, r.text]);
      return r;
    };
    const { ids } = JSON.parse((await record("/exercises")).text);
    for (const page of ["intro", "finished", "guide", "support"]) await record("/content/page?name=" + page);
    await record("/content/config");
    for (const id of ids) {
      await record("/select", { method: "POST", body: { id } });
      const exercise = JSON.parse((await record("/exercise?id=" + id)).text);
      assert.ok(exercise.documents.some((d) => d.questions.length), id + ": the fixture has questions");
      await record("/questions?id=" + id);
      await record("/content/page?name=guide&id=" + id);
      await record("/content/app?id=" + id);
      await record("/touched?id=" + id);
      for (const variant of ["problem", "solution", "playground"]) {
        const files = JSON.parse((await record(`/files?id=${id}&variant=${variant}`)).text).files ?? [];
        for (const name of files) await record(`/file?id=${id}&variant=${variant}&name=${encodeURIComponent(name)}`);
        await record(`/file?id=${id}&variant=${variant}&name=README.mdx`);
      }
      await record(`/diff?a=${id}.problem&b=${id}.solution`);
      await record(`/diff?a=${id}.playground&b=${id}.solution`);
      // Wrong attempts first, then the review list: still nothing revealed.
      await record("/questions/review");
      await record("/progress");
    }
    // Sanity: the markers are real, and only an attempt reveals them.
    const first = JSON.parse(outputs.find(([p]) => p.startsWith("/questions?id=")) [1]).questions.find((x) => x.kind === "free");
    const revealed = await api.call("/questions/reveal", { method: "POST", body: { id: ids[0], question: first.id, attempt: "my attempt" } });
    assert.match(revealed.text, SECRET);
    await record("/questions/review");
  } finally {
    await api.stop();
  }
  // MCP: every tool, every step and variant, with solutions allowed.
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("./server.mjs", import.meta.url)), root], env: { ...process.env, WORKSHOP_MCP_SOLUTIONS: "1" }, stderr: "pipe" });
  const client = new Client({ name: "leak-probe", version: "1.0.0" });
  await client.connect(transport);
  try {
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      outputs.push(["mcp " + name + " " + JSON.stringify(args), JSON.stringify(r)]);
      return r;
    };
    const { ids } = JSON.parse((await call("list_course", {})).content[0].text);
    for (const id of ids) {
      assert.match((await call("read_lesson", { id })).content[0].text, /Check question:\*\* Prompt/);
      for (const variant of ["problem", "solution", "playground"]) {
        const listed = await call("list_project_files", { id, variant });
        const files = listed.isError ? [] : JSON.parse(listed.content[0].text).files ?? [];
        for (const name of [...files, "README.mdx", "README.md"]) await call("read_project_file", { id, variant, name });
      }
      await call("diff_sides", { a: id + ".problem", b: id + ".solution" });
      await call("touched_files", { id });
      await call("read_progress", {});
    }
  } finally {
    await client.close();
  }
  // Tutor: the request body sent to the model provider.
  for (const id of expected) {
    let body = "";
    await askTutor(root, { id, question: "What is the answer?", history: [] }, { config: { url: "https://model.example/chat", model: "m" }, fetcher: async (_, options) => ((body = options.body), { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) }) });
    assert.match(body, /Check question:\*\* Prompt/, "the tutor still gets the prompts");
    outputs.push(["tutor " + id, body]);
  }
  for (const [label, text] of outputs) clean(label, text);
  return outputs.length;
}

test("no API, MCP or tutor output holds an answer: native course with questions in every container", { timeout: 120000 }, async () => {
  const root = await nativeCourse({
    files: {
      "exercises/01/README.md": lesson("Step one"),
      "exercises/01/FINISHED.md": lesson("Wrap-up"),
      "exercises/02/README.md": lesson("Step two"),
      "exercises/README.md": lesson("Course home"),
      "exercises/FINISHED.md": lesson("Finished"),
    },
  });
  assert.ok((await scan(root, ["01", "02"])) > 50);
});

test("no API, MCP or tutor output holds an answer: Epic layout, where the lesson lives inside the problem app", { timeout: 120000 }, async () => {
  const root = await epicCourse({
    files: {
      "exercises/README.mdx": lesson("Course intro"),
      "exercises/01.basics/README.mdx": lesson("Exercise intro"),
      "exercises/01.basics/01.problem.start/README.mdx": lesson("Problem"),
      "exercises/01.basics/01.solution.start/README.mdx": lesson("Solution"),
      "exercises/01.basics/FINISHED.mdx": lesson("Wrap-up"),
    },
  });
  assert.ok((await scan(root, ["01"])) > 20);
  // The lesson file stays out of the playground copy; the app files are there.
  const playground = await readdir(join(root, ".workshop", "playgrounds", "01"), { recursive: true });
  assert.ok(!playground.some((f) => /readme\.mdx$/i.test(f)), JSON.stringify(playground));
  assert.ok(playground.some((f) => f.endsWith("index.ts")));
  // On disk the course file is unchanged (documented: anyone can open it).
  assert.match(await readFile(join(root, "exercises", "01.basics", "01.problem.start", "README.mdx"), "utf8"), /SECRET-/);
});
