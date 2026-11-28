// Stage 4: command palette, shortcuts, theme, preferences, warning banner,
// connection status, scroll restoration and accessibility (axe), in a real
// browser. Every test restores the default preferences it changed.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const courseRoot = () => readFile(join(tmpdir(), "icode-browser-root.txt"), "utf8");
function guard(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  return problems;
}
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
async function resetPreferences(page) {
  await page.evaluate(async () => {
    localStorage.removeItem("icode:preferences");
    sessionStorage.clear();
    const { token } = await (await fetch("/api/session")).json();
    const body = { ui: { theme: "dark", uiScale: 100, editorFont: "system-mono", editorFontSize: 12, motion: "system", restoreScroll: true, dismissedWarnings: [], shortcuts: {} } };
    for (let i = 0; i < 20; i++) {
      const r = await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json", "x-icode-session": token }, body: JSON.stringify(body) });
      if (r.ok) return;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("could not reset preferences");
  });
}
const palette = (page) => page.getByRole("dialog", { name: "Command palette" });
async function openPalette(page) {
  await page.keyboard.press("Control+Shift+P");
  await expect(palette(page)).toBeVisible();
  return palette(page);
}
async function runFromPalette(page, query, option) {
  const dialog = await openPalette(page);
  await dialog.getByRole("combobox").fill(query);
  await expect(dialog.getByRole("option").first()).toContainText(option);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
}
async function axe(page, label) {
  // Colours are sampled as rendered: let entrance animations finish first.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Sandboxed app and diagram frames are course content on other origins.
    .options({ iframes: false })
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 4)
        .map((n) => n.target.join(" ") + (n.any?.[0]?.data?.fgColor ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}]` : ""))
        .join(" | ")}`,
  );
  expect(summary, label).toEqual([]);
}

test.afterEach(async ({ page }) => {
  if (page.url().startsWith("http://127.0.0.1:5173")) await resetPreferences(page).catch(() => {});
});

test("palette: keyboard-only search across lessons, commands and files, ARIA combobox, focus trap and restore", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /01 Approved/ })).toBeVisible();
  const commands = page.getByRole("button", { name: "Commands", exact: true });
  await commands.focus();
  await page.keyboard.press("Enter");
  const dialog = palette(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const listId = await input.getAttribute("aria-controls");
  await expect(page.locator("#" + listId)).toHaveAttribute("role", "listbox");
  // Focus stays inside while tabbing in both directions.
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await input.focus();
  // Fuzzy, top-level lesson search (Epic needs "Go to…" first).
  await input.fill("aprvd docs");
  const first = dialog.getByRole("option").first();
  await expect(first).toContainText("01 Approved documents only");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", await first.getAttribute("id"));
  await expect(first.locator("mark").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(commands).toBeFocused();
  // Run a lesson from the palette with the keyboard only.
  await page.keyboard.press("Control+k");
  await palette(page).getByRole("combobox").fill("#python");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".heading h1", { hasText: "Python approved documents" })).toBeVisible();
  // Files of the current playground, then a command with arrow keys.
  const files = await openPalette(page);
  await files.getByRole("combobox").fill("@main");
  await expect(files.getByRole("option").first()).toContainText("main.py");
  await expect(files.getByRole("option").first()).toContainText("File");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Project file")).toHaveValue("main.py");
  await runFromPalette(page, ">show test results", "Show test results");
  await expect(page.getByRole("tab", { name: "Test results" })).toHaveAttribute("aria-selected", "true");
  // Disabled commands say why and do nothing.
  const d2 = await openPalette(page);
  await d2.getByRole("combobox").fill(">save the current file");
  const disabled = d2.getByRole("option", { name: /Save the current file/ });
  await expect(disabled).toHaveAttribute("aria-disabled", "true");
  await expect(disabled).toContainText("Unavailable: nothing to save");
  await page.keyboard.press("Escape");
  expect(problems).toEqual([]);
});

test("palette shows crafted course, module, exercise, step and file names as text (no XSS)", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /01 Approved/ })).toBeVisible();
  const dialog = await openPalette(page);
  await dialog.getByRole("combobox").fill("crafted");
  const option = dialog.getByRole("option").filter({ hasText: "Crafted step" });
  await expect(option).toContainText('08 <img src=x onerror="window.__xss=10">Crafted step');
  await expect(option).toContainText("<script>window.__xss=11</script>Crafted module");
  await expect(option).toContainText('<svg onload="window.__xss=12">Crafted exercise');
  await expect(dialog.locator("img, script, svg")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").first()).toContainText("workspace is ready");
  const files = await openPalette(page);
  await files.getByRole("combobox").fill("@onerror");
  await expect(files.getByRole("option").first()).toContainText("<img src=x onerror=window.__xss=13>.mjs");
  await expect(files.locator("img, script, svg")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(problems).toEqual([]);
});

