// Stage 3: lessons, apps, in-browser tests, course pages, notifications and
// the hostile-content guarantees, in a real browser.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const SANDBOX = "http://127.0.0.1:4318";
function guard(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
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

test("lessons render Shiki code, callouts, a TOC, copy buttons and Mermaid in an opaque sandbox", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /04 A counter/);
  const lesson = page.locator(".lesson-panel .lesson-html").first();
  await expect(lesson.locator(".callout-info")).toContainText("runs in a sandbox");
  await expect(lesson.locator(".callout-tip")).toContainText("@icodenet/workshop-test");
  await expect(lesson.locator(".code-block .code-title")).toHaveText("counter.mjs");
  await expect(lesson.locator("pre.shiki .line.highlighted")).toContainText("return count");
  await expect(page.getByRole("navigation", { name: /On this page/ })).toContainText("Check your work");
  await lesson.locator(".code-block").first().hover();
  await lesson.getByRole("button", { name: "Copy code" }).first().click();
  await expect(lesson.getByRole("button", { name: "Copy code" }).first()).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("export function next(count)");
  const figure = lesson.locator("figure.mermaid-diagram");
  await expect(figure).toHaveClass(/mermaid-rendered/, { timeout: 20000 });
  const frame = figure.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("src", SANDBOX + "/__icode/mermaid.html");
  await expect(page.frameLocator("figure.mermaid-diagram iframe").first().locator("svg")).toBeVisible();
  // A TOC link scrolls without changing the URL.
  await page.getByRole("navigation", { name: /On this page/ }).getByRole("link", { name: "Check your work" }).click();
  expect(page.url()).not.toContain("#");
  expect(problems).toEqual([]);
});

test("simple app in the in-workshop browser, LinkToApp, address bar and in-browser tests without login", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /04 A counter/);
  await page.getByRole("link", { name: "Open the app" }).click();
  await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  const app = page.frameLocator('iframe[title="App preview 04"]');
  await expect(app.getByRole("button", { name: "Count: 0" })).toBeVisible();
  await app.getByRole("button", { name: "Count: 0" }).click();
  await expect(app.getByRole("button", { name: "Count: 0" })).toBeVisible(); // problem: next() is a TODO
  // Address bar: SPA-style routes fall back to index.html; only paths are accepted.
  const address = page.getByRole("textbox", { name: "App address" });
  await address.fill("/some/route");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(app.getByRole("heading", { name: "Counter" })).toBeVisible();
  await address.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "starts with /" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:4318\/app\/04\/playground\//);
  // Browser tests: first step passes, second fails on the problem code.
  await page.getByRole("button", { name: "Run browser tests" }).click();
  const results = page.getByRole("region", { name: "Browser test results" });
  await expect(results).toContainText("failed", { timeout: 30000 });
  await expect(results).toContainText("✓ The page shows a Count button");
  await expect(results).toContainText("✗ Clicking the button adds one");
  await expect(results).toContainText('expected text "Count: 0" to contain Count: 2');
  await expect(page.getByText(/log in|sign in/i)).toHaveCount(0);
  // Fix the playground and rerun.
  const fixed = await readFile("examples/exercises/04/solution/counter.mjs", "utf8");
  const saved = await page.request.put("http://127.0.0.1:4317/api/file", { data: { id: "04", name: "counter.mjs", code: fixed } });
  expect(saved.ok()).toBe(true);
  await page.getByRole("button", { name: "Run browser tests" }).click();
  await expect(results.locator(".browser-test")).toHaveClass(/passed/, { timeout: 30000 });
  await page.getByRole("button", { name: "Reload app" }).click();
  await app.getByRole("button", { name: "Count: 0" }).click();
  await expect(app.getByRole("button", { name: "Count: 1" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/workshop-browser-tests.png", fullPage: true });
  // Cloud editor links point at the published problem/solution.
  await page.getByText("Open in a cloud editor").click();
  await expect(page.getByRole("link", { name: "StackBlitz" }).first()).toHaveAttribute("href", /^https:\/\/stackblitz\.com\/github\/IcodeNet\/Icode-workshop\/tree\/main\/examples\/exercises\/04\/problem\?/);
  expect(problems).toEqual([]);
});

test("export app shows console output and exported values per variant", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /05 An export app/);
  await page.getByRole("tab", { name: "Preview" }).click();
  const app = page.frameLocator('iframe[title="App preview 05"]');
  await expect(app.getByRole("region", { name: "Console output" })).toContainText("Grouped 0 statuses");
  await expect(app.getByRole("region", { name: "Exports" })).toContainText("groupByStatus");
  await page.getByRole("combobox", { name: "App variant" }).selectOption("solution");
  await expect(app.getByRole("region", { name: "Console output" })).toContainText("Grouped 2 statuses");
  await expect(app.getByRole("region", { name: "Exports" })).toContainText('"Retention policy"');
  expect(problems).toEqual([]);
});

