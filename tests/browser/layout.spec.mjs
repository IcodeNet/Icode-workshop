// Learner layout on laptop screens: the page never scrolls, the sidebar, the
// lesson and the workbench scroll on their own beneath a header that keeps
// its place, links to another origin open a new tab, headings are named by
// their own text, no raw placeholder reaches the UI, and every dropdown is the
// one select component with the geometry of the buttons beside it.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UI = "http://127.0.0.1:5173";
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];
const THEMES = ["dark", "light", "high-contrast"];
const courseRoot = () => readFile(join(tmpdir(), "icode-browser-root.txt"), "utf8");

async function openStep(page, label) {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.getByRole("status").first()).toContainText("workspace is ready");
}
async function putPreferences(page, ui) {
  await page.evaluate(async (ui) => {
    const { token } = await (await fetch("/api/session")).json();
    for (let i = 0; i < 20; i++) {
      const r = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json", "x-icode-session": token }, body: JSON.stringify({ ui }) });
      if (r.ok) return;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("could not store preferences");
  }, ui);
}
const DEFAULT_UI = { theme: "dark", uiScale: 100, editorFont: "system-mono", editorFontSize: 12, motion: "system", restoreScroll: true, dismissedWarnings: [], shortcuts: {} };
async function resetPreferences(page) {
  await page.evaluate(() => {
    localStorage.removeItem("icode:preferences");
    sessionStorage.clear();
  });
  await putPreferences(page, DEFAULT_UI);
}
const pane = (page, name) => page.locator(`[data-scroll-pane="${name}"]`);
const sidebar = (page) => page.locator(".sidebar");
const scrollTop = (locator) => locator.evaluate((n) => Math.round(n.scrollTop));
const box = (locator) => locator.evaluate((n) => { const r = n.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) }; });
/** Nothing at page level scrolls, and nothing can make it scroll. */
async function expectPageFixed(page) {
  const state = await page.evaluate(() => {
    window.scrollTo(0, 5000);
    document.scrollingElement.scrollTop = 5000;
    const app = document.querySelector(".app");
    return { scrollY: Math.round(window.scrollY), fits: document.documentElement.scrollHeight <= window.innerHeight, wide: document.documentElement.scrollWidth <= window.innerWidth, app: Math.round(app.getBoundingClientRect().height), appScroll: app.scrollTop, inner: window.innerHeight };
  });
  expect(state.scrollY, "page scroll offset").toBe(0);
  expect(state.fits, "document is no taller than the viewport").toBe(true);
  expect(state.wide, "document is no wider than the viewport").toBe(true);
  expect(state.appScroll).toBe(0);
  expect(Math.abs(state.app - state.inner), "the app fills the viewport").toBeLessThanOrEqual(1);
}
// Notices load after the first paint: measure once the header is settled.
const geometry = (page) => page.evaluate(() => Object.fromEntries([["header", ".app-header"], ["shell", ".shell"], ["lesson", '[data-scroll-pane="lesson"]']].map(([k, sel]) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return [k, r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null]; })));
async function settled(page) {
  let last = await geometry(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const next = await geometry(page);
    if (JSON.stringify(next) === JSON.stringify(last) && i >= 3) return next;
    last = next;
  }
  return last;
}
async function wheelOver(page, locator, deltaY) {
  const r = await locator.boundingBox();
  await page.mouse.move(r.x + Math.min(r.width / 2, 200), r.y + Math.min(r.height / 2, 120));
  await page.mouse.wheel(0, deltaY);
}

