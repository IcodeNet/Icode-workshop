// Check questions (Stage 5 A6, pulled forward): the `question` fenced block.
// Course content is untrusted, so the YAML inside a block is parsed with the
// core schema only (no custom or explicit tags, no anchors or aliases), with
// size, depth and count limits, and is never evaluated. See
// docs/check-questions.md.
import { parseAllDocuments, visit, isMap, isSeq, isScalar, isAlias } from "yaml";

export const QUESTION_LIMITS = {
  blockBytes: 16 * 1024,
  perDocument: 30,
  depth: 3,
  promptChars: 4000,
  optionChars: 500,
  minOptions: 2,
  maxOptions: 10,
  explanationChars: 8000,
  answerChars: 8000,
  sourceChars: 40,
  attemptChars: 5000,
};
export const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const KEYS = new Set(["id", "prompt", "options", "answer", "explanation", "source"]);
// Any indentation and blockquote prefix: over-detecting is safe (a block is
// stripped from plain-text copies or reported), missing one is not.
const FENCE = /^((?:\s*>)*\s*)(`{3,}|~{3,})(.*)$/;

/** True when a fence info string declares a question block. */
export const isQuestionInfo = (info) => String(info ?? "").trim().split(/\s+/)[0].toLowerCase() === "question";

/**
 * Question fences in a Markdown/MDX source, in document order, with the
 * 1-based line of the opening fence. Uses the same fence rules as the lesson
 * preprocessor (an unclosed fence runs to the end of the document).
 */
export function findQuestionBlocks(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE);
    if (fence) {
      if (m && m[2][0] === fence.marker[0] && m[2].length >= fence.marker.length && !m[3].trim()) {
        if (fence.question) blocks.push({ line: fence.line, endLine: i + 1, body: fence.body.join("\n") });
        fence = null;
      } else fence.body.push(fence.quoted ? lines[i].replace(/^(?:\s*>)+ ?/, "") : lines[i].replace(new RegExp("^ {0," + fence.indent + "}"), ""));
      continue;
    }
    if (m && !(m[2][0] === "`" && m[3].includes("`")))
      fence = { marker: m[2], line: i + 1, question: isQuestionInfo(m[3]), body: [], quoted: m[1].includes(">"), indent: m[1].length };
  }
  if (fence?.question) blocks.push({ line: fence.line, endLine: lines.length, body: fence.body.join("\n"), unclosed: true });
  return blocks;
}

function depthOf(node, depth = 0) {
  if (depth > QUESTION_LIMITS.depth + 1) return depth;
  if (isMap(node) || isSeq(node)) {
    let max = depth + 1;
    for (const item of node.items) {
      const value = isMap(node) ? item.value : item;
      max = Math.max(max, depthOf(value, depth + 1));
      if (isMap(node) && item.key && !isScalar(item.key)) max = QUESTION_LIMITS.depth + 2;
    }
    return max;
  }
  return depth;
}

const text = (v) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

/**
 * Parse and validate one question block body.
 * @returns {{ok: true, question: {id?: string, prompt: string, options?: string[], answer: string|number, answerIndex?: number, explanation: string, source?: string, kind: "choice"|"free"}} | {ok: false, errors: string[]}}
 */
export function parseQuestion(body) {
  const errors = [];
  const fail = (...e) => ({ ok: false, errors: [...errors, ...e] });
  if (typeof body !== "string") return fail("The question block is empty.");
  if (Buffer.byteLength(body) > QUESTION_LIMITS.blockBytes) return fail(`The question block is larger than ${QUESTION_LIMITS.blockBytes / 1024} KB.`);
  if (!body.trim()) return fail("The question block is empty.");
  let docs;
  try {
    docs = parseAllDocuments(body, { schema: "core", uniqueKeys: true, prettyErrors: false, strict: true, merge: false, version: "1.2" });
  } catch (error) {
    return fail("The question block is not valid YAML: " + String(error.message).slice(0, 200));
  }
  if (!Array.isArray(docs)) docs = [docs];
  if (docs.length !== 1) return fail("A question block must contain exactly one YAML document.");
  const doc = docs[0];
  if (doc.errors.length) return fail("The question block is not valid YAML: " + String(doc.errors[0].message).split("\n")[0].slice(0, 200));
  let unsafe = null;
  visit(doc, {
    Alias() {
      unsafe ??= "YAML aliases (*name) are not allowed in question blocks.";
      return visit.BREAK;
    },
    Node(_, node) {
      if (node.anchor) unsafe ??= "YAML anchors (&name) are not allowed in question blocks.";
      else if (node.tag) unsafe ??= "YAML tags (" + String(node.tag).slice(0, 40) + ") are not allowed in question blocks.";
      if (unsafe) return visit.BREAK;
    },
  });
  if (unsafe) return fail(unsafe);
  if (!isMap(doc.contents)) return fail("A question block must be a YAML mapping with prompt, answer and explanation.");
  if (depthOf(doc.contents) > QUESTION_LIMITS.depth) return fail("The question block is nested too deeply.");
  let data;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    return fail("The question block could not be read: " + String(error.message).slice(0, 200));
  }
  for (const key of Object.keys(data)) if (!KEYS.has(key)) errors.push(`Unknown field "${String(key).slice(0, 40)}" (allowed: ${[...KEYS].join(", ")}).`);
  const q = {};
  if (data.id !== undefined && data.id !== null) {
    const id = text(data.id);
    if (!id || !QUESTION_ID.test(id)) errors.push("id must be 1–80 letters, digits, - or _, starting with a letter or digit.");
    else q.id = id;
  }
  const prompt = text(data.prompt);
  if (!prompt || !prompt.trim()) errors.push("prompt is required (Markdown text).");
  else if (prompt.length > QUESTION_LIMITS.promptChars) errors.push(`prompt is longer than ${QUESTION_LIMITS.promptChars} characters.`);
  else q.prompt = prompt;
  const explanation = text(data.explanation);
  if (!explanation || !explanation.trim()) errors.push("explanation is required: say why the answer is right.");
  else if (explanation.length > QUESTION_LIMITS.explanationChars) errors.push(`explanation is longer than ${QUESTION_LIMITS.explanationChars} characters.`);
  else q.explanation = explanation;
  if (data.source !== undefined && data.source !== null) {
    const source = text(data.source);
    if (!source || !source.trim() || source.length > QUESTION_LIMITS.sourceChars || /[\r\n]/.test(source)) errors.push(`source must be a short label (up to ${QUESTION_LIMITS.sourceChars} characters).`);
    else q.source = source.trim();
  }
  if (data.answer === undefined || data.answer === null || (typeof data.answer === "string" && !data.answer.trim()))
    errors.push("answer is required: an option index or text for multiple choice, otherwise a model answer.");
  if (data.options !== undefined && data.options !== null) {
    if (!Array.isArray(data.options)) errors.push("options must be a list of strings.");
    else {
      const options = data.options.map(text);
      if (options.some((o) => o === null || !o.trim())) errors.push("Every option must be non-empty text.");
      else if (options.length < QUESTION_LIMITS.minOptions || options.length > QUESTION_LIMITS.maxOptions)
        errors.push(`options must have ${QUESTION_LIMITS.minOptions}–${QUESTION_LIMITS.maxOptions} entries.`);
      else if (options.some((o) => o.length > QUESTION_LIMITS.optionChars)) errors.push(`Each option must be at most ${QUESTION_LIMITS.optionChars} characters.`);
      else if (new Set(options.map((o) => o.trim())).size !== options.length) errors.push("options must be distinct.");
      else {
        q.options = options;
        q.kind = "choice";
        if (data.answer !== undefined && data.answer !== null) {
          if (typeof data.answer === "number") {
            if (Number.isInteger(data.answer) && data.answer >= 0 && data.answer < options.length) q.answerIndex = data.answer;
            else errors.push(`answer ${data.answer} is not an option index (0 to ${options.length - 1}; the first option is 0).`);
          } else if (typeof data.answer === "string") {
            const index = options.findIndex((o) => o.trim() === data.answer.trim());
            if (index >= 0) q.answerIndex = index;
            else errors.push("answer must be the 0-based index or the exact text of one option.");
          } else errors.push("answer must be the 0-based index or the exact text of one option.");
        }
      }
    }
  } else if (data.answer !== undefined && data.answer !== null) {
    const answer = text(data.answer);
    if (answer === null || typeof data.answer === "object") errors.push("answer must be Markdown text (the model answer) when there are no options.");
    else if (answer.length > QUESTION_LIMITS.answerChars) errors.push(`answer is longer than ${QUESTION_LIMITS.answerChars} characters.`);
    else {
      q.kind = "free";
      q.answer = answer;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, question: q };
}

/** Stable question id from the document path and the block's position. */
export function derivedQuestionId(docPath, position) {
  const slug = String(docPath || "lesson")
    .replace(/\.(mdx?|markdown)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug.slice(-60).replace(/^-+/, "") || "lesson") + "-" + position;
}

/**
 * Assign ids to the blocks of one document: explicit ids win, duplicates are
 * reported and get a positional id instead.
 */
export function assignIds(parsed, docPath) {
  const used = new Set();
  const warnings = [];
  const ids = parsed.map((p, i) => {
    let id = p.ok && p.question.id ? p.question.id : derivedQuestionId(docPath, i + 1);
    if (used.has(id)) {
      warnings.push(`Duplicate question id "${id}"`);
      id = derivedQuestionId(docPath, i + 1);
      while (used.has(id)) id += "-dup";
    }
    used.add(id);
    return id;
  });
  return { ids, warnings };
}

/**
 * Replace question blocks with their prompt and options only, for the plain
 * text copies of a lesson (tutor, MCP read_lesson, API `content`): those must
 * never contain an answer or explanation.
 */
export function stripQuestionAnswers(source) {
  const blocks = findQuestionBlocks(source);
  if (!blocks.length) return source;
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let cursor = 0;
  for (const block of blocks) {
    out.push(...lines.slice(cursor, block.line - 1));
    const parsed = parseQuestion(block.body);
    if (parsed.ok) {
      out.push("**Check question:** " + parsed.question.prompt.trim());
      if (parsed.question.options) out.push("", ...parsed.question.options.map((o, i) => `${i + 1}. ${o.replace(/\s+/g, " ").trim()}`));
    } else out.push("**Check question** (invalid block, not shown)");
    cursor = block.endLine;
  }
  out.push(...lines.slice(cursor));
  return out.join("\n");
}

/**
 * Validation problems for every question block in a document, with 1-based
 * line numbers (for `workshop validate`).
 */
export function questionProblems(source, file) {
  const blocks = findQuestionBlocks(source);
  const problems = [];
  if (blocks.length > QUESTION_LIMITS.perDocument)
    problems.push({ file, line: blocks[QUESTION_LIMITS.perDocument].line, message: `more than ${QUESTION_LIMITS.perDocument} question blocks in one document` });
  const parsed = blocks.map((b) => parseQuestion(b.body));
  parsed.forEach((p, i) => {
    if (blocks[i].unclosed) problems.push({ file, line: blocks[i].line, message: "question block is not closed" });
    if (!p.ok) for (const message of p.errors) problems.push({ file, line: blocks[i].line, message });
  });
  const seen = new Map();
  parsed.forEach((p, i) => {
    if (!p.ok || !p.question.id) return;
    if (seen.has(p.question.id)) problems.push({ file, line: blocks[i].line, message: `duplicate question id "${p.question.id}" (first on line ${seen.get(p.question.id)})` });
    else seen.set(p.question.id, blocks[i].line);
  });
  return { count: blocks.length, problems };
}
