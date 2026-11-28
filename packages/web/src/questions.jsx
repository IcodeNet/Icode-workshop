// Check questions in lessons (docs/check-questions.md). The server renders
// each question block as sanitised, static HTML (prompt and options only);
// this module hydrates it into an interactive block. Answers and explanations
// are fetched only after an attempt (Check / Reveal). Progress is kept on the
// server (progress.json) and mirrored in localStorage, with no login.
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

// ---------- progress store (server copy plus local copy) ----------
const listeners = new Set();
let storageKey = "icode-questions";
let server = {};
let local = {};
let snapshot = {};
let pendingFocus = null;
const newer = (a, b) => (!a ? b : !b ? a : Date.parse(b.at || 0) > Date.parse(a.at || 0) ? b : a);
function recompute() {
  const out = {};
  for (const step of new Set([...Object.keys(server), ...Object.keys(local)])) {
    out[step] = {};
    for (const qid of new Set([...Object.keys(server[step] || {}), ...Object.keys(local[step] || {})])) {
      const l = local[step]?.[qid];
      const entry = newer(server[step]?.[qid], l && l.status ? l : null);
      if (entry || l?.attempt) out[step][qid] = { ...(entry || {}), ...(l?.attempt ? { attempt: l.attempt } : {}) };
    }
  }
  snapshot = out;
  listeners.forEach((fn) => fn());
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(local));
  } catch {}
}
function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
    local = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    local = {};
  }
}
loadLocal();
recompute();
let serverLoaded = false;
function resendUnsynced() {
  if (!serverLoaded) return;
  for (const [step, entries] of Object.entries(local))
    for (const [qid, entry] of Object.entries(entries || {}))
      if (entry?.mark && entry.unsynced && server[step]?.[qid]) postMark(step, qid, entry.mark).catch(() => {});
}
const patchLocal = (step, qid, patch) => {
  local = { ...local, [step]: { ...(local[step] || {}), [qid]: { ...(local[step]?.[qid] || {}), ...patch } } };
  persist();
  recompute();
};
export const questionStore = {
  /** One local copy per course: the UI origin is shared by every course. */
  configure(courseKey) {
    const key = "icode-questions:" + String(courseKey || "course").slice(0, 200);
    if (key === storageKey) return;
    storageKey = key;
    loadLocal();
    recompute();
    resendUnsynced();
  },
  /** Server copy from GET /api/progress; re-sends self-marks saved only locally. */
  fromServer(questions) {
    server = questions && typeof questions === "object" ? questions : {};
    serverLoaded = true;
    recompute();
    resendUnsynced();
  },
  record(step, qid, entry) {
    server = { ...server, [step]: { ...(server[step] || {}), [qid]: entry } };
    patchLocal(step, qid, { ...entry, unsynced: undefined });
  },
  markLocal(step, qid, status, mark) {
    patchLocal(step, qid, { status, mark, at: new Date().toISOString(), unsynced: true });
  },
  saveAttempt(step, qid, attempt) {
    patchLocal(step, qid, { attempt: attempt.slice(0, 5000) });
  },
  get: () => snapshot,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  focusLater(step, qid) {
    pendingFocus = { step, qid };
  },
  takeFocus(step) {
    if (pendingFocus?.step !== step) return null;
    const qid = pendingFocus.qid;
    pendingFocus = null;
    return qid;
  },
};
export const useQuestionProgress = () => useSyncExternalStore(questionStore.subscribe, questionStore.get);