test("palette commands cannot skip a confirmation (window.confirm and the server's typed confirmation)", async ({ page }) => {
  const root = await courseRoot();
  await rm(join(root, ".icode-deployed"), { force: true });
  await page.goto("/");
  await openStep(page, /01 Approved/);
  const mutations = [];
  page.on("request", (r) => r.method() !== "GET" && mutations.push(new URL(r.url()).pathname));
  // Reset and "use solution" ask first; declining sends nothing.
  for (const [query, label] of [[">reset playground", "Reset playground to this step's problem"], [">use the solution", "Use the solution in the playground"]]) {
    const asked = new Promise((resolve) => page.once("dialog", (d) => resolve(d.message()) || d.dismiss()));
    await runFromPalette(page, query, label);
    expect(await asked).toMatch(/Reset this playground|Replace this playground/);
  }
  // "s p" is the same command.
  await page.locator(".heading h1").click();
  const asked = new Promise((resolve) => page.once("dialog", (d) => resolve(d.message()) || d.dismiss()));
  await page.keyboard.press("s");
  await page.keyboard.press("p");
  expect(await asked).toMatch(/Reset this playground/);
  await page.waitForTimeout(300);
  expect(mutations.filter((p) => ["/api/reset", "/api/replace-workspace"].includes(p))).toEqual([]);
  // A destructive course action from the palette still needs the typed word.
  await runFromPalette(page, ">deploy demo", "Run course action: Deploy demo");
  const confirm = page.getByRole("dialog", { name: /Confirm: Deploy demo/ });
  await expect(confirm).toBeVisible({ timeout: 15000 });
  const typed = confirm.getByLabel("Confirmation text");
  await expect(typed).toBeFocused();
  await expect(confirm.getByRole("button", { name: "Continue" })).toBeDisabled();
  await typed.fill("deploy-dem");
  await page.keyboard.press("Enter");
  await expect(confirm).toBeVisible();
  // The palette cannot be opened over the confirmation to work around it.
  await page.keyboard.press("Control+Shift+P");
  await expect(palette(page)).toHaveCount(0);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Action output")).toContainText("Deployment cancelled", { timeout: 15000 });
  expect(existsSync(join(root, ".icode-deployed"))).toBe(false);
});

