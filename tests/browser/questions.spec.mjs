// Check questions (A6) in a real browser: attempt first, check and reveal,
// self-marking, persistence (server and local), the review list, keyboard
// use, axe, hostile blocks and no answer before an attempt.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const API = "http://127.0.0.1:4317/api";
const SECRETS = /fail closed|Failing closed|server-side filter is|authoritative status source|HOSTILE-EXPLANATION/i;
function guard(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push("console: " + m.text()));
  page.on("dialog", async (d) => {
    problems.push("dialog: " + d.message());
    await d.dismiss();
  });
  return problems;
}
async function openStep(page, label) {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByRole("status").first()).toContainText("workspace is ready");
}
const question = (page, prompt) => page.locator(".lesson-panel .check-question").filter({ hasText: prompt });
async function axe(page, selector) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("no answer is in the page source or the initial lesson payload before an attempt", async ({ page }) => {
  const problems = guard(page);
  const payloads = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/") && !r.url().includes("/api/questions/")) payloads.push(await r.text().catch(() => ""));
  });
  await page.goto("/");
  await openStep(page, /02 Python approved documents/);
  await expect(question(page, "no status field")).toBeVisible();
  expect(await page.content()).not.toMatch(SECRETS);
  expect(payloads.join("\n")).not.toMatch(SECRETS);
  const exercise = await (await page.request.get(API + "/exercise?id=02")).text();
  expect(exercise).not.toMatch(SECRETS);
  expect(exercise).toContain("missing-status");
  // The plain-text copy for the tutor and MCP keeps prompts only.
  expect(JSON.parse(exercise).instructions).toContain("**Check question:** A document arrives with **no** `status` field.");
  expect(problems).toEqual([]);
});

test("multiple choice: choose, check, explanation, try again, persisted; summary and review list", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /02 Python approved documents/);
  const q = question(page, "no status field");
  const group = q.getByRole("radiogroup", { name: /no status field/ });
  await expect(group.getByRole("radio")).toHaveCount(3);
  const check = q.getByRole("button", { name: "Check" });
  await expect(check).toBeDisabled();
  await expect(q).not.toContainText("Why");
  await group.getByRole("radio", { name: /Include it/ }).check();
  await check.click();
  await expect(q.locator(".cq-verdict")).toHaveText("Not quite. The correct answer is B.");
  await expect(q.locator("[aria-live=polite]")).toHaveText("Not quite. The correct answer is B.");
  await expect(q.locator(".cq-choice.cq-correct")).toContainText("Exclude it");
  await expect(q.locator(".cq-choice.cq-correct")).toContainText("Correct answer");
  await expect(q.locator(".cq-choice.cq-incorrect")).toContainText("Your answer");
  await expect(q.locator(".cq-explanation")).toContainText("Failing closed keeps the boundary testable");
  await expect(q.getByRole("button", { name: "Try again" })).toBeFocused();
  await expect(page.locator(".cq-summary")).toHaveText(/Check questions: 1\/3 checked\s*1 to review again/);
  const review = page.getByRole("navigation", { name: "Questions to review again" });
  await expect(review.getByRole("button")).toHaveCount(1);
  await expect(review).toContainText("no status field");
  await axe(page, ".lesson-panel .check-question");
  await q.getByRole("button", { name: "Try again" }).click();
  await group.getByRole("radio", { name: /Exclude it/ }).check();
  await q.getByRole("button", { name: "Check" }).click();
  await expect(q.locator(".cq-verdict")).toHaveText("Correct.");
  await expect(q.locator(".cq-status")).toHaveText("Correct");
  await expect(review).toHaveCount(0);
  // Answer by option text (filter-placement): the source label is shown.
  const placement = question(page, "Where should the approval filter run");
  await expect(placement.locator(".cq-source")).toHaveText("Source: handoff");
  // Persisted on the server: a reload restores the status and the choice.
  await page.reload();
  await openStep(page, /02 Python approved documents/);
  await expect(question(page, "no status field").locator(".cq-status")).toHaveText("Correct");
  await expect(question(page, "no status field").getByRole("radio", { name: /Exclude it/ })).toBeChecked();
  await expect(page.locator(".cq-summary")).toHaveText("Check questions: 1/3 checked");
  const saved = await (await page.request.get(API + "/progress")).json();
  expect(saved.questions["02"]["missing-status"]).toMatchObject({ status: "correct", choice: 1 });
  expect(problems).toEqual([]);
});

