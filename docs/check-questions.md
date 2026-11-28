# Check questions in lessons

Status: Stage 5 A6, pulled forward as a minimal engine feature for the course redesign. It covers author-written check questions only. AI-generated questions, interleaving of completed material and the MCP quiz are still open (see [the gap analysis](epic-deep-analysis/README.md), row A6).

## Authoring

A check question is a fenced code block whose info string is `question`, containing YAML:

````markdown
```question
id: semantic-vs-vector            # optional, stable; letters, digits, - and _
prompt: Is semantic ranking the same as vector search?
options:                          # optional: present means multiple choice
  - Yes, both use embeddings
  - No, it reranks a candidate set from another query
answer: 1                         # 0-based index, or the exact option text
explanation: |
  Semantic ranking is a second stage over the results of a keyword or hybrid query.
source: handoff                   # optional label
```
````

| Field | Required | Notes |
|---|---|---|
| `prompt` | yes | Markdown, up to 4,000 characters. |
| `options` | no | 2–10 distinct, non-empty strings (Markdown, up to 500 characters each). Present means multiple choice. |
| `answer` | yes | Multiple choice: the **0-based** index (the first option is 0) or the exact text of one option. Prefer the text: it survives reordering. Free text: the model answer in Markdown, up to 8,000 characters. |
| `explanation` | yes | Markdown, up to 8,000 characters. Say why the answer is right. |
| `source` | no | A short label (up to 40 characters), shown as a small tag. |
| `id` | no | Stable id. Without it, the id is the document's path inside the step plus the block's position (`readme-2`), so moving a block changes its id and its saved progress. Give an id to any question whose progress should survive edits. |

Other fields are errors. A block holds one YAML document. A document may hold up to 30 questions. Use a longer outer fence (four backticks) when a prompt or explanation contains a fenced code block.

`workshop validate` reports every invalid block as `file:line: invalid check question: message`, including duplicate ids in a document, and exits non-zero. In the lesson an invalid block is replaced by a visible **Author warning** callout that lists the problems; its YAML is not shown, because it may contain the answer.

Questions are interactive in a step's documents (lesson, wrap-up and, in the Epic layout, the exercise and course documents shown with the step). On course pages (home, finished, support), which have no step, they show the prompt and options with a note that they can be answered inside a step.

## Learner behaviour

