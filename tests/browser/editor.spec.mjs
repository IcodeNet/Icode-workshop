// Workbench code: highlighted read-only views (Problem, Solution, Diff), the
// CodeMirror Playground editor (typing, Save, Run tests, Reset, undo, search,
// soft wrap, keyboard focus) and the large-file fallback, with axe in every
// theme. Step 09 carries one file per language (tests/browser/serve.mjs).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { editorText, expectEditor } from "./editor.mjs";

const SAMPLES = { "sample.ts": "ts", "sample.js": "js", "sample.json": "json", "sample.py": "py", "Sample.cs": "cs", "notes.md": "md", "config.yaml": "yaml" };

async function openStep09(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^09 Code samples/ }).first().click();
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
async function axe(page, label) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const results = await new AxeBuilder({ page }).include(".workbench").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).options({ iframes: false }).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => n.target.join(" ") + (n.any?.[0]?.data?.fgColor ? ` [${n.any[0].data.fgColor} on ${n.any[0].data.bgColor} = ${n.any[0].data.contrastRatio}]` : "")).join(" | ")}`,
  );
  expect(summary, label).toEqual([]);
}
const editor = (page) => page.getByRole("textbox", { name: "Playground code editor" });
async function openPlaygroundFile(page, name) {
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await page.getByLabel("Project file").selectOption(name);
  await expect(editor(page)).toBeVisible();
}

test.afterEach(async ({ page }) => {
  if (page.url().startsWith("http://127.0.0.1:5173")) await putPreferences(page, { theme: "dark", softWrap: false }).catch(() => {});
});

test("read-only views highlight ts, js, json, py, cs, md and yaml; diffs keep add/remove backgrounds", async ({ page }) => {
  await openStep09(page);
  await page.getByRole("tab", { name: "Problem", exact: true }).click();
  const view = page.locator("pre.code.highlighted");
  for (const [name, lang] of Object.entries(SAMPLES)) {
    await page.getByLabel("Reference file").selectOption(name);
    await expect(view, name).toHaveAttribute("data-language", lang);
    expect(await view.locator(".tok").count(), name + " tokens").toBeGreaterThan(1);
    const colours = await view.locator(".tok").evaluateAll((spans) => new Set(spans.map((s) => getComputedStyle(s).color)).size);
    expect(colours, name + " colours").toBeGreaterThan(1);
  }
  await page.getByRole("tab", { name: "Solution", exact: true }).click();
  await page.getByLabel("Reference file").selectOption("sample.ts");
  await expect(view).toHaveAttribute("data-language", "ts");
  await expect(view).toContainText("return `Hello ${name}`;");

  await page.goto("/?diff=09.problem..09.solution");
  const diff = page.getByRole("region", { name: "Diff of sample.js" });
  await expect(diff.locator(".diff-code.ctx .tok").first()).toBeVisible();
  const add = page.getByRole("region", { name: "Diff of Sample.cs" }).locator(".diff-code.add");
  await expect(add.locator(".tok").first()).toBeVisible();
  await expect(add.locator(".word-change")).toHaveText("3");
  expect(await add.first().evaluate((n) => getComputedStyle(n).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await page.getByRole("region", { name: "Diff of Sample.cs" }).locator(".diff-code.del").first().evaluate((n) => getComputedStyle(n).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("large files fall back to plain text in read-only views and the editor", async ({ page }) => {
  await openStep09(page);
  await page.getByRole("tab", { name: "Problem", exact: true }).click();
  await page.getByLabel("Reference file").selectOption("large.ts");
  await expect(page.getByRole("status").filter({ hasText: "Large file: shown as plain text" })).toBeVisible();
  await expect(page.locator("pre.code.highlighted")).toHaveAttribute("data-language", "plain");
  await expect(page.locator("pre.code.highlighted .tok")).toHaveCount(0);
  await openPlaygroundFile(page, "large.ts");
  await expect(page.locator(".code-editor")).toHaveAttribute("data-language", "plain");
  await expect(page.getByRole("status").filter({ hasText: "Large file: shown as plain text" })).toBeVisible();
  await expect(page.locator(".code-editor .cm-line").first()).toHaveText("export const n = 1;");
  expect(await page.locator(".code-editor [class*='tok-']").count()).toBe(0);
});

test("Playground editor: highlighting, typing, undo, search, soft wrap, Save, Run tests and Reset", async ({ page }) => {
  await openStep09(page);
  await openPlaygroundFile(page, "sample.ts");
  await expect(page.locator(".code-editor")).toHaveAttribute("data-language", "TypeScript");
  await expect(page.locator(".code-editor .tok-keyword").first()).toBeVisible();
  await expect(page.locator(".code-editor .cm-gutters")).toContainText("3");
  // Typing marks the file unsaved; undo takes it back.
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// typed");
  await expectEditor(page).toMatch(/\/\/ typed$/);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expectEditor(page).not.toMatch(/typed/);
  // Search opens inside the editor and closes with Escape.
  await page.keyboard.press("Control+f");
  await expect(page.locator(".cm-search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-search")).toHaveCount(0);
  // Soft wrap is a preference.
  await expect(page.locator(".code-editor .cm-content")).not.toHaveClass(/cm-lineWrapping/);
  await putPreferences(page, { softWrap: true });
  await openStep09(page);
  await openPlaygroundFile(page, "sample.ts");
  await expect(page.locator(".code-editor .cm-content")).toHaveClass(/cm-lineWrapping/);

  // Save, Run tests and Reset on the step's entry file.
  await openPlaygroundFile(page, "index.mjs");
  await expectEditor(page).toBe("export const value = 1;\n");
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(/FAIL/);
  await editor(page).fill("export const value = 2;\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to the exercise-specific local playground file.")).toBeVisible();
  const saved = await page.evaluate(async () => (await (await fetch("/api/file?id=09&name=index.mjs")).json()).code);
  expect(saved).toBe("export const value = 2;\n");
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(/^PASS/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset file to problem", exact: true }).click();
  await expectEditor(page).toBe("export const value = 1;\n");
  expect(await editorText(page)).toBe("export const value = 1;\n");
});

test("keyboard focus enters the editor, Tab indents, and Escape then Tab leaves it", async ({ page }) => {
  await openStep09(page);
  await openPlaygroundFile(page, "sample.ts");
  const content = page.locator(".code-editor .cm-content");
  await editor(page).focus();
  await expect(content).toBeFocused();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Tab");
  await expect(content).toBeFocused();
  await expectEditor(page).toMatch(/^\s+export function/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(content).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement && document.activeElement !== document.body)).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(content).toBeFocused();
  await page.keyboard.press("Control+z");
  await expectEditor(page).toMatch(/^export function/);
});

for (const theme of ["dark", "light", "high-contrast"])
  test(`axe: highlighted views and the editor pass WCAG A/AA in the ${theme} theme`, async ({ page }) => {
    await openStep09(page);
    await putPreferences(page, { theme });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: /^09 Code samples/ }).first().click();
    await openPlaygroundFile(page, "sample.ts");
    await expect(page.locator(".code-editor .tok-keyword").first()).toBeVisible();
    await axe(page, theme + " editor");
    await page.getByRole("tab", { name: "Problem", exact: true }).click();
    for (const name of Object.keys(SAMPLES)) {
      await page.getByLabel("Reference file").selectOption(name);
      await expect(page.locator("pre.code.highlighted")).toHaveAttribute("data-language", SAMPLES[name]);
      await axe(page, theme + " problem " + name);
    }
    await page.goto("/?diff=09.problem..09.solution");
    await expect(page.locator(".diff-code.add .tok").first()).toBeVisible();
    await axe(page, theme + " diff");
  });