test("shortcuts dialog, g-sequences, typing guard, Diff '?' and remapping with conflict checks", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await openStep(page, /01 Approved/);
  await page.locator(".heading h1").click();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Go to next step");
  await expect(dialog).toContainText("Open command palette");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused(); // only focusable: trapped
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(page.locator(".heading h1", { hasText: "Python approved documents" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.locator(".heading h1", { hasText: "Approved documents only" })).toBeVisible();
  // Typing "g n" in the editor types; it does not navigate.
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  const original = await editor.inputValue();
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("g n?");
  await expect(page.locator(".heading h1", { hasText: "Approved documents only" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toHaveValue(/g n\?$/);
  // Ctrl+S saves from inside the editor.
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Saved to the exercise-specific local playground file.")).toBeVisible();
  await editor.fill(original);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  // In the Diff tab, "?" keeps the diff's own help.
  await page.getByRole("tab", { name: "Diff", exact: true }).click();
  await page.locator(".diff-view").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  await page.keyboard.press("Control+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Remap "Go to next step" to j j with the keyboard; a taken binding is refused.
  await page.keyboard.press("g");
  await page.keyboard.press(",");
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await page.getByRole("button", { name: "Change shortcut for Go to next step" }).click();
  const recorder = page.getByRole("textbox", { name: /New shortcut for Go to next step/ });
  await expect(recorder).toBeFocused();
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Already used by “Go to course home”" })).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Control+w");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "reserves" })).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  const row = page.getByRole("row").filter({ hasText: "Go to next step" });
  await expect(row).toContainText("(custom)");
  await expect(page.locator(".pref-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to the lesson" }).click();
  await page.locator(".heading h1").click();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator(".heading h1", { hasText: "Python approved documents" })).toBeVisible();
  // The old binding no longer works; the remap survives a reload.
  await page.reload();
  await openStep(page, /01 Approved/);
  await page.locator(".heading h1").click();
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(page.locator(".heading h1", { hasText: "Approved documents only" })).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator(".heading h1", { hasText: "Python approved documents" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("theme: light, dark, high contrast and system; Shiki and Mermaid follow; fonts and motion apply; choice persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await openStep(page, /04 A counter/);
  const app = page.locator(".app");
  await expect(app).toHaveClass(/theme-dark/);
  const figure = page.locator(".lesson-panel figure.mermaid-diagram").first();
  await expect(figure).toHaveClass(/mermaid-rendered/, { timeout: 20000 });
  const mermaidFill = () =>
    page.frameLocator("figure.mermaid-diagram iframe").first().locator("svg .node rect, svg .node polygon, svg rect.basic").first().evaluate((n) => getComputedStyle(n).fill);
  const shikiColour = () => page.locator(".lesson-panel .shiki span[style]").first().evaluate((n) => getComputedStyle(n).color);
  const darkFill = await mermaidFill();
  const darkShiki = await shikiColour();
  await runFromPalette(page, ">theme light", "Theme: Light");
  await expect(app).toHaveClass(/theme-light/);
  await expect(app).not.toHaveClass(/\bdark\b/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(mermaidFill, { timeout: 15000 }).not.toBe(darkFill);
  await expect.poll(shikiColour).not.toBe(darkShiki);
  // System follows the OS, including "more contrast".
  await runFromPalette(page, ">theme system", "Theme: System");
  await expect(app).toHaveClass(/theme-light/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(app).toHaveClass(/theme-dark/);
  await page.emulateMedia({ colorScheme: "dark", contrast: "more" });
  await expect(app).toHaveClass(/theme-hc/);
  await page.emulateMedia({ colorScheme: "light", contrast: "no-preference" });
  // Preferences page: high contrast, editor font size, interface size, motion.
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByRole("radio", { name: "High contrast" }).check();
  await expect(app).toHaveClass(/theme-hc/);
  await page.getByLabel("Editor font size").selectOption("18");
  await page.getByLabel("Editor font", { exact: true }).selectOption("courier");
  await page.getByLabel("Interface size").selectOption("125");
  await page.getByRole("radio", { name: "Reduce motion" }).check();
  await expect(page.locator(".pref-status")).toContainText("Saved");
  await page.reload();
  await expect(app).toHaveClass(/theme-hc/);
  await expect(app).toHaveClass(/motion-reduce/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "high-contrast");
  await openStep(page, /01 Approved/);
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  await expect(editor).toHaveCSS("font-size", "18px");
  expect(await editor.evaluate((n) => getComputedStyle(n).fontFamily)).toMatch(/Courier/);
  expect(await app.evaluate((n) => getComputedStyle(n).zoom)).toBe("1.25");
  expect(await page.locator(".workbench").first().evaluate((n) => parseFloat(getComputedStyle(n).animationDuration))).toBeLessThan(0.001);
});

test("hostile preferences in localStorage or sent to the API are never applied", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "icode:preferences",
      JSON.stringify({ theme: "light</style><script>window.__xss=20</script>", editorFont: "x; } * { display: none } .y {", uiScale: "9999", editorFontSize: "1e9", shortcuts: { "nav.next": "<img src=x onerror=window.__xss=21>" } }),
    ),
  );
  await page.reload();
  const app = page.locator(".app");
  await expect(app).toHaveClass(/theme-dark/);
  const style = await app.getAttribute("style");
  expect(style).not.toMatch(/display|script|9999|1e9/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /01 Approved/ })).toBeVisible();
  const statuses = await page.evaluate(async () => {
    const { token } = await (await fetch("/api/session")).json();
    const out = [];
    for (const body of ['{"ui":{"theme":"red;}"}}', '{"ui":{"__proto__":{"x":1}}}', '{"ui":{"shortcuts":{"palette.open":"<b>"}}}', '{"ui":{"editorFontSize":"18"}}'])
      out.push((await fetch("/api/preferences", { method: "PUT", headers: { "content-type": "application/json", "x-icode-session": token }, body })).status);
    // Without the session token the UI origin is refused too (XHR is not
    // wrapped by session.js, which adds the token to fetch).
    out.push(
      await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", "/api/preferences");
        xhr.setRequestHeader("content-type", "application/json");
        xhr.onload = () => resolve(xhr.status);
        xhr.send('{"ui":{"theme":"light"}}');
      }),
    );
    return out;
  });
  expect(statuses).toEqual([400, 400, 400, 400, 403]);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(problems).toEqual([]);
});

