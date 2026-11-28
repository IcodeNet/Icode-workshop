// Check questions (A6): parser limits, validation, rendering, answer hiding
// and hostile blocks (XSS, YAML bombs, huge blocks). See docs/check-questions.md.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseQuestion, derivedQuestionId, QUESTION_LIMITS } from "./questions.mjs";
import { renderLesson, renderSafe, analyzeQuestions, questionProblems } from "./markdown.mjs";
import { lessonDocuments, stepQuestions, lessonText, validateQuestions } from "./lessons.mjs";
import { readProgress, updateQuestionProgress, cleanQuestions } from "./course.mjs";
import { nativeCourse, writeTree } from "./test-support/workspace-course.mjs";
import { join } from "node:path";

const fence = (body, info = "question") => "```" + info + "\n" + body + "\n```\n";
const render = (source, options = {}) => renderLesson(source, { stepId: "01", docPath: "README.md", sandboxOrigin: "http://127.0.0.1:4318", ...options });
const MC = `prompt: Which ranks by term frequency?
options:
  - BM25
  - Cosine similarity
answer: 0
explanation: BM25 is a lexical scorer. EXPLANATION-SECRET
source: handoff`;
const FREE = `id: rrf
prompt: Why fuse with RRF?
answer: |
  Ranks from different scorers are comparable. MODEL-ANSWER-SECRET
explanation: Scores are not. FREE-EXPLANATION-SECRET`;
const SECRETS = /EXPLANATION-SECRET|MODEL-ANSWER-SECRET|FREE-EXPLANATION-SECRET/;

test("parser: multiple choice by index or text, free text, optional id and source", () => {
  const mc = parseQuestion(MC);
  assert.equal(mc.ok, true);
  assert.deepEqual([mc.question.kind, mc.question.answerIndex, mc.question.source, mc.question.options.length], ["choice", 0, "handoff", 2]);
  const byText = parseQuestion(MC.replace("answer: 0", "answer: Cosine similarity"));
  assert.equal(byText.question.answerIndex, 1);
  const free = parseQuestion(FREE);
  assert.deepEqual([free.question.kind, free.question.id], ["free", "rrf"]);
  assert.match(free.question.answer, /comparable/);
});

test("validation: every required field, bad answers, unknown fields and ids are reported", () => {
  const errors = (body) => (parseQuestion(body).ok ? [] : parseQuestion(body).errors).join("\n");
  assert.match(errors("options: [a, b]\nanswer: 0"), /prompt is required[\s\S]*explanation is required/);
  assert.match(errors("prompt: p\nexplanation: e"), /answer is required/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: 2\noptions: [a, b]"), /not an option index \(0 to 1/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: c\noptions: [a, b]"), /exact text of one option/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: a\noptions: [a]"), /2–10 entries/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: a\noptions: [a, a]"), /distinct/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: a\noptions: [a, '']"), /non-empty/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: {x: 1}"), /model answer/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: a\nhint: no"), /Unknown field "hint"/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: a\nid: ../x"), /id must be/);
  assert.match(errors("prompt: p\nexplanation: e\nanswer: a\nsource: \"a\\nb\""), /source must be a short label/);
  assert.match(errors("prompt: p\nprompt: q\nexplanation: e\nanswer: a"), /not valid YAML/);
  assert.match(errors("just text"), /YAML mapping/);
  assert.match(errors("- a\n- b"), /YAML mapping/);
  assert.match(errors(""), /empty/);
  assert.match(errors("prompt: p\n---\nprompt: q"), /exactly one YAML document/);
  assert.match(errors("prompt: [unclosed"), /not valid YAML/);
});

