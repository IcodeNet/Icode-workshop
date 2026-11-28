// Check questions over HTTP: answers only after an attempt, progress stored
// with step progress, origin and session-token checks, and the mutation gate.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCourse } from "./test-support/workspace-course.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}
const until = async (check, ms = 15000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Condition not met in time");
};
function raw(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body ?? ""), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
async function start(root) {
  const port = await freePort();
  const sandboxPort = await freePort();
  const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, WORKSHOP_CONTENT: root, WORKSHOP_API_PORT: String(port), WORKSHOP_SANDBOX_PORT: String(sandboxPort), ICODE_SIDECARS: "0", ICODE_UPDATE_CHECK: "0", ICODE_NOTIFICATIONS_FEED: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const closed = once(server, "close");
  const base = `http://127.0.0.1:${port}/api`;
  await until(() => fetch(base + "/exercises").then((r) => r.ok).catch(() => false));
  const call = async (path, { method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { port, sandboxPort, call, stop: async () => (server.kill("SIGTERM"), await closed), log: () => log };
}
const fence = (body) => "```question\n" + body + "\n```\n";
const SECRETS = /EXPLAIN-MC-SECRET|MODEL-ANSWER-SECRET|EXPLAIN-FREE-SECRET/;
async function course(extra = {}) {
  return nativeCourse({
    ...extra,
    files: {
      "exercises/01/README.md":
        "# Step one\n\n" +
        fence("id: bm25\nprompt: Which is lexical?\noptions: [BM25, Cosine]\nanswer: BM25\nexplanation: Term statistics. EXPLAIN-MC-SECRET\nsource: handoff") +
        fence("id: rrf\nprompt: Why RRF?\nanswer: Ranks compare. MODEL-ANSWER-SECRET\nexplanation: Scores do not. EXPLAIN-FREE-SECRET"),
      ...extra.files,
    },
  });
}

test("questions: no answer in any lesson payload; check, reveal and self-mark persist with step progress", { timeout: 60000 }, async () => {
  const root = await course();
  let api = await start(root);
  try {
    // The initial payloads (lesson HTML, documents, plain text) hold no answer.
    const exercise = await api.call("/exercise?id=01");
    assert.equal(exercise.status, 200);
    assert.doesNotMatch(JSON.stringify(exercise.body), SECRETS);
    assert.deepEqual(exercise.body.documents[0].questions, [{ id: "bm25", kind: "choice" }, { id: "rrf", kind: "free" }]);
    assert.match(exercise.body.lesson.html, /data-question="bm25" data-kind="choice"/);
    const list = await api.call("/questions?id=01");
    assert.doesNotMatch(JSON.stringify(list.body), SECRETS);
    assert.deepEqual(list.body.questions.map((q) => q.id), ["bm25", "rrf"]);
    assert.deepEqual(list.body.progress, {});
    // Attempts are validated before anything is revealed.
    for (const [path, body, status] of [
      ["check", { id: "01", question: "bm25" }, 400],
      ["check", { id: "01", question: "bm25", choice: 2 }, 400],
      ["check", { id: "01", question: "bm25", choice: "0" }, 400],
      ["check", { id: "01", question: "rrf", choice: 0 }, 404],
      ["check", { id: "01", question: "nope", choice: 0 }, 404],
      ["check", { id: "99", question: "bm25", choice: 0 }, 400],
      ["check", { id: "../01", question: "bm25", choice: 0 }, 400],
      ["check", { id: "01", question: "../../x", choice: 0 }, 400],
      ["reveal", { id: "01", question: "rrf" }, 400],
      ["reveal", { id: "01", question: "rrf", attempt: "   \n" }, 400],
      ["reveal", { id: "01", question: "rrf", attempt: "x".repeat(5001) }, 400],
      ["reveal", { id: "01", question: "bm25", attempt: "BM25" }, 404],
      ["mark", { id: "01", question: "rrf", mark: "review" }, 400],
      // A client cannot record a result without answering.
      ["mark", { id: "01", question: "bm25", mark: "got-it", status: "correct" }, 400],
      ["reveal", { id: "01", question: "rrf", attempt: "\u200b\u200b" }, 400],
    ]) {
      const r = await api.call("/questions/" + path, { method: "POST", body });
      assert.equal(r.status, status, path + " " + JSON.stringify(body));
      assert.doesNotMatch(JSON.stringify(r.body), SECRETS, "a refused attempt reveals nothing");
    }
    assert.deepEqual((await api.call("/progress")).body.questions, {}, "refused attempts record nothing");
    const wrong = await api.call("/questions/check", { method: "POST", body: { id: "01", question: "bm25", choice: 1 } });
    assert.deepEqual([wrong.status, wrong.body.correct, wrong.body.answerIndex], [200, false, 0]);
    assert.match(wrong.body.explanationHtml, /<p>Term statistics. EXPLAIN-MC-SECRET<\/p>/);
    assert.deepEqual((await api.call("/questions/review")).body.items, [{ step: "01", id: "bm25", kind: "choice", prompt: "Which is lexical?", status: "incorrect" }]);
    const right = await api.call("/questions/check", { method: "POST", body: { id: "01", question: "bm25", choice: 0 } });
    assert.equal(right.body.correct, true);
    const revealed = await api.call("/questions/reveal", { method: "POST", body: { id: "01", question: "rrf", attempt: "Because ranks are comparable" } });
    assert.equal(revealed.status, 200);
    assert.match(revealed.body.answerHtml, /MODEL-ANSWER-SECRET/);
    assert.match(revealed.body.explanationHtml, /EXPLAIN-FREE-SECRET/);
    assert.equal((await api.call("/questions/mark", { method: "POST", body: { id: "01", question: "rrf", mark: "maybe" } })).status, 400);
    const marked = await api.call("/questions/mark", { method: "POST", body: { id: "01", question: "rrf", mark: "review", status: "correct", choice: 1, at: "2000-01-01T00:00:00.000Z" } });
    assert.deepEqual([marked.body.progress.status, marked.body.progress.mark, marked.body.progress.choice], ["revealed", "review", undefined], "mark ignores a client-sent status, choice and time");
    assert.notEqual(marked.body.progress.at, "2000-01-01T00:00:00.000Z");
    assert.deepEqual((await api.call("/questions/review")).body.items.map((i) => [i.id, i.mark]), [["rrf", "review"]]);
    await api.call("/progress", { method: "PUT", body: { id: "01", complete: true } });
    // Stored with step progress, on disk; the attempt text itself is not stored.
    const disk = JSON.parse(await readFile(join(root, ".workshop", "progress.json"), "utf8"));
    assert.deepEqual(disk.completed, ["01"]);
    assert.deepEqual([disk.questions["01"].bm25.status, disk.questions["01"].bm25.choice, disk.questions["01"].rrf.status, disk.questions["01"].rrf.mark], ["correct", 0, "revealed", "review"]);
    assert.doesNotMatch(JSON.stringify(disk), /comparable/);
  } finally {
    await api.stop();
  }
  // A restarted engine serves the same progress.
  api = await start(root);
  try {
    const progress = (await api.call("/progress")).body;
    assert.deepEqual(progress.completed, ["01"]);
    assert.deepEqual(Object.keys(progress.questions["01"]).sort(), ["bm25", "rrf"]);
    assert.deepEqual(Object.keys((await api.call("/questions?id=01")).body.progress).sort(), ["bm25", "rrf"]);
    assert.equal((await api.call("/questions/mark", { method: "POST", body: { id: "01", question: "rrf", mark: "got-it" } })).status, 200);
    assert.deepEqual((await api.call("/questions/review")).body.items, []);
  } finally {
    await api.stop();
  }
});

test("questions: foreign origins, the sandbox, cross-site requests and browsers without the session token are refused", { timeout: 60000 }, async () => {
  const root = await course();
  const api = await start(root);
  try {
    const host = "127.0.0.1:" + api.port;
    const sandbox = "http://127.0.0.1:" + api.sandboxPort;
    const routes = [
      ["GET", "/api/questions?id=01"],
      ["GET", "/api/questions/review"],
      ["POST", "/api/questions/check", { id: "01", question: "bm25", choice: 0 }],
      ["POST", "/api/questions/reveal", { id: "01", question: "rrf", attempt: "guess" }],
      ["POST", "/api/questions/mark", { id: "01", question: "rrf", mark: "review" }],
    ];
    for (const [method, path, body] of routes) {
      const payload = body && JSON.stringify(body);
      for (const headers of [
        { host, origin: sandbox },
        { host, origin: "null" },
        { host, origin: "https://evil.test" },
        { host, "sec-fetch-site": "same-site" },
        { host, "sec-fetch-site": "cross-site" },
        { host: "evil.test:" + api.port },
        { host: "127.0.0.1:" + api.sandboxPort },
      ]) {
        const r = await raw(api.port, path, { method, headers, body: payload });
        assert.equal(r.status, 403, `${method} ${path} ${JSON.stringify(headers)}`);
        assert.doesNotMatch(r.data, SECRETS);
      }
    }
    // The UI origin itself still needs the per-process session token to mutate.
    const body = JSON.stringify({ id: "01", question: "bm25", choice: 0 });
    for (const headers of [{ host, origin: "http://127.0.0.1:5173" }, { host, "sec-fetch-site": "same-origin" }, { host, origin: "http://127.0.0.1:5173", "x-icode-session": "0".repeat(64) }]) {
      const r = await raw(api.port, "/api/questions/check", { method: "POST", headers, body });
      assert.equal(r.status, 403, JSON.stringify(headers));
      assert.doesNotMatch(r.data, SECRETS);
    }
    assert.deepEqual((await api.call("/progress")).body.questions, {}, "nothing was recorded");
    const { token } = JSON.parse((await raw(api.port, "/api/session", { headers: { host, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" } })).data);
    const ok = await raw(api.port, "/api/questions/check", { method: "POST", headers: { host, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin", "x-icode-session": token }, body });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.data).correct, true);
    assert.equal(ok.headers["x-frame-options"], "DENY");
  } finally {
    await api.stop();
  }
});

test("questions: exempt from the mutation gate (progress only), while step progress waits for it", { timeout: 60000 }, async () => {
  const root = await course({
    hooks: { preSetPlayground: "slow" },
    scripts: { slow: "node slow.mjs" },
    files: { "slow.mjs": "setTimeout(() => {}, 3000);\n" },
  });
  const api = await start(root);
  try {
    const select = api.call("/select", { method: "POST", body: { id: "01" } });
    await until(async () => (await api.call("/processes")).body.processes.some((p) => p.kind === "hook"));
    assert.equal((await api.call("/progress", { method: "PUT", body: { id: "01", complete: true } })).status, 409, "step progress is gated");
    const checked = await api.call("/questions/check", { method: "POST", body: { id: "01", question: "bm25", choice: 1 } });
    assert.equal(checked.status, 200, "a check question can be answered while a hook or test holds the gate");
    const revealed = await api.call("/questions/reveal", { method: "POST", body: { id: "01", question: "rrf", attempt: "a guess" } });
    assert.equal(revealed.status, 200);
    assert.equal((await api.call("/questions/mark", { method: "POST", body: { id: "01", question: "rrf", mark: "review" } })).status, 200);
    assert.equal((await select).status, 200);
    const progress = (await api.call("/progress")).body;
    assert.deepEqual([progress.questions["01"].bm25.status, progress.questions["01"].rrf.mark], ["incorrect", "review"]);
    assert.deepEqual(progress.completed, []);
  } finally {
    await api.stop();
  }
});