test("hostile lesson cannot run script; hostile app cannot reach the API, the UI or the top window", async ({ page }) => {
  const problems = guard(page);
  const before = await (await page.request.get("http://127.0.0.1:4317/api/progress")).json();
  await page.goto("/");
  await openStep(page, /06 Hostile content/);
  const lesson = page.locator(".lesson-panel .lesson-html").first();
  await expect(lesson).toContainText("Safe paragraph after the attacks.");
  await expect(lesson.locator("script, svg, iframe:not(.mermaid-frame), math, form, object, embed, style")).toHaveCount(0);
  expect(await lesson.evaluate((el) => [...el.querySelectorAll("*")].flatMap((n) => [...n.attributes].map((a) => a.name)).filter((a) => a.startsWith("on") || a === "style"))).toEqual([]);
  expect(await lesson.evaluate((el) => [...el.querySelectorAll("[href],[src]")].map((n) => n.getAttribute("href") ?? n.getAttribute("src")).filter((u) => !/^(https:|#|http:\/\/127\.0\.0\.1:4318\/)/.test(u)))).toEqual([]);
  await expect(lesson.getByText("javascript link")).toHaveAttribute("data-blocked-url", "scheme");
  // The diagram renders (or fails) inside the opaque sandbox only.
  const figure = lesson.locator("figure.mermaid-diagram");
  await expect(figure).toHaveClass(/mermaid-(rendered|failed)/, { timeout: 20000 });
  const mermaid = page.frameLocator("figure.mermaid-diagram iframe").first();
  await expect(mermaid.locator("img[onerror], [onclick], a[href^='javascript']")).toHaveCount(0);
  await lesson.getByText("styled paragraph").click();
  await page.locator("details").filter({ hasText: "toggle" }).first().locator("summary").click();
  // Hostile app.
  await page.getByRole("tab", { name: "Preview" }).click();
  const app = page.frameLocator('iframe[title="App preview 06"]');
  await expect(app.locator("#out")).not.toHaveText("running", { timeout: 15000 });
  const results = JSON.parse(await app.locator("#out").textContent());
  expect(results).toEqual({ api: "blocked", ui: "blocked", mutate: "blocked", uiMutate: "blocked", parent: "blocked", top: "blocked" });
  await page.waitForTimeout(500);
  expect(page.url()).not.toContain("hijacked");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const after = await (await page.request.get("http://127.0.0.1:4317/api/progress")).json();
  expect(after).toEqual(before);
  expect(problems).toEqual([]);
});

test("course home, finished page with feedback form, guide, support and notifications with mute", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  const home = page.getByRole("article", { name: "AI Engineering Foundations" });
  await expect(home.getByRole("region", { name: "Course outline" })).toContainText("06 · Hostile content");
  await expect(home).toContainText("Small, testable building blocks for AI applications");
  await expect(home.getByRole("link", { name: "Ada Example" })).toHaveAttribute("href", "https://example.com/ada");
  // Epic's intro-page DiffLink crashes the page; here it is inactive text.
  await expect(home.locator(".diff-link-inactive").first()).toHaveText("See the first diff");
  await expect(home.locator("figure.mermaid-diagram")).toHaveClass(/mermaid-rendered/, { timeout: 20000 });
  const notices = page.getByRole("region", { name: "Workshop notifications" });
  await expect(notices).toContainText("Welcome notice");
  await expect(notices).not.toContainText("Expired notice");
  await expect(notices.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "https://example.com/news");
  await page.getByRole("button", { name: "Finish" }).click();
  const finished = page.getByRole("article", { name: "Workshop complete" });
  await expect(finished).toContainText("You finished the course");
  await expect(finished.getByRole("link", { name: "Give feedback on this workshop" })).toHaveAttribute("href", "https://example.com/feedback?w=AI%20Engineering%20Foundations");
  await page.getByRole("button", { name: "Guide" }).click();
  await expect(page.getByRole("article", { name: "Guide" })).toContainText("Using this workshop");
  await page.getByRole("button", { name: "Support" }).click();
  const support = page.getByRole("article", { name: "Support" });
  await expect(support.locator("strong")).toContainText("course channel");
  await expect(support.getByRole("link", { name: "Course forum" })).toHaveAttribute("href", "https://example.com/forum");
  await page.getByRole("button", { name: "Course home" }).click();
  await home.getByRole("button", { name: /^(Start the course|Continue)/ }).click();
  await expect(page.getByRole("status").first()).toContainText("workspace is ready");
  // Exercise feedback form on the last step of an exercise.
  await page.getByRole("button", { name: /05 An export app/ }).click();
  await expect(page.getByRole("region", { name: "Exercise complete" }).getByRole("link")).toHaveAttribute("href", "https://example.com/exercise?e=Browser%20apps");
  await page.getByRole("button", { name: "Dismiss Welcome notice" }).click();
  await expect(notices).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("article", { name: "AI Engineering Foundations" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workshop notifications" })).toHaveCount(0);
  expect(problems).toEqual([]);
});