async function post(path, body) {
  const response = await fetch("/api/questions/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function postMark(step, qid, mark) {
  const data = await post("mark", { id: step, question: qid, mark });
  questionStore.record(step, qid, data.progress);
  return data;
}
export const needsReview = (entry) => Boolean(entry && (entry.mark === "review" || (entry.status === "incorrect" && entry.mark !== "got-it")));
export const isChecked = (entry) => Boolean(entry?.status);

// ---------- one question ----------
const Html = ({ html, className, id }) => <div className={className} id={id} dangerouslySetInnerHTML={{ __html: html }} />;
const letter = (i) => String.fromCharCode(65 + i);

function SelfMark({ entry, onMark, busy }) {
  return (
    <div className="cq-selfmark" role="group" aria-label="Mark your answer">
      <span>How did you do?</span>
      <button type="button" aria-pressed={entry?.mark === "got-it"} disabled={busy} onClick={() => onMark("got-it")}>
        Got it
      </button>
      <button type="button" aria-pressed={entry?.mark === "review"} disabled={busy} onClick={() => onMark("review")}>
        Review again
      </button>
    </div>
  );
}

export function Question({ step, qid, kind, promptHtml, options, source }) {
  const uid = useId();
  const progress = useQuestionProgress();
  const entry = progress[step]?.[qid];
  const [choice, setChoice] = useState(entry?.choice ?? null);
  const [attempt, setAttempt] = useState(entry?.attempt ?? "");
  const [result, setResult] = useState(null); // check or reveal response
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const after = useRef(null);
  const promptId = uid + "-prompt";
  useEffect(() => {
    if (result && after.current) after.current.focus();
  }, [result]);
  // Progress can arrive after the lesson: restore the last choice and attempt once.
  useEffect(() => {
    if (!result && choice === null && Number.isInteger(entry?.choice)) setChoice(entry.choice);
  }, [entry?.choice]);
  useEffect(() => {
    if (!attempt && entry?.attempt) setAttempt(entry.attempt);
  }, [entry?.attempt]);
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      setAnnounce(e.message);
    } finally {
      setBusy(false);
    }
  }
  const check = () =>
    run(async () => {
      const data = await post("check", { id: step, question: qid, choice });
      questionStore.record(step, qid, data.progress);
      setResult(data);
      setAnnounce(data.correct ? "Correct." : `Not quite. The correct answer is ${letter(data.answerIndex)}.`);
    });
  const reveal = () =>
    run(async () => {
      questionStore.saveAttempt(step, qid, attempt);
      const data = await post("reveal", { id: step, question: qid, attempt });
      questionStore.record(step, qid, data.progress);
      setResult(data);
      setAnnounce("Model answer shown. Compare it with yours, then mark how you did.");
    });
  const mark = (value) =>
    run(async () => {
      questionStore.saveAttempt(step, qid, attempt);
      try {
        await postMark(step, qid, value);
        setAnnounce(value === "got-it" ? "Marked as got it." : "Added to your review list.");
      } catch (e) {
        // Keep the mark on this device; it is sent again on the next load.
        if (entry?.status) questionStore.markLocal(step, qid, entry.status, value);
        throw new Error("Saved on this device only (" + e.message + ").");
      }
    });
  const tryAgain = () => {
    setResult(null);
    setChoice(null);
    setAnnounce("");
  };
  const status =
    entry?.status === "correct" ? "Correct" : entry?.status === "incorrect" ? "Incorrect" : entry?.status === "revealed" ? "Answer revealed" : "Not attempted";
  return (
    <>
      <div className="cq-head">
        <span className="cq-label">Check question</span>
        {source && <span className="cq-source">Source: {source}</span>}
        <span className={"cq-status cq-status-" + (entry?.status || "new")}>
          {status}
          {entry?.mark === "got-it" ? " · Got it" : entry?.mark === "review" ? " · Review again" : ""}
        </span>
      </div>
      <Html className="cq-prompt" id={promptId} html={promptHtml} />
      {kind === "choice" ? (
        <>
          <div className="cq-choices" role="radiogroup" aria-labelledby={promptId}>
            {options.map((html, i) => {
              const state = result ? (i === result.answerIndex ? "correct" : i === choice ? "incorrect" : "") : "";
              return (
                <label key={i} className={"cq-choice" + (state ? " cq-" + state : "") + (choice === i ? " cq-selected" : "")}>
                  <input type="radio" name={uid} value={i} checked={choice === i} disabled={Boolean(result) || busy} onChange={() => setChoice(i)} />
                  <span className="cq-letter" aria-hidden="true">
                    {letter(i)}
                  </span>
                  <span className="cq-option-text" dangerouslySetInnerHTML={{ __html: html }} />
                  {state === "correct" && <span className="cq-tag">Correct answer</span>}
                  {state === "incorrect" && <span className="cq-tag">Your answer</span>}
                </label>
              );
            })}
          </div>
          <div className="cq-actions">
            {result ? (
              <button type="button" ref={after} onClick={tryAgain}>
                Try again
              </button>
            ) : (
              <button type="button" className="cq-primary" disabled={choice === null || busy} onClick={check}>
                Check
              </button>
            )}
            {!result && entry?.status && <span className="cq-hint">Last check: {entry.status === "correct" ? "correct" : "incorrect"}. Choose and check again to see the explanation.</span>}
          </div>
        </>
      ) : (
        <>
          <label className="cq-attempt-label" htmlFor={uid + "-attempt"}>
            Your answer
          </label>
          <textarea
            id={uid + "-attempt"}
            className="cq-attempt"
            rows={4}
            maxLength={5000}
            value={attempt}
            disabled={busy}
            onChange={(e) => setAttempt(e.target.value)}
            onBlur={() => attempt && questionStore.saveAttempt(step, qid, attempt)}
          />
          <div className="cq-actions">
            {!result && (
              <button type="button" className="cq-primary" disabled={!attempt.trim() || busy} onClick={reveal}>
                {entry?.status === "revealed" ? "Reveal again" : "Reveal answer"}
              </button>
            )}
            {!result && !attempt.trim() && <span className="cq-hint">Write an answer first: the model answer is revealed after your attempt.</span>}
          </div>
        </>
      )}
      <div className="cq-live" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      {error && <p className="cq-error">{error}</p>}
      {result && (
        <div className={"cq-feedback" + (kind === "choice" ? (result.correct ? " cq-feedback-correct" : " cq-feedback-incorrect") : "")} ref={kind === "free" ? after : undefined} tabIndex={kind === "free" ? -1 : undefined}>
          {kind === "choice" && <p className="cq-verdict">{result.correct ? "Correct." : `Not quite. The correct answer is ${letter(result.answerIndex)}.`}</p>}
          {kind === "free" && (
            <section className="cq-answer" aria-label="Model answer">
              <strong>Model answer</strong>
              <Html html={result.answerHtml} />
            </section>
          )}
          <section className="cq-explanation" aria-label="Explanation">
            <strong>Why</strong>
            <Html html={result.explanationHtml} />
          </section>
        </div>
      )}
      {kind === "free" && (result || entry?.status === "revealed") && <SelfMark entry={entry} busy={busy} onMark={mark} />}
    </>
  );
}

