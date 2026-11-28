import { readFile, stat } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { stepLayout } from "../core/layout.mjs";
import { renderCached } from "./markdown.mjs";
import { assertSafePath } from "./files.mjs";
import { stripQuestionAnswers, questionProblems } from "./questions.mjs";
import { readFile as readText } from "node:fs/promises";

const posixRel = (root, path) => relative(root, path).replaceAll("\\", "/");
/**
 * Render one course document (Stage 3). `stepId` is null on course pages,
 * where diff links become inactive instead of failing.
 */
export async function renderDocument(root, path, { stepId = null, sandboxOrigin = "", docPath } = {}) {
  await assertSafePath(path);
  const info = await stat(path);
  if (!info.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
  const source = await readFile(path, "utf8");
  const rel = posixRel(root, path);
  const key = [root, rel, info.mtimeMs, info.size, stepId, sandboxOrigin, docPath ?? rel].join("|");
  const rendered = await renderCached(key, source, {
    mdx: path.endsWith(".mdx"),
    stepId,
    docPath: docPath ?? rel,
    docDir: dirname(rel) === "." ? "" : dirname(rel),
    sandboxOrigin,
  });
  return { source, path: rel, ...rendered };
}

// Render the course's declarative MDX subset without evaluating arbitrary JSX/JS.
// Check questions keep their prompt and options only (never the answer).
export function lessonMarkdown(source) {
  const blocks = stripQuestionAnswers(source).split(/(```[\s\S]*?```)/g);
  return blocks
    .map((block, index) =>
      index % 2
        ? block
        : block
            .replace(
              /<EpicVideo\s+url="([^"]+)"\s*\/>/g,
              (_, url) =>
                `[Watch the original lesson video (authorised access may be required)](${url})`,
            )
            .replace(
              /<InlineFile\s+file="([^"]+)"\s*\/>/g,
              (_, file) => `[${file}](#file=${encodeURIComponent(file)})`,
            )
            .replace(
              /<InlineFile\s+file="([^"]+)"[^>]*>([\s\S]*?)<\/InlineFile>/g,
              (_, file, label) =>
                `[${label}](#file=${encodeURIComponent(file)})`,
            )
            .replace(
              /<(?:NextDiffLink|PrevDiffLink|DiffLink)[^>]*>([\s\S]*?)<\/(?:NextDiffLink|PrevDiffLink|DiffLink)>/g,
              "[$1](#comparison)",
            )
            .replace(/<summary>([\s\S]*?)<\/summary>/g, "\n### $1\n")
            .replace(/<\/?(?:details|callout-[\w-]+)[^>]*>/g, "\n")
            .replace(/\{['"] ['"]\}/g, " "),
    )
    .join("");
}
function lessonCandidates(root, layout) {
  return layout.epic
    ? [
        ["Course introduction", join(root, "exercises", "README.mdx")],
        ["Exercise introduction", join(layout.base, "README.mdx")],
        ["Problem lesson", join(layout.problem, "README.mdx")],
        ["Solution explanation", join(layout.solution, "README.mdx")],
        ["Exercise wrap-up", join(layout.base, "FINISHED.mdx")],
        ["Course wrap-up", join(root, "exercises", "FINISHED.mdx")],
      ]
    : [
        ["Lesson", join(layout.base, "README.md")],
        ["Exercise wrap-up", join(layout.base, "FINISHED.md")],
      ];
}
// Question ids derive from the document's path inside the step (README-1),
// or from the course path for shared documents outside it.
function questionDocPath(root, layout, path) {
  const inside = relative(layout.base, path).replaceAll("\\", "/");
  return inside === ".." || inside.startsWith("../") || /^[a-z]:/i.test(inside) ? posixRel(root, path) : inside;
}
/** Every document of a step that exists, rendered (cached), with its questions. */
async function stepDocuments(root, id, { sandboxOrigin = "" } = {}) {
  const layout = stepLayout(root, id);
  const out = [];
  for (const [title, path] of lessonCandidates(root, layout)) {
    try {
      out.push({ title, doc: await renderDocument(root, path, { stepId: id, sandboxOrigin, docPath: questionDocPath(root, layout, path) }) });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return out;
}
export async function lessonDocuments(root, id, { sandboxOrigin = "" } = {}) {
  const documents = [];
  for (const { title, doc } of await stepDocuments(root, id, { sandboxOrigin }))
    documents.push({
        title,
        path: doc.path,
        content: lessonMarkdown(doc.source),
        html: doc.html,
        toc: doc.toc,
        warnings: doc.warnings,
        // Public question metadata only: no answers or explanations.
        questions: doc.questions.map((q) => ({ id: q.id, kind: q.kind })),
      });
  return documents;
}
/**
 * The step's check questions with their answers (server-side only: used by
 * the check/reveal routes, never sent with a lesson). The first document
 * wins when two documents of a step use the same explicit id.
 */
export async function stepQuestions(root, id, { sandboxOrigin = "" } = {}) {
  const questions = new Map();
  for (const { title, doc } of await stepDocuments(root, id, { sandboxOrigin }))
    for (const q of doc.questions) if (!questions.has(q.id)) questions.set(q.id, { ...q, document: title });
  return questions;
}
export async function lessonText(root, id) {
  const docs = await lessonDocuments(root, id);
  return (
    (docs.find((d) => d.title === "Problem lesson") || docs[0])?.content || ""
  );
}
/**
 * Check-question problems in every lesson document of the given steps and in
 * the extra (course page) documents, as {file, line, message} with the file
 * relative to the course root (for `workshop validate`).
 */
export async function validateQuestions(root, ids, extraPaths = []) {
  const paths = new Set();
  for (const id of ids) for (const [, path] of lessonCandidates(root, stepLayout(root, id))) paths.add(path);
  for (const path of extraPaths) paths.add(path);
  const problems = [];
  let count = 0;
  for (const path of paths) {
    let source;
    try {
      source = await readText(await assertSafePath(path), "utf8");
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    const result = questionProblems(source, posixRel(root, path));
    count += result.count;
    problems.push(...result.problems);
  }
  return { count, problems };
}