- **Multiple choice**: a radio group. **Check** is enabled once an option is chosen. The result marks the correct option ("Correct answer") and the learner's wrong choice ("Your answer"), says "Correct." or "Not quite. The correct answer is B.", and shows the explanation. **Try again** clears the choice.
- **Free text**: a text box. **Reveal answer** is enabled only when the answer is not blank. It shows the model answer and the explanation; the learner then marks **Got it** or **Review again**.
- **Progress**: each question's status (`correct`, `incorrect` or `revealed`), the last choice and the self-mark are stored with step progress in `.workshop/progress.json` under `questions.<step>.<id>`, and mirrored in `localStorage` (one copy per course). The free-text attempt itself stays in `localStorage`; it is sent to the engine only with Reveal (to require an attempt) and is not stored there. A self-mark that cannot be sent is kept on the device and sent on the next load. No login.
- **Summary**: the lesson shows "Check questions: 2/3 checked" for the step, and how many are to review again.
- **Review again**: the sidebar lists, across all steps, the questions answered incorrectly (until checked correctly or marked "got it") and those marked "review again". Choosing one opens its step and focuses the question.
- The Stage 4 command palette (PR #10) is not on `main` yet. Follow-up: add the review list to the palette as a "Review" command group once it merges.

## How the answer stays hidden

1. The server renders a question as static, sanitised HTML containing the prompt and options only (`markdown.mjs`, `questions()`). The answer index, model answer and explanation are rendered separately and kept in the server-side render result (`questions`), which no route returns.
2. The lesson payload (`/api/exercise`) carries question ids and kinds only. Its plain-text copies (`instructions`, `documents[].content`, the tutor context and MCP `read_lesson`) replace every question block with its prompt and options (`stripQuestionAnswers`). The plain-text fallback used for a lesson that is too large or too slow to render does the same.
3. Answers leave the engine only from `POST /api/questions/check` (with a valid choice) and `POST /api/questions/reveal` (with a non-blank attempt).

Course files are on the learner's own disk, so a learner can always read the raw Markdown. The guarantee is about the workshop: the page, its source and the API never show an answer before an attempt.

Older engines show the block as a YAML code block, answer included. Courses that must stay compatible with older engines can keep using reveal blocks (`<details>`) until they require this engine.

## Security

- **Markdown**: the prompt, every option, the explanation and the model answer go through the same pipeline as the lesson: the Stage 3 allowlist sanitiser, the URL policy, Shiki for code (text only). Question markup is added after sanitising, so authors cannot forge it: `check-question` and its data attributes are not on the allowlist. Headings inside a question get no ids or table-of-contents entries. A question inside a question is plain code.
- **YAML**: `yaml` with the core schema (YAML 1.2), strict, unique keys, no merge keys. Any explicit tag (`!!str`, `!custom`, `!!js/function`), anchor or alias is refused before the document is converted, so an alias bomb is never expanded. Limits: 16 KB per block, nesting depth 3, one document, the field limits above. All rendering runs in the Stage 3 worker with its 5-second limit.
- **Routes** (`question-routes.mjs`): behind the API's Host, Origin and Fetch Metadata checks; mutating routes need the per-process session token like every browser mutation. They validate the step id, the question id (`[A-Za-z0-9][A-Za-z0-9_-]{0,79}`), the choice and the attempt (up to 5,000 characters), and return 404 for an unknown question or the wrong kind.
- **Mutation gate**: the question routes are exempt from the request gate, so a learner can answer questions while a test run or a hook holds it. They write only `progress.json`, and every progress write (steps and questions) goes through one queue in `course.mjs`. Step completion (`PUT /api/progress`) stays gated.
- **Stored progress** is validated on read: unknown steps, invalid ids, statuses and marks are dropped.

## API

| Route | Method | Body / query | Response |
|---|---|---|---|
| `/api/questions` | GET | `id` (step) | `{ id, questions: [{id, kind, document}], progress }` |
| `/api/questions/check` | POST | `{ id, question, choice }` | `{ correct, answerIndex, explanationHtml, progress }` |
| `/api/questions/reveal` | POST | `{ id, question, attempt }` | `{ answerHtml, explanationHtml, progress }` |
| `/api/questions/mark` | POST | `{ id, question, mark: "got-it" \| "review" }` | `{ progress }` (after a check or reveal only) |
| `/api/questions/review` | GET | — | `{ items: [{step, id, kind, prompt, status, mark?}] }` |
| `/api/progress` | GET | — | `{ completed, questions }` |

## Accessibility

Each question is a `role="group"` labelled by its prompt. Options are native radio inputs inside `role="radiogroup"` (arrow keys move and select; Tab reaches Check). The free-text box has a visible label. Results are announced through a polite live region, and focus moves to **Try again** or to the revealed answer. Self-marks are toggle buttons (`aria-pressed`). State is never shown by colour alone. Colours are defined for the dark theme on `main` and for the Stage 4 `light` and `high-contrast` themes. Playwright runs axe (WCAG 2.1 A and AA) on answered questions and on the review list.

## Tests

- `packages/web/questions.test.mjs`: parser and limits, validation messages, YAML tags, anchors, aliases and a billion-laughs block, depth and size limits, fence detection and line numbers, rendering without answers, duplicate ids, invalid blocks, XSS in every Markdown field, forged markup, huge blocks and the plain-text fallback, plain-text copies, progress storage and `workshop validate` output.
- `packages/web/questions.integration.test.mjs`: the payloads hold no answer; check, reveal and mark validation; persistence across an engine restart; refusal of foreign origins, the sandbox origin, cross-site requests and browser requests without the session token; the gate exemption while a hook holds the gate.
- `tests/browser/questions.spec.mjs`: no answer in the page source or API responses before an attempt; multiple choice, free text, self-marking, the summary and the review list; persistence across reloads (server and local); keyboard-only use; axe; a mark saved offline and re-sent; hostile question blocks (XSS and a YAML bomb in the browser fixture's step 06).
- The example course (`examples/exercises/02/README.md`) has two multiple-choice questions (by index and by option text, one with `source: handoff`) and one free-text question.