test("connection status: server down banner with retry, recovery", async ({ page }) => {
  await page.goto("/");
  const status = page.locator(".connection-status");
  await expect(status).toHaveText("Connected");
  await page.route("**/api/health", (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const banner = page.getByRole("alert").filter({ hasText: "The workshop server is not reachable." });
  await expect(banner).toBeVisible();
  await expect(status).toHaveText("Workshop server not reachable");
  await expect(banner).toContainText(/Next automatic check in \d+ s/);
  await page.unroute("**/api/health");
  await banner.getByRole("button", { name: "Retry now" }).click();
  await expect(banner).toHaveCount(0);
  await expect(status).toHaveText("Connected");
});

test("warning banner when course exercise files change; dismiss and don't-warn-again", async ({ page }) => {
  const root = await courseRoot();
  const stray = join(root, "exercises", "03", "problem", "stray-edit.txt");
  await page.goto("/");
  try {
    await writeFile(stray, "edited in the wrong folder\n");
    await page.waitForTimeout(2200); // server-side cache
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const banner = page.getByRole("region", { name: /Warning: Files in the course’s exercises folder changed|Warning: Files in the course's exercises folder changed/ });
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner.getByRole("list", { name: "Changed files" })).toContainText("exercises/03/problem/stray-edit.txt");
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(banner).toBeVisible({ timeout: 15000 });
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/preferences") && r.request().method() === "PUT" && r.ok());
    await banner.getByRole("button", { name: "Don’t warn me again" }).click();
    await expect(banner).toHaveCount(0);
    await saved;
    await page.reload();
    await expect(page.getByRole("button", { name: /01 Approved/ })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(banner).toHaveCount(0);
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    await page.getByLabel("Warn when files in the course’s exercises folder change").check();
    await expect(banner).toBeVisible();
  } finally {
    await rm(stray, { force: true });
  }
});

test("scroll restoration returns to the previous position in a lesson, and can be turned off", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto("/");
  await openStep(page, /04 A counter/);
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(max).toBeGreaterThan(400);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(300);
  // Navigate with the palette: clicking the sidebar would scroll first.
  await runFromPalette(page, "#01", "01 Approved");
  await expect(page.locator(".heading h1", { hasText: "Approved documents only" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5);
  await runFromPalette(page, "#04", "04 A counter");
  await expect(page.locator(".heading h1", { hasText: /counter/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(390);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Restore scroll positions when returning to a lesson").uncheck();
  await page.getByRole("button", { name: "Back to the lesson" }).click();
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeLessThan(50);
});

test("OG image works offline and robots.txt disallows indexing", async ({ page, request }) => {
  const og = await request.get("/api/og.svg");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toMatch(/image\/svg\+xml/);
  const svg = await og.text();
  expect(svg).toContain("<svg");
  expect(svg).not.toMatch(/fonts\.googleapis|jsdelivr|<script/);
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /");
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "/api/og.svg");
});

for (const theme of ["dark", "light", "high-contrast"])
  test(`axe: no WCAG A/AA violations in the ${theme} theme (home, lesson, palette, shortcuts, preferences)`, async ({ page }) => {
    await page.goto("/");
    await putPreferences(page, { theme });
    await page.reload();
    await expect(page.getByRole("button", { name: /01 Approved/ })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await axe(page, theme + " home");
    await openStep(page, /01 Approved/);
    await axe(page, theme + " lesson");
    await openPalette(page);
    await palette(page).getByRole("combobox").fill("go");
    await axe(page, theme + " palette");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
    await axe(page, theme + " shortcuts dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    await axe(page, theme + " preferences");
  });

test("axe and visible focus with reduced motion; focus ring on every new control", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await openStep(page, /04 A counter/);
  expect(await page.locator(".workbench").first().evaluate((n) => parseFloat(getComputedStyle(n).animationDuration) || 0)).toBeLessThan(0.001);
  await axe(page, "reduced motion lesson");
  for (const name of ["Commands", "Shortcuts", "Preferences"]) {
    const control = page.getByRole("button", { name, exact: true });
    await control.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    expect(await control.evaluate((n) => getComputedStyle(n).outlineStyle)).toBe("solid");
    expect(parseFloat(await control.evaluate((n) => getComputedStyle(n).outlineWidth))).toBeGreaterThanOrEqual(2);
  }
});