test.afterEach(async ({ page }) => {
  if (page.url().startsWith(UI)) await resetPreferences(page).catch(() => {});
});

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}×${viewport.height}`;
  test.describe(`learner layout at ${size}`, () => {
    test.use({ viewport });

    test(`the page does not scroll; sidebar, lesson and workbench scroll on their own; editor and output scroll inside the workbench (${size})`, async ({ page }) => {
      await page.goto("/");
      await expectPageFixed(page);
      await openStep(page, /40 Pane layout/);
      await settled(page);
      await expectPageFixed(page);
      const lesson = pane(page, "lesson");
      const workbench = pane(page, "workbench");
      const side = sidebar(page);
      for (const [name, locator] of [["lesson", lesson], ["workbench", workbench], ["sidebar", side]]) {
        expect(await locator.evaluate((n) => getComputedStyle(n).overflowY), name + " overflow").toBe("auto");
        expect(await locator.evaluate((n) => n.scrollHeight - n.clientHeight), name + " has more than fits").toBeGreaterThan(100);
        const b = await box(locator);
        expect(b.bottom, name + " ends inside the viewport").toBeLessThanOrEqual(viewport.height);
      }
      // Opening the step from the sidebar scrolls the sidebar to its button.
      const sideAt = await scrollTop(side);
      await side.evaluate((n) => n.scrollTo(0, 0));
      const runTests = page.getByRole("button", { name: "Run tests", exact: true });
      const before = { workbench: await box(workbench), runTests: await box(runTests), header: await box(page.locator(".app-header")) };
      await expect(runTests).toBeInViewport({ ratio: 1 });

      // Reading the lesson to its end moves nothing else.
      await wheelOver(page, lesson, 600);
      await expect.poll(() => scrollTop(lesson)).toBeGreaterThan(500);
      await lesson.evaluate((n) => n.scrollTo(0, n.scrollHeight));
      await expect(lesson.getByRole("button", { name: "Mark complete" })).toBeInViewport();
      expect(await scrollTop(workbench)).toBe(0);
      expect(await scrollTop(side)).toBe(0);
      expect(sideAt).toBeGreaterThan(0);
      expect(await box(workbench)).toEqual(before.workbench);
      expect(await box(runTests)).toEqual(before.runTests);
      await expect(runTests).toBeInViewport({ ratio: 1 });
      await expectPageFixed(page);
      const lessonAt = await scrollTop(lesson);

      // The sidebar scrolls alone.
      await wheelOver(page, side, 300);
      await expect.poll(() => scrollTop(side)).toBeGreaterThan(200);
      expect(await scrollTop(lesson)).toBe(lessonAt);
      expect(await scrollTop(workbench)).toBe(0);

      // The editor scrolls inside the workbench without moving the pane.
      await page.getByRole("tab", { name: "Playground", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Playground code editor" });
      await expect(editor).toHaveValue(/line160/);
      await editor.evaluate((n) => n.scrollIntoView({ block: "center" }));
      await expect(editor).toBeInViewport({ ratio: 0.6 });
      const workbenchAt = await scrollTop(workbench);
      expect(await editor.evaluate((n) => n.scrollHeight - n.clientHeight)).toBeGreaterThan(500);
      await wheelOver(page, editor, 400);
      await expect.poll(() => scrollTop(editor)).toBeGreaterThan(300);
      expect(await scrollTop(workbench)).toBe(workbenchAt);
      expect(await scrollTop(lesson)).toBe(lessonAt);
      await expectPageFixed(page);

      // The workbench pane scrolls alone, down to the output panel.
      await workbench.evaluate((n) => n.scrollTo(0, n.scrollHeight));
      await expect.poll(() => scrollTop(workbench)).toBeGreaterThan(100);
      expect(await scrollTop(lesson)).toBe(lessonAt);
      const output = page.locator(".output-panel .notice");
      await expect(output).toBeInViewport();
      expect(await output.evaluate((n) => [getComputedStyle(n).overflowY, parseFloat(getComputedStyle(n).maxHeight) > 0])).toEqual(["auto", true]);
      // Long output scrolls inside its panel.
      await output.evaluate((n) => (n.textContent = Array.from({ length: 200 }, (_, i) => "output line " + (i + 1)).join("\n")));
      expect(await output.evaluate((n) => n.scrollHeight > n.clientHeight && n.clientHeight <= window.innerHeight * 0.5)).toBe(true);
      expect(await box(page.locator(".app-header"))).toEqual(before.header);
      await expectPageFixed(page);

      // Positions are kept per pane and per step.
      await lesson.evaluate((n) => n.scrollTo(0, 320));
      await workbench.evaluate((n) => n.scrollTo(0, 90));
      await page.waitForTimeout(300);
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("#01");
      await page.keyboard.press("Enter");
      await expect(page.locator(".heading h1", { hasText: "Approved documents only" })).toBeVisible();
      await expect.poll(() => scrollTop(lesson)).toBe(0);
      await expect.poll(() => scrollTop(workbench)).toBe(0);
      // The sidebar keeps its place when the step changes.
      expect(await scrollTop(side)).toBeGreaterThan(200);
      await page.keyboard.press("Control+Shift+P");
      await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("#40");
      await page.keyboard.press("Enter");
      await expect(page.locator(".heading h1", { hasText: "Pane layout" })).toBeVisible();
      await expect.poll(() => scrollTop(lesson)).toBeGreaterThan(310);
      await expect.poll(() => scrollTop(workbench)).toBeGreaterThan(80);
      await expectPageFixed(page);
    });

    test(`course pages and preferences scroll in the content pane, not the page (${size})`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Preferences", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
      const content = pane(page, "content");
      expect(await content.evaluate((n) => getComputedStyle(n).overflowY)).toBe("auto");
      expect(await content.evaluate((n) => n.scrollHeight - n.clientHeight)).toBeGreaterThan(50);
      await wheelOver(page, content, 400);
      await expect.poll(() => scrollTop(content)).toBeGreaterThan(40);
      await expectPageFixed(page);
      await expect(page.getByRole("button", { name: "Commands", exact: true })).toBeInViewport({ ratio: 1 });
    });

    test(`the header keeps its place while panes scroll, and stacked banners push the panes down (${size})`, async ({ page }) => {
      const root = await courseRoot();
      const flag = join(root, ".icode-deployed");
      await page.goto("/");
      await openStep(page, /40 Pane layout/);
      const header = page.locator(".app-header");
      const shell = page.locator(".shell");
      const lesson = pane(page, "lesson");
      const plain = await settled(page);
      expect(plain.header.top).toBe(0);
      expect(plain.shell.top).toBe(plain.header.bottom);
      try {
        await writeFile(flag, "1");
        const cost = page.getByRole("region", { name: "Course status" });
        // The server reads indicator files at most every few seconds.
        await expect(async () => {
          await page.reload();
          await expect(cost).toContainText("Demo resources are running and incur cost.", { timeout: 3000 });
        }).toPass({ timeout: 30000 });
        await openStep(page, /40 Pane layout/);
        // A second banner stacks under the first.
        await page.route("**/api/health", (route) => route.abort());
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        const down = page.getByRole("region", { name: "The workshop server is not reachable." });
        await expect(down).toBeVisible({ timeout: 15000 });
        await expect(cost).toBeVisible();
        const stacked = { ...(await settled(page)), cost: await box(cost), down: await box(down) };
        expect(stacked.header.top).toBe(0);
        expect(stacked.header.height).toBeGreaterThan(plain.header.height + 60);
        // The panes start where the header ends: no banner covers content.
        expect(stacked.shell.top).toBe(stacked.header.bottom);
        // Boxes are rounded to whole pixels: allow one pixel either way.
        expect(Math.abs(stacked.lesson.top - plain.lesson.top - (stacked.header.height - plain.header.height))).toBeLessThanOrEqual(1);
        expect(stacked.lesson.bottom).toBeLessThanOrEqual(viewport.height);
        expect(Math.min(stacked.cost.top, stacked.down.top)).toBeGreaterThanOrEqual(0);
        expect(stacked.cost.bottom <= stacked.down.top || stacked.down.bottom <= stacked.cost.top, "banners do not overlap").toBe(true);
        expect(Math.max(stacked.cost.bottom, stacked.down.bottom)).toBeLessThanOrEqual(stacked.header.bottom);
        await expectPageFixed(page);

        // Scroll every pane to its end: header, status and banners stay put.
        await lesson.evaluate((n) => n.scrollTo(0, n.scrollHeight));
        await pane(page, "workbench").evaluate((n) => n.scrollTo(0, n.scrollHeight));
        await sidebar(page).evaluate((n) => n.scrollTo(0, n.scrollHeight));
        await expect.poll(() => scrollTop(lesson)).toBeGreaterThan(500);
        expect((await geometry(page)).header).toEqual(stacked.header);
        expect(await box(cost)).toEqual(stacked.cost);
        for (const locator of [cost, down, page.locator(".connection-status"), page.locator(".activity-bar"), page.getByRole("button", { name: "Commands", exact: true })]) await expect(locator).toBeInViewport({ ratio: 1 });
        // Nothing of the lesson shows through or over the header.
        const covering = await page.evaluate(() => {
          const h = document.querySelector(".app-header").getBoundingClientRect();
          return [...document.querySelectorAll(".lesson-panel *, .workspace-column *")].filter((n) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.top < h.bottom - 1 && r.bottom > h.top && n.checkVisibility?.({ visibilityProperty: true }) && document.elementFromPoint(Math.min(Math.max(r.left + 2, 0), innerWidth - 1), Math.max(r.top + 1, 0))?.closest(".lesson-panel, .workspace-column"); }).length;
        });
        expect(covering).toBe(0);
        await page.unroute("**/api/health");
        // The next automatic check can clear the banner before the click lands.
        if (await down.isVisible()) await down.getByRole("button", { name: "Retry now" }).click({ timeout: 2000 }).catch(() => {});
        await expect(down).toHaveCount(0);
        // With one banner fewer the panes move back up by its height.
        await expect.poll(async () => (await box(shell)).top).toBe((await box(header)).bottom);
        expect((await box(header)).height).toBeLessThan(stacked.header.height);
      } finally {
        await page.unroute("**/api/health").catch(() => {});
        await rm(flag, { force: true });
      }
      await page.reload();
      await expect(page.getByRole("region", { name: "Course status" })).toHaveCount(0);
    });

    test(`a lesson link to another origin opens a new tab and the workshop page stays put (${size})`, async ({ page, context }) => {
      await context.route(/^https:\/\/learn\.microsoft\.com\//, (route) => route.fulfill({ contentType: "text/html", body: "<title>Documentation</title><h1>Documentation</h1>" }));
      await page.goto("/");
      await openStep(page, /40 Pane layout/);
      const lesson = pane(page, "lesson");
      const docs = lesson.getByRole("link", { name: "Azure AI Search documentation (opens in a new tab)", exact: true });
      await expect(docs).toHaveAttribute("href", "https://learn.microsoft.com/azure/search/");
      await expect(docs).toHaveAttribute("target", "_blank");
      await expect(docs).toHaveAttribute("rel", /^(?=.*\bnoopener\b)(?=.*\bnoreferrer\b)/);
      // The hint is real text for assistive technology, not visible text.
      await expect(docs.locator(".new-tab-hint")).toHaveText("(opens in a new tab)");
      expect(await docs.locator(".new-tab-hint").evaluate((n) => { const r = n.getBoundingClientRect(); return r.width <= 1 && r.height <= 1; })).toBe(true);
      await lesson.evaluate((n) => n.scrollTo(0, 60));
      const url = page.url();
      const marker = await page.evaluate(() => (window.__samePage = Math.random()));
      const [tab] = await Promise.all([context.waitForEvent("page"), docs.click()]);
      await tab.waitForLoadState();
      expect(tab.url()).toBe("https://learn.microsoft.com/azure/search/");
      expect(await tab.evaluate(() => [window.opener === null, document.referrer])).toEqual([true, ""]);
      // The workshop tab did not navigate, reload or lose its place.
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => window.__samePage)).toBe(marker);
      await expect(page.locator(".heading h1", { hasText: "Pane layout" })).toBeVisible();
      expect(await scrollTop(lesson)).toBe(60);
      await tab.close();

      // Every link to another origin in the lesson behaves the same way.
      const links = await lesson.locator(".lesson-html").first().locator("a[href]").evaluateAll((nodes) => nodes.map((a) => ({ href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") || "", hint: a.querySelector(".new-tab-hint")?.textContent || "", external: /^https?:/.test(a.getAttribute("href")) && new URL(a.href).origin !== location.origin })));
      const external = links.filter((l) => l.external);
      expect(external.map((l) => l.href).sort()).toEqual(["http://localhost:3999/status", "https://learn.microsoft.com/azure/search/", "https://learn.microsoft.com/training/"]);
      for (const link of external) expect(link, link.href).toMatchObject({ target: "_blank", rel: "noopener noreferrer nofollow", hint: " (opens in a new tab)" });
      // In-course links and section anchors stay in this tab.
      const internal = links.filter((l) => !l.external);
      expect(internal.length).toBeGreaterThan(3);
      for (const link of internal) expect(link, link.href).toMatchObject({ target: null, rel: "", hint: "" });
      const pages = context.pages().length;
      await lesson.getByRole("link", { name: "check questions", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Check questions", exact: true })).toBeInViewport();
      await expect.poll(() => scrollTop(lesson)).toBeGreaterThan(300);
      await lesson.evaluate((n) => n.scrollTo(0, 0));
      await lesson.getByRole("link", { name: "first lesson", exact: true }).click();
      await expect(page.locator(".heading h1", { hasText: "Approved documents only" })).toBeVisible();
      expect(context.pages().length).toBe(pages);
      expect(page.url()).toBe(url);
      await expectPageFixed(page);
    });

    test(`every new-tab link in the workshop UI is safe and says so (${size})`, async ({ page }) => {
      await page.goto("/");
      const audit = async (label) => {
        const problems = await page.evaluate(() =>
          [...document.querySelectorAll("a[href]")].flatMap((a) => {
            const href = a.getAttribute("href");
            let external = false;
            try {
              const url = new URL(href, location.href);
              external = /^https?:$/.test(url.protocol) && url.origin !== location.origin;
            } catch {}
            const blank = a.target === "_blank";
            const rel = (a.getAttribute("rel") || "").split(/\s+/);
            const says = /new tab/i.test(a.textContent + " " + (a.getAttribute("aria-label") || ""));
            const out = [];
            if (external && !blank) out.push("same-tab link to another origin: " + href);
            if (blank && !(rel.includes("noopener") && rel.includes("noreferrer"))) out.push("new-tab link without noopener noreferrer: " + href);
            if (blank && !says) out.push("new-tab link without a hint: " + href);
            return out;
          }),
        );
        expect(problems, label).toEqual([]);
      };
      await audit("home");
      await openStep(page, /03 /);
      await audit("lesson 03");
      await page.getByRole("tab", { name: "Tools", exact: true }).click();
      await page.getByLabel("Local tool").selectOption("external");
      await expect(page.getByRole("link", { name: "Open External fixture externally (opens in a new tab)" })).toBeVisible();
      await audit("tools panel");
      for (const name of ["Course home", "Guide", "Support", "Finish"]) {
        await page.getByRole("navigation", { name: "Course pages" }).getByRole("button", { name, exact: true }).click();
        await page.waitForTimeout(300);
        await audit(name);
        if (name === "Course home") await expect(page.getByRole("link", { name: "Ada Example (opens in a new tab)", exact: true })).toBeVisible();
      }
    });

    test(`a heading's accessible name is its own text (${size})`, async ({ page }) => {
      await page.goto("/");
      for (const step of [/40 Pane layout/, /02 Python approved documents/]) {
        await openStep(page, step);
        const headings = pane(page, "lesson").locator(".lesson-html").first().locator("h1, h2, h3, h4, h5, h6");
        const count = await headings.count();
        expect(count).toBeGreaterThan(1);
        for (let i = 0; i < count; i++) {
          const heading = headings.nth(i);
          const text = (await heading.evaluate((n) => { const c = n.cloneNode(true); c.querySelectorAll(".new-tab-hint").forEach((x) => x.remove()); return c.textContent; })).replace(/\s+/g, " ").trim();
          expect(text).not.toMatch(/Link to|#$/);
          // The computed accessible name is the visible text, plus the hint of a link inside it.
          const name = await heading.evaluate((n) => n.textContent.replace(/\s+/g, " ").trim());
          await expect(heading).toHaveAccessibleName(name);
          expect(name.replace(" (opens in a new tab)", "")).toBe(text);
          expect(await heading.locator("a.heading-anchor, [aria-label]").count()).toBe(0);
        }
      }
      await openStep(page, /40 Pane layout/);
      const lesson = pane(page, "lesson");
      await expect(lesson.getByRole("heading", { name: "Check questions", exact: true })).toHaveCount(1);
      await expect(lesson.getByRole("heading", { name: /Link to/ })).toHaveCount(0);
      await expect(lesson.getByRole("heading", { name: "Concept", exact: true, level: 2 })).toHaveCount(1);
      // The section link is still there, beside the heading, with its own name.
      const anchor = lesson.getByRole("link", { name: "Link to section: Check questions", exact: true });
      await expect(anchor).toHaveAttribute("href", "#h-check-questions");
      await anchor.focus();
      await expect(anchor).toBeVisible();
      expect(await anchor.evaluate((n) => getComputedStyle(n).opacity)).not.toBe("0");
      await page.keyboard.press("Enter");
      await expect(lesson.getByRole("heading", { name: "Check questions", exact: true })).toBeInViewport();
      await expectPageFixed(page);
    });

    test(`no raw placeholder, variable name or "undefined" appears in the UI (${size})`, async ({ page }) => {
      await page.goto("/");
      const RAW = /\$[A-Z_]+|\{\{|\}\}|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/;
      const scan = async (label) => {
        // Everything the engine itself writes: visible text, labels, titles,
        // placeholders and options. Course-authored content and code are not UI strings.
        const strings = await page.evaluate(() => {
          const authored = ".lesson-html, pre, code, textarea, .notice, .diff-view, .tutor-conversation, .palette-option .detail, iframe";
          const body = document.body.cloneNode(true);
          body.querySelectorAll(authored).forEach((n) => n.remove());
          const out = [body.textContent.replace(/\s+/g, " ")];
          for (const n of document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
            if (n.closest(authored)) continue;
            for (const attr of ["aria-label", "title", "placeholder", "alt"]) if (n.hasAttribute(attr)) out.push(n.getAttribute(attr));
          }
          for (const option of document.querySelectorAll("option")) out.push(option.textContent);
          out.push(document.title);
          return out;
        });
        for (const text of strings) expect(text.match(RAW)?.[0] ?? null, label + ": " + text.slice(0, 160)).toBeNull();
      };
      await scan("home");
      await openStep(page, /40 Pane layout/);
      await scan("lesson");
      // The editor picker names editors for people.
      const picker = page.getByLabel("Editor", { exact: true });
      const options = await picker.locator("option").allTextContents();
      expect(options).toContain("Your editor (VS Code)");
      for (const option of options) expect(option).toMatch(/^[A-Z][A-Za-z .()-]+$/);
      await picker.selectOption({ label: "Your editor (VS Code)" });
      await expect(picker.locator("option:checked")).toHaveText("Your editor (VS Code)");
      for (const tab of ["Lab description", "Playground", "Problem", "Solution", "Diff"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await page.waitForTimeout(250);
        await scan("code view " + tab);
      }
      await page.getByRole("tab", { name: "Playground", exact: true }).click();
      for (const tab of ["Preview", "Tools", "Console", "Test results", "Actions", "Processes", "Saved", "Update", "Tutor"]) {
        await page.getByRole("tablist", { name: "Output panels" }).getByRole("tab", { name: new RegExp("^" + tab) }).click();
        await page.waitForTimeout(250);
        await scan("output panel " + tab);
      }
      await page.keyboard.press("Control+Shift+P");
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
      await scan("command palette");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
      await scan("shortcuts dialog");
      await page.keyboard.press("Escape");
      for (const name of ["Course home", "Guide", "Support", "Finish", "Preferences"]) {
        await page.getByRole("navigation", { name: "Course pages" }).getByRole("button", { name, exact: true }).click();
        await page.waitForTimeout(300);
        await scan(name);
      }
    });

    test(`header actions are icon buttons with a name, a tooltip and their shortcut; the connection status is a dot (${size})`, async ({ page }) => {
      // Machines with only a loopback interface report navigator.onLine = false.
      await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "onLine", { get: () => true }));
      await page.goto("/");
      await openStep(page, /40 Pane layout/);
      const mod = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"));
      for (const [name, tip, keys] of [["Commands", "Command palette", mod + " K"], ["Shortcuts", "Keyboard shortcuts", "?"]]) {
        const button = page.locator(".topbar").getByRole("button", { name, exact: true });
        await expect(button).toHaveAccessibleName(name);
        await expect(button).toHaveAccessibleDescription(tip + " " + keys);
        // An icon, no text, and a square of the control height.
        expect(await button.evaluate((n) => [n.textContent, n.querySelectorAll("svg.icon[aria-hidden=true]").length, n.getBoundingClientRect().width, n.getBoundingClientRect().height])).toEqual(["", 1, 32, 32]);
        const tooltip = page.getByRole("tooltip", { name: tip });
        await expect(tooltip).toBeHidden();
        await button.hover();
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toContainText(tip);
        await expect(tooltip.locator("kbd")).toHaveText(keys.split(" "));
        // The tooltip is inside the viewport and does not cover its button.
        const [b, t] = [await button.boundingBox(), await tooltip.boundingBox()];
        expect(t.y).toBeGreaterThanOrEqual(b.y + b.height);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(viewport.width);
        await page.mouse.move(5, viewport.height - 5);
        await expect(tooltip).toBeHidden();
        // Keyboard focus shows it too, and Escape hides it.
        await button.focus();
        await expect(tooltip).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(tooltip).toBeHidden();
        await button.blur();
      }
      // One icon set: every icon is the same size and stroke.
      const icons = await page.locator("svg.icon").evaluateAll((nodes) => [...new Set(nodes.map((n) => [n.getAttribute("viewBox"), n.getAttribute("stroke-width"), getComputedStyle(n).width, getComputedStyle(n).height].join("|")))]);
      expect(icons).toEqual(["0 0 16 16|1.5|16px|16px"]);
      // Connected: a dot; the words are its tooltip and its accessible name.
      const status = page.locator(".connection-status");
      await expect(status).toHaveText("Connected");
      const dot = status.getByRole("button", { name: "Connected", exact: true });
      const words = status.locator(".tooltip");
      expect((await dot.boundingBox()).width).toBeLessThanOrEqual(36);
      expect(await words.evaluate((n) => n.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
      await dot.hover();
      await expect.poll(() => words.evaluate((n) => n.getBoundingClientRect().width)).toBeGreaterThan(40);
      await page.mouse.move(5, viewport.height - 5);
      await dot.focus();
      await expect.poll(() => words.evaluate((n) => n.getBoundingClientRect().width)).toBeGreaterThan(40);
      // Not connected: the status is written out beside the dot.
      await page.route("**/api/health", (route) => route.abort());
      await dot.click();
      await expect(status).toHaveText("Workshop server not reachable");
      await expect(status.locator(".status-text")).toBeVisible();
      await page.unroute("**/api/health");
      await status.getByRole("button").click();
      await expect(status).toHaveText("Connected");
    });

    for (const theme of THEMES)
      test(`dropdowns are one component with button geometry and readable colours in the ${theme} theme (${size})`, async ({ page }) => {
        await page.goto("/");
        await putPreferences(page, { theme });
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await openStep(page, /40 Pane layout/);
        const measure = () =>
          page.evaluate(() => {
            const lum = (c) => {
              const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v = Number(v) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
            return [...document.querySelectorAll("select")].filter((s) => s.getClientRects().length).map((select) => {
              const r = select.getBoundingClientRect();
              const cs = getComputedStyle(select);
              const wrap = select.parentElement;
              const arrow = wrap.querySelector(".select-arrow");
              const a = arrow?.getBoundingClientRect();
              const row = select.closest(".file-tools, .app-panel-head, fieldset, .tools-panel");
              // Buttons on the same line of the same toolbar.
              const neighbours = [...(row?.querySelectorAll("button") || [])].map((b) => b.getBoundingClientRect()).filter((b) => b.height && b.top < r.bottom && b.bottom > r.top);
              return {
                label: select.getAttribute("aria-label"),
                component: wrap.classList.contains("select") && Boolean(arrow),
                appearance: cs.appearance,
                height: r.height,
                paddingLeft: parseFloat(cs.paddingLeft),
                paddingRight: parseFloat(cs.paddingRight),
                arrowInset: a ? r.right - a.right : -1,
                arrowGap: a ? a.left - (r.right - parseFloat(cs.paddingRight)) : -1,
                arrowCentre: a ? Math.abs((a.top + a.bottom) / 2 - (r.top + r.bottom) / 2) : 99,
                neighbours: neighbours.length,
                heightDelta: Math.max(0, ...neighbours.map((b) => Math.abs(b.height - r.height))),
                centreDelta: Math.max(0, ...neighbours.map((b) => Math.abs((b.top + b.bottom) / 2 - (r.top + r.bottom) / 2))),
                contrast: ratio(cs.color, cs.backgroundColor),
                borderContrast: ratio(cs.borderTopColor, cs.backgroundColor),
                arrowContrast: arrow ? ratio(getComputedStyle(arrow).borderBottomColor, cs.backgroundColor) : 0,
                font: cs.fontSize,
              };
            });
          });
        const check = (selects, label, minimum) => {
          expect(selects.length, label + ": dropdowns on screen").toBeGreaterThanOrEqual(minimum);
          for (const s of selects) {
            const where = `${label} › ${s.label}`;
            expect(s.component, where + " uses the select component").toBe(true);
            expect(s.appearance, where).toBe("none");
            expect(s.height, where + " height").toBeCloseTo(32, 1);
            expect(s.font, where + " font size").toBe("12px");
            expect(s.paddingLeft, where + " text inset").toBeGreaterThanOrEqual(10);
            // The arrow sits inside the right padding, clear of the edge and of the text.
            expect(s.arrowInset, where + " arrow inset from the edge").toBeGreaterThanOrEqual(10);
            expect(s.arrowGap, where + " arrow clear of the text").toBeGreaterThanOrEqual(6);
            expect(s.arrowCentre, where + " arrow vertical centre").toBeLessThanOrEqual(2);
            expect(s.heightDelta, where + " height equals neighbouring buttons").toBeLessThanOrEqual(0.5);
            expect(s.centreDelta, where + " aligned with neighbouring buttons").toBeLessThanOrEqual(0.5);
            expect(s.contrast, where + " text contrast").toBeGreaterThanOrEqual(4.5);
            expect(s.borderContrast, where + " border contrast").toBeGreaterThanOrEqual(3);
            expect(s.arrowContrast, where + " arrow contrast").toBeGreaterThanOrEqual(3);
          }
          return selects;
        };
        await page.getByRole("tab", { name: "Playground", exact: true }).click();
        const playground = check(await measure(), "playground", 2);
        expect(playground.map((s) => s.label)).toEqual(expect.arrayContaining(["Project file", "Editor"]));
        expect(playground.filter((s) => s.neighbours > 0).length).toBeGreaterThanOrEqual(2);
        await page.getByRole("tab", { name: "Problem", exact: true }).click();
        await expect(page.getByLabel("Reference file")).toBeVisible();
        check(await measure(), "problem", 2);
        await page.getByRole("tab", { name: "Diff", exact: true }).click();
        await expect(page.getByLabel("Context lines")).toBeVisible();
        const diff = check(await measure(), "diff", 6);
        expect(diff.find((s) => s.label === "Context lines").neighbours).toBeGreaterThan(0);
        await page.getByRole("tab", { name: "Playground", exact: true }).click();
        await page.getByRole("tab", { name: "Tools", exact: true }).click();
        await expect(page.getByLabel("Local tool")).toBeVisible();
        check(await measure(), "tools", 3);
        await page.getByRole("navigation", { name: "Course pages" }).getByRole("button", { name: "Preferences", exact: true }).click();
        check(await measure(), "preferences", 3);
        // No bare select is left anywhere in the UI.
        expect(await page.locator("select").evaluateAll((nodes) => nodes.filter((n) => !n.parentElement.classList.contains("select")).length)).toBe(0);
      });

    for (const theme of THEMES)
      test(`axe: no WCAG A/AA violations in the ${theme} theme with panes scrolled (${size})`, async ({ page }) => {
        await page.goto("/");
        await putPreferences(page, { theme });
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const axe = async (label) => {
          await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
          const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).options({ iframes: false }).analyze();
          const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 4).map((n) => n.target.join(" ") + (n.any?.[0]?.data?.fgColor ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}]` : "")).join(" | ")}`);
          expect(summary, label).toEqual([]);
        };
        await axe(theme + " home");
        await openStep(page, /40 Pane layout/);
        await axe(theme + " lesson, panes at the top");
        await pane(page, "lesson").evaluate((n) => n.scrollTo(0, n.scrollHeight / 2));
        await pane(page, "workbench").evaluate((n) => n.scrollTo(0, n.scrollHeight));
        await axe(theme + " lesson, panes scrolled");
        await page.getByRole("tab", { name: "Diff", exact: true }).click();
        await expect(page.getByLabel("Context lines")).toBeVisible();
        await axe(theme + " diff controls");
        await page.getByRole("tab", { name: "Playground", exact: true }).click();
        await page.getByRole("tab", { name: "Tools", exact: true }).click();
        await axe(theme + " tools panel");
        await page.getByRole("navigation", { name: "Course pages" }).getByRole("button", { name: "Preferences", exact: true }).click();
        await axe(theme + " preferences");
      });
  });
}