test("safe YAML: no tags, anchors, aliases or merge keys; size, depth and length limits", () => {
  const errors = (body) => parseQuestion(body).errors?.join("\n") ?? "";
  // Billion laughs: rejected before anything is expanded.
  const bomb = ['a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]', ...Array.from({ length: 8 }, (_, i) => `${"bcdefghi"[i]}: &${"bcdefghi"[i]} [${Array(9).fill("*" + "abcdefgh"[i]).join(",")}]`), "prompt: *i"].join("\n");
  const started = Date.now();
  assert.match(errors(bomb), /anchors|aliases/);
  assert.ok(Date.now() - started < 1000, "the bomb is refused quickly");
  assert.match(errors("prompt: !!js/function 'return 1'\nanswer: a\nexplanation: e"), /tags/);
  assert.match(errors("prompt: !custom x\nanswer: a\nexplanation: e"), /tags/);
  assert.match(errors("prompt: !!str x\nanswer: a\nexplanation: e"), /tags/);
  assert.match(errors("base: &b {prompt: p}\n<<: *b\nanswer: a\nexplanation: e"), /anchors|aliases/);
  assert.match(errors("prompt: p\nanswer: a\nexplanation: e\noptions: [[[[x]]]]"), /nested too deeply/);
  assert.match(errors("? [complex, key]\n: v\nprompt: p"), /nested too deeply|Unknown field/);
  assert.match(errors("prompt: " + "x".repeat(QUESTION_LIMITS.blockBytes)), /larger than 16 KB/);
  assert.match(errors("prompt: " + "x".repeat(QUESTION_LIMITS.promptChars + 1) + "\nanswer: a\nexplanation: e"), /prompt is longer/);
  assert.match(errors("prompt: p\nanswer: a\nexplanation: e\noptions: [" + Array.from({ length: 11 }, (_, i) => "o" + i).join(",") + "]"), /2–10 entries/);
  assert.match(errors("prompt: p\nanswer: 0\nexplanation: e\noptions: [" + "y".repeat(501) + ", b]"), /at most 500/);
});

test("fences: found by the Markdown parse, with source lines; ~~~, longer fences, quotes, unclosed and non-question code", () => {
  const source = ["# T", "", fence(MC), "```js", "```question inside js", "```", "~~~~question", FREE, "~~~~", "> ```question", "> prompt: quoted", "> ```", "```question", "prompt: open"].join("\n");
  const { blocks, orphans } = analyzeQuestions(source);
  assert.deepEqual(blocks.map((b) => b.line), [3, 16, 23, 26]);
  assert.match(blocks[2].body, /^prompt: quoted$/);
  assert.deepEqual(blocks.map((b) => b.unclosed), [false, false, false, true]);
  assert.deepEqual(orphans, [], "a question fence inside a js example is not an orphan");
  // Lines are source lines even where block components add blank lines.
  assert.deepEqual(analyzeQuestions("<details>\n<summary>s</summary>\n\n" + fence(MC) + "</details>\n").blocks.map((b) => b.line), [4]);
  assert.equal(derivedQuestionId("README.md", 2), "readme-2");
  assert.equal(derivedQuestionId("01.problem.hello/README.mdx", 1), "01-problem-hello-readme-1");
});

