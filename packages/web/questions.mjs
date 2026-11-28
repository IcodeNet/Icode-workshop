// Check questions: the `question` fenced block.
// Finding blocks is the renderer's job (markdown.mjs, analyzeQuestions): one
// Markdown parse is the single source of truth. This module parses one body.
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
/** True when a fence info string declares a question block. */
export const isQuestionInfo = (info) => String(info ?? "").trim().split(/\s+/)[0].toLowerCase() === "question";

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