test.describe("lesson table of contents at 1366×768", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("the table of contents and the step header stay in view while the lesson scrolls; the highlight follows the section being read", async ({ page }) => {
    await page.goto("/");
    await openStep(page, /40 Pane layout/);
    await settled(page);
    const lesson = pane(page, "lesson");
    const toc = page.getByRole("navigation", { name: /On this page/ });
    const current = toc.locator('a[aria-current="location"]');
    const stepHeader = page.locator(".step-heading");
    await expect(toc.getByRole("link")).toHaveText(["Concept", "Read the training path and run the tests", "Check questions", "Further reading"]);
    await expect(current).toHaveText("Concept");
    // The bar is compact: one row.
    expect((await toc.boundingBox()).height).toBeLessThanOrEqual(40);
    // A banner that arrives in the header pushes everything down: measure the
    // step header from the bottom of the app header.
    const underHeader = async () => {
      const [step, app] = [await box(stepHeader), await box(page.locator(".app-header"))];
      return { top: step.top - app.bottom, height: step.height, left: step.left, right: step.right };
    };
    const headerBox = await underHeader();
    const readSection = async (name) => {
      // Bring the heading just under the bar, as when reading down to it.
      const delta = await lesson.getByRole("heading", { name, exact: true }).evaluate((n) => n.getBoundingClientRect().top - n.closest("[data-scroll-pane]").getBoundingClientRect().top - 60);
      await lesson.evaluate((n, d) => n.scrollBy(0, d), delta);
    };
    for (const name of ["Read the training path (opens in a new tab) and run the tests", "Check questions", "Concept"]) {
      await readSection(name);
      const link = name.replace(" (opens in a new tab)", "");
      await expect(current).toHaveText(link);
      await expect(current).toHaveCount(1);
      // The bar is stuck to the top of the pane, fully in view, above the text.
      const [bar, paneBox] = [await toc.boundingBox(), await lesson.boundingBox()];
      expect(Math.abs(bar.y - paneBox.y)).toBeLessThanOrEqual(2);
      await expect(toc).toBeInViewport({ ratio: 1 });
      await expect(current).toBeInViewport({ ratio: 1 });
      expect(await toc.evaluate((n) => { const r = n.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".lesson-toc") === n; })).toBe(true);
      // The current section is marked by more than colour.
      expect(await current.evaluate((n) => [Number(getComputedStyle(n).fontWeight) >= 700, getComputedStyle(n).borderBottomColor !== "rgba(0, 0, 0, 0)"])).toEqual([true, true]);
      // The step header has not moved.
      expect(await underHeader()).toEqual(headerBox);
    }
    // Scrolling part of the way into a section keeps its entry marked.
    await readSection("Check questions");
    await lesson.evaluate((n) => n.scrollBy(0, -700));
    await expect(current).toHaveText("Read the training path and run the tests");
    // The end of the lesson marks the last section, which is too short to reach the top.
    await lesson.evaluate((n) => n.scrollTo(0, n.scrollHeight));
    await expect(current).toHaveText("Further reading");
    await expect(toc).toBeInViewport({ ratio: 1 });
    await expect(stepHeader.getByRole("heading", { name: "Pane layout" })).toBeInViewport({ ratio: 1 });
    await expectPageFixed(page);
  });

  test("choosing a section scrolls only the lesson pane and moves focus to its heading", async ({ page }) => {
    await page.goto("/");
    await openStep(page, /40 Pane layout/);
    await settled(page);
    const lesson = pane(page, "lesson");
    const workbench = pane(page, "workbench");
    const toc = page.getByRole("navigation", { name: /On this page/ });
    await workbench.evaluate((n) => n.scrollTo(0, 80));
    const before = { workbench: await scrollTop(workbench), side: await scrollTop(sidebar(page)), url: page.url() };
    await toc.getByRole("link", { name: "Check questions", exact: true }).click();
    const heading = lesson.getByRole("heading", { name: "Check questions", exact: true });
    await expect(heading).toBeFocused();
    await expect(toc.locator('a[aria-current="location"]')).toHaveText("Check questions");
    // The heading lands just below the bar, not under it.
    await expect.poll(async () => { const [h, bar] = [await heading.boundingBox(), await toc.boundingBox()]; return Math.round(h.y - (bar.y + bar.height)); }).toBeLessThanOrEqual(24);
    const gap = await (async () => { const [h, bar] = [await heading.boundingBox(), await toc.boundingBox()]; return h.y - (bar.y + bar.height); })();
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(await scrollTop(lesson)).toBeGreaterThan(500);
    expect({ workbench: await scrollTop(workbench), side: await scrollTop(sidebar(page)), url: page.url() }).toEqual(before);
    await expectPageFixed(page);
    // Keyboard: Tab to the list, Enter on a section, focus lands on its heading with the shared ring.
    await toc.getByRole("link", { name: "Concept", exact: true }).focus();
    await page.keyboard.press("Tab");
    const second = toc.getByRole("link", { name: "Read the training path and run the tests", exact: true });
    await expect(second).toBeFocused();
    const ring = (locator) => locator.evaluate((n) => { const cs = getComputedStyle(n); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor]; });
    const linkRing = await ring(second);
    expect(linkRing.slice(0, 2)).toEqual(["solid", "2px"]);
    await page.keyboard.press("Enter");
    const target = lesson.getByRole("heading", { name: /^Read the training path/ });
    await expect(target).toBeFocused();
    expect(await ring(target)).toEqual(linkRing);
    await expect(toc.locator('a[aria-current="location"]')).toHaveText("Read the training path and run the tests");
    // One focus ring: the same width and colour on links, buttons, tabs, selects and the editor.
    const controls = [page.locator(".topbar").getByRole("button", { name: "Commands", exact: true }), page.getByRole("tab", { name: "Playground", exact: true }), page.getByLabel("Project file"), lesson.getByRole("link", { name: /Azure AI Search documentation/ }), page.getByRole("button", { name: /^40 Pane layout/ })];
    for (const control of controls) {
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      expect(await ring(control), await control.evaluate((n) => n.outerHTML.slice(0, 80))).toEqual(linkRing);
    }
  });

  test("on a narrow pane the table of contents collapses to one button that names the current section", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 768 });
    await page.goto("/");
    await putPreferences(page, { uiScale: 125 });
    await page.reload();
    await openStep(page, /40 Pane layout/);
    const lesson = pane(page, "lesson");
    const toc = page.getByRole("navigation", { name: /On this page/ });
    const toggle = toc.getByRole("button", { name: /On this page/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText("Concept");
    await expect(toc.getByRole("link").first()).toBeHidden();
    await lesson.getByRole("heading", { name: "Check questions", exact: true }).evaluate((n) => n.scrollIntoView({ block: "start" }));
    await expect(toggle).toContainText("Check questions");
    await expect(toggle).toBeInViewport({ ratio: 1 });
    // Focusing the bar never scrolls the lesson: the bar is always in view.
    const scrolled = await lesson.evaluate((n) => n.scrollTop);
    await toggle.focus();
    expect(await lesson.evaluate((n) => n.scrollTop)).toBe(scrolled);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toc.locator('a[aria-current="location"]')).toHaveText("Check questions");
    await toc.getByRole("link", { name: "Concept", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(lesson.getByRole("heading", { name: "Concept", exact: true })).toBeFocused();
    await expect(toggle).toContainText("Concept");
  });
});