test("free text: reveal needs an attempt; model answer, explanation, self-mark and review list persist", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /02 Python approved documents/);
  const q = question(page, "What do they prove");
  const reveal = q.getByRole("button", { name: "Reveal answer" });
  await expect(reveal).toBeDisabled();
  await expect(q).toContainText("Write an answer first");
  await q.getByRole("textbox", { name: "Your answer" }).fill("   ");
  await expect(reveal).toBeDisabled();
  await q.getByRole("textbox", { name: "Your answer" }).fill("They prove the filter for the tested cases.");
  await reveal.click();
  await expect(q.locator(".cq-answer")).toContainText("They prove that this function keeps exactly the documents");
  await expect(q.locator(".cq-explanation")).toContainText("authoritative status source");
  await expect(q.locator(".cq-feedback")).toBeFocused();
  await expect(q.locator("[aria-live=polite]")).toHaveText(/Model answer shown/);
  const marks = q.getByRole("group", { name: "Mark your answer" });
  await marks.getByRole("button", { name: "Review again" }).click();
  await expect(marks.getByRole("button", { name: "Review again" })).toHaveAttribute("aria-pressed", "true");
  await expect(q.locator(".cq-status")).toHaveText("Answer revealed · Review again");
  await axe(page, ".lesson-panel .check-question");
  const review = page.getByRole("navigation", { name: "Questions to review again" });
  await expect(review).toContainText("What do they prove");
  await axe(page, ".review-list");
  // Persistence: server copy (status, mark) plus local copy (the attempt text).
  await page.reload();
  await openStep(page, /02 Python approved documents/);
  const again = question(page, "What do they prove");
  await expect(again.locator(".cq-status")).toHaveText("Answer revealed · Review again");
  await expect(again.getByRole("textbox", { name: "Your answer" })).toHaveValue("They prove the filter for the tested cases.");
  await expect(again.getByRole("button", { name: "Reveal again" })).toBeEnabled();
  // The review list opens the step and focuses the question from another step.
  await openStep(page, /01 Approved documents only/);
  await page.getByRole("navigation", { name: "Questions to review again" }).getByRole("button", { name: /What do they prove/ }).click();
  await expect(page.locator(".lesson-panel .eyebrow").first()).toContainText("LESSON · 02");
  await expect(question(page, "What do they prove")).toBeFocused();
  await question(page, "What do they prove").getByRole("group", { name: "Mark your answer" }).getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("navigation", { name: "Questions to review again" })).toHaveCount(0);
  const saved = await (await page.request.get(API + "/progress")).json();
  expect(saved.questions["02"]["tests-prove"]).toMatchObject({ status: "revealed", mark: "got-it" });
  expect(JSON.stringify(saved)).not.toContain("tested cases");
  expect(problems).toEqual([]);
});

test("keyboard only: arrow keys choose, Enter and Space check, reveal and mark", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /02 Python approved documents/);
  const q = question(page, "Where should the approval filter run");
  await q.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await expect(q.getByRole("radio").first()).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(q.getByRole("radio", { name: /On the server/ })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(q.getByRole("button", { name: "Check" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(q.locator(".cq-verdict")).toHaveText("Correct.");
  await expect(q.getByRole("button", { name: "Try again" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(q.getByRole("button", { name: "Check" })).toBeDisabled();
  const free = question(page, "What do they prove");
  await free.getByRole("textbox", { name: "Your answer" }).focus();
  await page.keyboard.type(" Also more.");
  await page.keyboard.press("Tab");
  await expect(free.getByRole("button", { name: /Reveal/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(free.locator(".cq-answer")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(free.getByRole("button", { name: "Got it" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(free.getByRole("button", { name: "Review again" })).toHaveAttribute("aria-pressed", "true");
  await free.getByRole("button", { name: "Got it" }).press("Space");
  await expect(free.getByRole("button", { name: "Got it" })).toHaveAttribute("aria-pressed", "true");
  expect(problems).toEqual([]);
});

test("a mark saved while the server is unreachable stays on this device and is sent on the next load", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /02 Python approved documents/);
  const q = question(page, "What do they prove");
  await q.getByRole("textbox", { name: "Your answer" }).fill("An offline attempt.");
  await q.getByRole("button", { name: /Reveal/ }).click();
  await expect(q.locator(".cq-answer")).toBeVisible();
  await page.route("**/api/questions/mark", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Engine unavailable" }) }));
  await q.getByRole("button", { name: "Review again" }).click();
  await expect(q.locator(".cq-error")).toContainText("Saved on this device only");
  await expect(q.locator(".cq-status")).toHaveText("Answer revealed · Review again");
  await page.unroute("**/api/questions/mark");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/questions/mark") && r.method() === "POST");
  await page.reload();
  await sent;
  await openStep(page, /02 Python approved documents/);
  await expect(question(page, "What do they prove").locator(".cq-status")).toHaveText("Answer revealed · Review again");
  await expect.poll(async () => (await (await page.request.get(API + "/progress")).json()).questions["02"]["tests-prove"].mark).toBe("review");
  expect(problems.filter((p) => !p.includes("503"))).toEqual([]);
});

test("hostile question blocks: no script runs before or after checking; a YAML bomb is an author warning", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /06 Hostile content/);
  const lesson = page.locator(".lesson-panel .lesson-html").first();
  const q = lesson.locator(".check-question").filter({ hasText: "Hostile prompt" });
  await expect(q.getByRole("radio")).toHaveCount(2);
  await expect(lesson.locator(".question-invalid")).toContainText("YAML anchors (&name) are not allowed");
  await expect(lesson).toContainText("Safe paragraph after the attacks.");
  expect(await page.content()).not.toContain("HOSTILE-EXPLANATION");
  await q.getByRole("radio", { name: /second option/ }).check();
  await q.getByRole("button", { name: "Check" }).click();
  await expect(q.locator(".cq-explanation")).toContainText("HOSTILE-EXPLANATION");
  await expect(q.locator("script, img, svg, iframe, style")).toHaveCount(0);
  expect(await q.evaluate((el) => [...el.querySelectorAll("*")].flatMap((n) => [...n.attributes].map((a) => a.name)).filter((a) => a.startsWith("on") || a === "style"))).toEqual([]);
  expect(await q.evaluate((el) => [...el.querySelectorAll("[href]")].map((n) => n.getAttribute("href")))).toEqual([]);
  await q.getByText("explanation link").click();
  await q.getByText("prompt link").click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(problems).toEqual([]);
});