// Every container a fenced block can sit in (BL-1), each followed by more
// questions: rendering, the plain-text copy and validate must agree.
const secretQuestion = (tag, extra = "") => `\`\`\`question\nid: ${tag}\n${extra}prompt: Prompt ${tag}?\nanswer: |\n  Model answer ${tag} with several distinct words SECRET-${tag}-ANSWER\nexplanation: Because ${tag} has its own long reason SECRET-${tag}-EXPLANATION\n\`\`\``;
const indent = (block, prefix, first = prefix) => block.split("\n").map((l, i) => (i ? prefix : first) + l).join("\n");
const LAYOUTS = {
  listItem: (q) => "- item\n\n" + indent(q, "  ", "- "),
  listNoPad: (q) => indent(q, "  ", "- "),
  orderedItem: (q) => indent(q, "   ", "1. "),
  quote: (q) => indent(q, "> "),
  quoteList: (q) => indent(q, ">   ", "> - "),
  footnote: (q) => "See the note.[^n]\n\n" + indent(q, "    ", "[^n]: "),
  nestedList: (q) => "- a\n  - b\n\n" + indent(q, "    ", "    "),
  tilde: (q) => q.replace(/^```/, "~~~").replace(/```$/, "~~~"),
  indentedFence: (q) => indent(q, "   "),
  longFence: (q) => q.replace(/^```/, "`````").replace(/```$/, "`````"),
  htmlBlankLines: (q) => "<div>\n\n" + q + "\n\n</div>",
  details: (q) => "<details>\n<summary>More</summary>\n\n" + q + "\n\n</details>",
  tableNeighbour: (q) => "| a | b |\n|---|---|\n| ```question | x |\n\n" + q,
};
test("BL-1: questions in lists, quotes, footnotes, HTML, tables, tilde and indented fences, CRLF: rendered, stripped and validated alike", async () => {
  for (const [name, layout] of Object.entries(LAYOUTS))
    for (const mdx of [false, true])
      for (const eol of ["\n", "\r\n"]) {
        const source = ["# Lesson", "", "Intro.", "", layout(secretQuestion("nested")), "", "Middle.", "", secretQuestion("after1"), "", secretQuestion("after2"), "", "Outro."].join("\n").replaceAll("\n", eol);
        const label = `${name} mdx=${mdx} eol=${JSON.stringify(eol)}`;
        const r = await renderLesson(source, { stepId: "01", docPath: "README.md", mdx });
        assert.deepEqual(r.questions.map((q) => q.id), ["nested", "after1", "after2"], label);
        for (const out of [r.html, r.text]) assert.doesNotMatch(out, /SECRET-|several distinct words|its own long reason/, label);
        assert.match(r.text, /\*\*Check question:\*\* Prompt nested\?[\s\S]*Prompt after1\?[\s\S]*Prompt after2\?[\s\S]*Outro\./, label);
        assert.equal((r.html.match(/class="check-question"/g) || []).length, 3, label);
        const { count, problems } = questionProblems(source, "README.md", { mdx });
        assert.deepEqual([count, problems], [3, []], label);
        // Invalid in that container: validate reports it, at its line.
        const bad = ["# Lesson", "", "Intro.", "", layout(secretQuestion("nested", "foo: bar\n")), "", secretQuestion("after1")].join("\n").replaceAll("\n", eol);
        const report = questionProblems(bad, "README.md", { mdx }).problems;
        assert.ok(report.some((p) => /Unknown field "foo"/.test(p.message) && p.line >= 5), label + " " + JSON.stringify(report));
      }
});

test("fail closed: text that looks like a question but is not parsed as one withholds the lesson and fails validate", async () => {
  const cases = {
    htmlNoBlankLine: "<div>\n" + secretQuestion("orphan") + "\n</div>",
    tabIndented: secretQuestion("orphan").split("\n").map((l) => "\t" + l).join("\n"),
  };
  for (const [name, block] of Object.entries(cases)) {
    const source = "# L\n\nIntro.\n\n" + block + "\n\n" + secretQuestion("ok") + "\n";
    const r = await renderLesson(source, { stepId: "01", docPath: "README.md" });
    assert.doesNotMatch(r.html + r.text, /SECRET-orphan|several distinct words/, name);
    assert.match(r.html, /question-withheld/, name);
    assert.ok(r.warnings.some((w) => /withheld/.test(w)), name);
    const { problems } = questionProblems(source, "README.md");
    assert.ok(problems.some((p) => p.line >= 5 && p.line <= 6 && /not parsed as one/.test(p.message)), name + " " + JSON.stringify(problems));
  }
  // Mentions of the syntax inside a fenced example or inline code are not questions.
  const docs = "Use a ```question fence.\n\n````markdown\n" + secretQuestion("example") + "\n````\n";
  const shown = await renderLesson(docs, { stepId: "01", docPath: "README.md" });
  assert.match(shown.html, /SECRET-example-ANSWER/, "an authoring example is shown as code");
  assert.deepEqual([shown.questions, questionProblems(docs, "README.md").problems], [[], []]);
  // A raw <pre><code class="language-question"> cannot become a question.
  const raw = await renderLesson('<pre><code class="language-question">prompt: p\nanswer: a\nexplanation: e</code></pre>', { stepId: "01" });
  assert.deepEqual(raw.questions, []);
  assert.doesNotMatch(raw.html, /check-question/);
});

test("rendering: prompt and options only, answers server-side, ids in document order", async () => {
  const { html, questions, warnings } = await render("# Lesson\n\n" + fence(MC) + "\n" + fence(FREE) + "\n" + fence(MC.replace("source: handoff", "id: rrf")));
  assert.doesNotMatch(html, SECRETS, "no answer or explanation in the lesson HTML");
  assert.doesNotMatch(html, /data-answer|answerIndex/);
  assert.match(html, /<div class="check-question" id="q-readme-1" role="group" aria-labelledby="q-readme-1-prompt" data-question="readme-1" data-kind="choice">/);
  assert.match(html, /<span class="cq-source" title="Source">handoff<\/span>/);
  assert.match(html, /<li class="cq-option" data-option="1">Cosine similarity<\/li>/);
  assert.match(html, /data-question="rrf" data-kind="free"/);
  assert.match(html, /data-question="readme-3"/, "a duplicate explicit id falls back to its position");
  assert.deepEqual(warnings, ['Duplicate question id "rrf"']);
  assert.deepEqual(questions.map((q) => [q.id, q.kind, q.answerIndex]), [["readme-1", "choice", 0], ["rrf", "free", undefined], ["readme-3", "choice", 0]]);
  assert.match(questions[0].explanationHtml, /EXPLANATION-SECRET/);
  assert.match(questions[1].answerHtml, /MODEL-ANSWER-SECRET/);
  // Outside a step (course pages, support text) nothing is collected and the block is inert.
  const page = await render(fence(MC), { stepId: null });
  assert.deepEqual(page.questions, []);
  assert.match(page.html, /data-inactive="true"/);
  assert.match(page.html, /answered inside a step/);
  assert.doesNotMatch(page.html, SECRETS);
});

test("an invalid block renders a visible author warning without its source, never a crash", async () => {
  const { html, questions, warnings } = await render("Before\n\n" + fence("prompt: p\nanswer: SECRET-ANSWER-OF-BROKEN") + "\nAfter\n");
  assert.match(html, /class="callout callout-warning question-invalid"/);
  assert.match(html, /Check question 1 is invalid/);
  assert.match(html, /explanation is required/);
  assert.doesNotMatch(html, /SECRET-ANSWER-OF-BROKEN/);
  assert.match(html, /<p>After<\/p>/);
  assert.deepEqual(questions, []);
  assert.deepEqual(warnings, ["Invalid check question 1"]);
  // Too many blocks in one document: the extra ones become warnings.
  const many = await render(Array.from({ length: QUESTION_LIMITS.perDocument + 2 }, () => fence(MC)).join("\n"));
  assert.equal(many.questions.length, QUESTION_LIMITS.perDocument);
  assert.equal((many.html.match(/question-invalid/g) || []).length, 2);
});

test("hostile: XSS in prompt, options, explanation and answer goes through the sanitiser and URL policy", async () => {
  const xss = `prompt: |
  Pick <script>window.x=1</script><img src=x onerror=alert(1)> [js](javascript:alert(1)) <a href="data:text/html,x">d</a>
  <iframe src="javascript:alert(1)"></iframe><svg onload=alert(1)></svg><b onclick="alert(1)">bold</b>
options:
  - "<img src=x onerror=alert(2)>one"
  - "[two](javascript:alert(3)) <style>*{}</style>"
  - "</li></ol><script>alert(4)</script>"
answer: 0
explanation: |
  <script>alert(5)</script><a href="vbscript:x">v</a> <form action=/api/progress><button>x</button></form>

  See [ok](https://example.com).
  \`\`\`js
  const safe = "<script>";
  \`\`\``;
  const { html, questions } = await render(fence(xss));
  const all = html + questions[0].explanationHtml;
  for (const bad of [/<script/i, /onerror/i, /onclick/i, /onload/i, /javascript:/i, /vbscript:/i, /data:text/i, /<iframe/i, /<svg/i, /<style/i, /<form/i, /<button/i])
    assert.doesNotMatch(all, bad, String(bad));
  assert.match(html, /<b>bold<\/b>/);
  assert.equal((html.match(/<li class="cq-option"/g) || []).length, 3, "an option cannot close the list");
  assert.match(questions[0].explanationHtml, /href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer nofollow"/);
  assert.match(questions[0].explanationHtml, /class="shiki/, "code in an explanation is highlighted as text");
  // A block cannot fake an engine question: the class is not on the allowlist.
  const fake = await render('<div class="check-question" data-question="x" data-kind="choice">fake</div>');
  assert.doesNotMatch(fake.html, /check-question|data-question/);
  // Nested question fences inside a question are plain code, not questions.
  const nested = await render("````question\nprompt: |\n  ```question\n  prompt: inner\n  ```\nanswer: a\nexplanation: e\n````\n");
  assert.equal(nested.questions.length, 1);
  assert.match(nested.html, /<code>prompt: inner<\/code>|prompt: inner/);
  assert.equal((nested.html.match(/class="check-question"/g) || []).length, 1);
});

test("hostile: huge blocks and a lesson of many questions stay within limits; the fallback hides answers", async () => {
  const huge = await render(fence("prompt: p\nanswer: a\nexplanation: " + "z".repeat(QUESTION_LIMITS.blockBytes + 10)));
  assert.match(huge.html, /larger than 16 KB/);
  assert.doesNotMatch(huge.html, /zzzz/);
  // A lesson too large to render is not shown as source when it may hold questions.
  const big = fence(MC) + "x".repeat(260 * 1024);
  const fallback = await renderSafe(big, { stepId: "01" });
  assert.match(fallback.html, /larger than 256 KB/);
  assert.match(fallback.html, /check questions are not shown/);
  assert.doesNotMatch(fallback.html + fallback.text, SECRETS);
  assert.doesNotMatch(fallback.html, /lesson-source/);
  assert.deepEqual(fallback.questions, []);
  const plainBig = await renderSafe("y".repeat(260 * 1024));
  assert.match(plainBig.html, /lesson-source/, "a lesson without questions keeps its plain-text fallback");
  const started = Date.now();
  const many = await renderSafe(Array.from({ length: QUESTION_LIMITS.perDocument }, () => fence(MC)).join("\n"), { stepId: "01", docPath: "README.md" });
  assert.equal(many.questions.length, QUESTION_LIMITS.perDocument);
  assert.ok(Date.now() - started < 5000);
});

test("plain-text copies (API content, tutor, MCP) keep prompts and options but never answers", async () => {
  const stripped = (await render("Intro\n\n" + fence(MC) + fence(FREE) + fence("prompt: [broken") + "Outro")).text;
  assert.doesNotMatch(stripped, SECRETS);
  assert.match(stripped, /\*\*Check question:\*\* Which ranks by term frequency\?\n\n1\. BM25\n2\. Cosine similarity/);
  assert.match(stripped, /\*\*Check question\*\* \(invalid block, not shown\)/);
  assert.match(stripped, /^Intro[\s\S]*Outro\n?$/);
  const root = await nativeCourse({ files: { "exercises/01/README.md": "# Step\n\n" + fence(MC) + fence(FREE), "exercises/01/FINISHED.md": "# Done\n\n" + fence(MC.replace("source: handoff", "id: wrap")) } });
  const docs = await lessonDocuments(root, "01");
  assert.doesNotMatch(JSON.stringify(docs), SECRETS, "the lesson payload holds no answer");
  assert.deepEqual(docs.map((d) => d.questions), [[{ id: "readme-1", kind: "choice" }, { id: "rrf", kind: "free" }], [{ id: "wrap", kind: "choice" }]]);
  assert.doesNotMatch(await lessonText(root, "01"), SECRETS);
  const questions = await stepQuestions(root, "01");
  assert.deepEqual([...questions.keys()], ["readme-1", "rrf", "wrap"]);
  assert.equal(questions.get("wrap").document, "Exercise wrap-up");
});

test("question progress: stored with step progress, validated, cleaned on read", async () => {
  const root = await nativeCourse({ files: { "exercises/01/README.md": fence(MC) } });
  await updateQuestionProgress(root, "01", "readme-1", { status: "incorrect", choice: 1 });
  await assert.rejects(updateQuestionProgress(root, "01", "readme-2", { mark: "review" }), /before marking/);
  await updateQuestionProgress(root, "01", "readme-1", { mark: "review" });
  let saved = (await readProgress(root)).questions["01"]["readme-1"];
  assert.deepEqual([saved.status, saved.mark, saved.choice], ["incorrect", "review", 1]);
  await updateQuestionProgress(root, "01", "readme-1", { status: "correct", choice: 0 });
  saved = (await readProgress(root)).questions["01"]["readme-1"];
  assert.deepEqual([saved.status, saved.mark], ["correct", undefined], "a new check clears an old self-mark");
  for (const bad of [{ status: "great" }, { mark: "maybe" }, {}])
    await assert.rejects(updateQuestionProgress(root, "01", "readme-1", bad));
  await assert.rejects(updateQuestionProgress(root, "99", "readme-1", { status: "correct" }));
  await assert.rejects(updateQuestionProgress(root, "01", "../x", { status: "correct" }));
  assert.deepEqual(
    cleanQuestions({ "01": { ok: { status: "correct", at: "2026-11-28T00:00:00.000Z", evil: "<script>" }, "../x": { status: "correct" }, bad: { status: "pwned" } }, "99": { a: { status: "correct" } }, __proto__: { x: 1 } }, ["01"]),
    { "01": { ok: { status: "correct", at: "2026-11-28T00:00:00.000Z" } } },
  );
  // Concurrent step and question writes are serialised: none is lost.
  const { updateProgress } = await import("./course.mjs");
  await Promise.all([updateProgress(root, "01", true), updateQuestionProgress(root, "01", "readme-1", { status: "incorrect", choice: 1 }), updateProgress(root, "02", true)]);
  const all = await readProgress(root);
  assert.deepEqual([all.completed, all.questions["01"]["readme-1"].status], [["01", "02"], "incorrect"]);
});

test("workshop validate reports invalid question blocks with file and line", async () => {
  const root = await nativeCourse({
    files: {
      "exercises/01/README.md": "# Step\n\n" + fence(MC) + "\ntext\n\n" + fence("prompt: p\nanswer: 5\noptions: [a, b]\nexplanation: e") + fence("id: dup\n" + FREE.replace("id: rrf\n", "")) + fence("id: dup\n" + FREE.replace("id: rrf\n", "")),
      "exercises/README.md": "# Intro\n\n" + fence("prompt: !!js/function x"),
    },
  });
  const { problems, count } = await validateQuestions(root, ["01", "02"], [join(root, "exercises", "README.md")]);
  assert.equal(count, 5);
  assert.deepEqual(
    problems.map((p) => `${p.file}:${p.line}`),
    ["exercises/01/README.md:15", "exercises/01/README.md:28", "exercises/README.md:3"],
  );
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../cli/bin.mjs", import.meta.url)), "validate", "--content", root], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /exercises\/01\/README\.md:15: invalid check question: answer 5 is not an option index/);
  assert.match(cli.stderr, /exercises\/01\/README\.md:28: invalid check question: duplicate question id "dup" \(first on line 21\)/);
  assert.match(cli.stderr, /exercises\/README\.md:3: invalid check question: YAML tags/);
  await writeTree(root, { "exercises/01/README.md": "# Step\n\n" + fence(MC), "exercises/README.md": "# Intro\n" });
  const ok = spawnSync(process.execPath, [fileURLToPath(new URL("../cli/bin.mjs", import.meta.url)), "validate", "--content", root], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 check questions\)/);
});