test("text wraps without a lone last word: body text is pretty, headings and summaries are balanced", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await openStep(page, /40 Pane layout/);
  const style = (selector) => page.locator(selector).first().evaluate((n) => getComputedStyle(n).textWrapStyle);
  expect(await style(".lesson-html p")).toBe("pretty");
  expect(await style(".sidebar-footer")).toBe("pretty");
  expect(await style(".heading h1")).toBe("balance");
  expect(await style(".heading p")).toBe("balance");
  expect(await style(".lesson-html h2")).toBe("balance");
  expect(await style(".workbench-head p")).toBe("balance");
  expect(await style(".project-tree summary")).toBe("balance");
  // Code keeps its own line breaks.
  expect(await style(".lesson-html pre")).toBe("auto");
  expect(await page.locator(".lesson-html pre").first().evaluate((n) => getComputedStyle(n).whiteSpaceCollapse)).toBe("preserve");
  // The step summary uses the width of the content area and never ends on a single word.
  const summary = page.locator(".heading p");
  const lines = await summary.evaluate((n) => {
    const range = document.createRange();
    const text = n.firstChild;
    const words = [...text.textContent.matchAll(/\S+/g)];
    const tops = words.map((w) => { range.setStart(text, w.index); range.setEnd(text, w.index + w[0].length); return Math.round(range.getBoundingClientRect().top); });
    const byLine = new Map();
    for (const t of tops) byLine.set(t, (byLine.get(t) || 0) + 1);
    return [...byLine.values()];
  });
  expect(lines.length).toBeGreaterThanOrEqual(1);
  if (lines.length > 1) expect(lines.at(-1), "words on the last line of the summary").toBeGreaterThan(1);
  expect(await summary.evaluate((n) => getComputedStyle(n).maxWidth)).toBe("none");
});

test("small screens keep one scrolling page: the header is not fixed where space is short", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openStep(page, /40 Pane layout/);
  expect(await page.evaluate(() => [document.documentElement.scrollHeight > innerHeight, document.documentElement.scrollWidth <= innerWidth])).toEqual([true, true]);
  await page.evaluate(() => window.scrollTo(0, 800));
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(800);
  expect(await pane(page, "lesson").evaluate((n) => getComputedStyle(n).overflowY)).toBe("visible");
});

test("interface size: the app still fills the viewport and panes scroll at 125%", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await putPreferences(page, { uiScale: 125 });
  await page.reload();
  await openStep(page, /40 Pane layout/);
  await expectPageFixed(page);
  const lesson = pane(page, "lesson");
  expect((await box(lesson)).bottom).toBeLessThanOrEqual(900);
  await wheelOver(page, lesson, 500);
  await expect.poll(() => scrollTop(lesson)).toBeGreaterThan(300);
  await expectPageFixed(page);
});