/**
 * Hydrate the server-rendered question blocks inside `container` for step
 * `step`. Returns a cleanup function. Blocks on course pages (no step) stay
 * static.
 */
export function mountQuestions(container, step) {
  if (!step) return () => {};
  const roots = [];
  for (const block of container.querySelectorAll(".check-question[data-question]:not([data-inactive])")) {
    if (block.dataset.hydrated) continue;
    const qid = block.dataset.question;
    const kind = block.dataset.kind === "free" ? "free" : "choice";
    const promptHtml = block.querySelector(".cq-prompt")?.innerHTML ?? "";
    const options = [...block.querySelectorAll(".cq-option")].map((li) => li.innerHTML);
    const source = block.querySelector(".cq-source")?.textContent || "";
    const staticNodes = [...block.childNodes];
    staticNodes.forEach((n) => n.remove());
    const host = document.createElement("div");
    host.className = "cq-body";
    block.append(host);
    block.dataset.hydrated = "true";
    block.tabIndex = -1;
    const root = createRoot(host);
    root.render(<Question step={step} qid={qid} kind={kind} promptHtml={promptHtml} options={options} source={source} />);
    roots.push({ root, block, host, staticNodes });
  }
  const focus = questionStore.takeFocus(step);
  if (focus) {
    const target = container.querySelector(`.check-question[data-question="${CSS.escape(focus)}"]`);
    if (target)
      requestAnimationFrame(() => {
        target.closest("details")?.setAttribute("open", "");
        target.scrollIntoView({ block: "center" });
        target.focus({ preventScroll: true });
      });
  }
  return () => {
    for (const { root, block, host, staticNodes } of roots) {
      // Unmount after React finishes the current render.
      queueMicrotask(() => root.unmount());
      host.remove();
      block.append(...staticNodes);
      delete block.dataset.hydrated;
    }
  };
}

// ---------- per-step summary and the review list ----------
export function QuestionSummary({ step, questions }) {
  const progress = useQuestionProgress();
  if (!questions?.length) return null;
  const saved = progress[step] || {};
  const checked = questions.filter((q) => isChecked(saved[q.id])).length;
  const review = questions.filter((q) => needsReview(saved[q.id])).length;
  return (
    <p className="cq-summary">
      <span className="cq-summary-count">
        Check questions: {checked}/{questions.length} checked
      </span>
      {review > 0 && <span className="cq-summary-review">{review} to review again</span>}
    </p>
  );
}

export function ReviewList({ onOpen, disabled }) {
  const progress = useQuestionProgress();
  const [items, setItems] = useState([]);
  const key = JSON.stringify(Object.entries(progress).map(([s, e]) => [s, Object.entries(e).filter(([, v]) => needsReview(v)).map(([k]) => k)]));
  useEffect(() => {
    let cancelled = false;
    fetch("/api/questions/review")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => !cancelled && setItems(data.items || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  // The server list is authoritative for prompts; local marks hide items at once.
  const shown = items.filter((item) => needsReview(progress[item.step]?.[item.id] ?? item));
  if (!shown.length) return null;
  return (
    <nav className="review-list" aria-label="Questions to review again">
      <div className="eyebrow section-label">REVIEW AGAIN</div>
      <ul>
        {shown.map((item) => (
          <li key={item.step + "/" + item.id}>
            <button type="button" disabled={disabled} onClick={() => onOpen(item.step, item.id)}>
              <span className="number">{item.step}</span>
              <span>{item.prompt || "Check question"}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Scroll to a question in the current lesson (when it is already open). */
export function focusQuestion(step, qid) {
  const target = document.querySelector(`.lesson-panel .check-question[data-question="${CSS.escape(qid)}"]`);
  if (!target) return false;
  target.closest("details")?.setAttribute("open", "");
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
  return true;
}
