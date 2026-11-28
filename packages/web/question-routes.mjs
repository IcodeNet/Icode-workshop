// Check-question routes (docs/check-questions.md). Called by server.mjs after
// its Host/Origin/Fetch Metadata and session-token checks. Answers and
// explanations leave the server only here, after an attempt.
import { validateId } from "../core/index.mjs";
import { stepQuestions } from "./lessons.mjs";
import { courseConfig, readProgress, updateQuestionProgress } from "./course.mjs";
import { QUESTION_ID, QUESTION_LIMITS } from "./questions.mjs";

/** Paths that only touch progress (serialised on their own queue). */
export const QUESTION_ROUTES = new Set(["/api/questions/check", "/api/questions/reveal", "/api/questions/mark"]);

async function find(root, sandboxOrigin, id, question, kind) {
  validateId(id);
  if (typeof question !== "string" || !QUESTION_ID.test(question)) throw new Error("Unknown check question");
  if (!(await courseConfig(root)).ids.includes(id)) throw new Error("Unknown exercise");
  const q = (await stepQuestions(root, id, { sandboxOrigin })).get(question);
  if (!q || (kind && q.kind !== kind)) throw Object.assign(new Error("Unknown check question"), { status: 404 });
  return q;
}
const needsReview = (entry) => entry.mark === "review" || (entry.status === "incorrect" && entry.mark !== "got-it");

export async function handleQuestions({ req, res, url, root, json, readBody, sandboxOrigin }) {
  const path = url.pathname;
  try {
    if (path === "/api/questions" && req.method === "GET") {
      const id = url.searchParams.get("id");
      validateId(id);
      const questions = [...(await stepQuestions(root, id, { sandboxOrigin })).values()].map((q) => ({ id: q.id, kind: q.kind, document: q.document }));
      const saved = (await readProgress(root)).questions[id] || {};
      return json(res, 200, { id, questions, progress: Object.fromEntries(questions.filter((q) => saved[q.id]).map((q) => [q.id, saved[q.id]])) }), true;
    }
    if (path === "/api/questions/review" && req.method === "GET") {
      const { ids } = await courseConfig(root);
      const progress = (await readProgress(root)).questions;
      const items = [];
      for (const id of ids) {
        const saved = progress[id];
        if (!saved || !Object.values(saved).some(needsReview)) continue;
        const questions = await stepQuestions(root, id, { sandboxOrigin });
        for (const [qid, entry] of Object.entries(saved)) {
          const q = questions.get(qid);
          if (q && needsReview(entry)) items.push({ step: id, id: qid, kind: q.kind, prompt: q.promptText, status: entry.status, ...(entry.mark ? { mark: entry.mark } : {}) });
        }
      }
      return json(res, 200, { items }), true;
    }
    if (path === "/api/questions/check" && req.method === "POST") {
      const { id, question, choice } = await readBody(req);
      const q = await find(root, sandboxOrigin, id, question, "choice");
      if (!Number.isInteger(choice) || choice < 0 || choice >= q.options) throw new Error("Choose one of the options first");
      const correct = choice === q.answerIndex;
      const data = await updateQuestionProgress(root, id, question, { status: correct ? "correct" : "incorrect", choice });
      return json(res, 200, { correct, answerIndex: q.answerIndex, explanationHtml: q.explanationHtml, progress: data.questions[id][question] }), true;
    }
    if (path === "/api/questions/reveal" && req.method === "POST") {
      const { id, question, attempt } = await readBody(req);
      const q = await find(root, sandboxOrigin, id, question, "free");
      // The model answer is shown only after an attempt.
      if (typeof attempt !== "string" || !attempt.trim()) throw new Error("Write your answer before revealing the model answer");
      if (attempt.length > QUESTION_LIMITS.attemptChars) throw new Error("Your answer is too long");
      const data = await updateQuestionProgress(root, id, question, { status: "revealed" });
      return json(res, 200, { answerHtml: q.answerHtml, explanationHtml: q.explanationHtml, progress: data.questions[id][question] }), true;
    }
    if (path === "/api/questions/mark" && req.method === "POST") {
      const { id, question, mark } = await readBody(req);
      await find(root, sandboxOrigin, id, question);
      const data = await updateQuestionProgress(root, id, question, { mark });
      return json(res, 200, { progress: data.questions[id][question] }), true;
    }
  } catch (error) {
    if (error.status === 404) return json(res, 404, { error: error.message }), true;
    throw error;
  }
  return false;
}
