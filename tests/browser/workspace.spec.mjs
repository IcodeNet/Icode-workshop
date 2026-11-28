// In the browser: hooks, touched files, rich diffs (deep links,
// shortcuts, sync), saved playgrounds and the workshop update.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const problem01 = await readFile("examples/exercises/01/problem/index.mjs", "utf8");
const solution01 = await readFile("examples/exercises/01/solution/index.mjs", "utf8");

async function openLesson(page, name) {
  await page.getByRole("button", { name }).click();
  await expect(page.locator(".heading h1")).toBeVisible();
}
async function resetPlayground(page) {
  page.once("dialog", (d) => d.accept());
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await page.getByRole("button", { name: "Reset playground", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("Reset completed");
}

test("hooks report structured output; touched files track the step and reset single files", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await openLesson(page, /01 Approved/);
  await resetPlayground(page);
  const status = page.getByRole("status").first();
  await expect(status).toContainText("Hook post-set-playground (npm run playground:post): passed");
  await expect(status).toContainText("post-set hook reset 01 restart=false");
  await expect(status.locator(".ansi-fg-magenta").first()).toHaveText("post-set hook");
  await expect(status).toContainText("Previous playground saved");

  const touched = page.getByRole("list", { name: "Files for this step" });
  const indexRow = touched.getByRole("listitem").filter({ hasText: "index.mjs" }).first();
  await expect(indexRow).toContainText("not started");
  await expect(touched).toContainText("approved.test.mjs");
  await touched.getByRole("button", { name: "index.mjs", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  await expect(editor).toHaveValue(problem01);
  await editor.fill("export const approvedOnly = () => [] // mine\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(indexRow).toContainText("edited");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset index.mjs to problem" }).click();
  await expect(editor).toHaveValue(problem01);
  await expect(indexRow).toContainText("not started");
  expect(errors).toEqual([]);
});

test("rich diff: deep links, lesson links, keyboard shortcuts, whitespace and sync; never gated", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?diff=01.problem..01.solution&view=unified&file=index.mjs");
  await expect(page.getByRole("tab", { name: "Diff", exact: true })).toHaveAttribute("aria-selected", "true");
  const file = page.getByRole("region", { name: "Diff of index.mjs" });
  await expect(file).toContainText("modified");
  await expect(file.locator("table.diff-table.unified")).toBeVisible();
  await expect(file.locator(".diff-code.add")).toContainText("documents.filter");
  await expect(page.getByText(/log in|sign in/i)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Diff of approved.test.mjs" })).toContainText("deleted");

  // Keyboard shortcuts (ignored while typing in form fields).
  await page.locator(".diff-summary").click();
  await page.keyboard.press("u");
  await expect(file.locator("table.diff-table.split")).toBeVisible();
  await expect(file.locator("mark.word-change").first()).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByLabel("Diff keyboard shortcuts")).toContainText("next / previous change");
  await page.keyboard.press("w");
  await expect(page.getByLabel("Ignore whitespace changes")).toBeChecked();
  await expect(page).toHaveURL(/diff=01\.problem\.\.01\.solution.*ws=ignore/);
  await page.keyboard.press("j");
  await expect(page.locator(".diff-file.focused")).toHaveCount(1);
  await page.keyboard.press("n");
  await expect(page.locator('[data-hunk][aria-current="true"]')).toHaveCount(1);
  await page.getByLabel("Diff from version").focus();
  await page.keyboard.press("u");
  await expect(file.locator("table.diff-table.split")).toBeVisible();

  // Shortcut links: 01..02 is the step's solution against the next step's problem.
  await page.goto("/?diff=01..02");
  await expect(page.getByLabel("Diff from version")).toHaveValue("solution");
  await expect(page.getByLabel("Diff to lesson")).toHaveValue("02");
  await expect(page.getByLabel("Diff to version")).toHaveValue("problem");

  // Lesson diff link (DiffLink).
  await page.goto("/");
  await openLesson(page, /01 Approved/);
  await page.getByRole("article").getByRole("link", { name: "the step diff" }).click();
  await expect(page.getByLabel("Diff from version")).toHaveValue("problem");
  await expect(page.getByLabel("Diff to version")).toHaveValue("solution");

  // Sync one file from the solution into the playground.
  await page.getByLabel("Diff from version").selectOption("playground");
  const pgFile = page.getByRole("region", { name: "Diff of index.mjs" });
  await expect(pgFile).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Use 01.solution version of index.mjs in playground" }).click();
  await expect(page.getByRole("region", { name: "Diff of index.mjs" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await page.getByLabel("Project file").selectOption("index.mjs");
  await expect(page.getByRole("textbox", { name: "Playground code editor" })).toHaveValue(solution01);
  await expect(
    page.getByRole("list", { name: "Files for this step" }).getByRole("listitem").filter({ hasText: "index.mjs" }).first(),
  ).toContainText("matches solution");
  await page.screenshot({ path: "docs/screenshots/workshop-touched-files.png", fullPage: true });
  await page.getByRole("tab", { name: "Diff", exact: true }).click();
  await page.getByLabel("Diff from version").selectOption("problem");
  await expect(page.getByRole("region", { name: "Diff of index.mjs" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/workshop-diff.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("saved playgrounds: save, restore exactly, diff, pin and delete", async ({ page }) => {
  await page.goto("/");
  await openLesson(page, /01 Approved/);
  await resetPlayground(page);
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  await page.getByLabel("Project file").selectOption("index.mjs");
  await editor.fill("export const approvedOnly = (d) => d // attempt one\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await page.getByLabel("Saved playground label").fill("attempt one");
  await page.getByRole("button", { name: "Save playground", exact: true }).click();
  const table = page.getByRole("table", { name: "Saved playgrounds" });
  await expect(table.getByRole("row").filter({ hasText: "attempt one" })).toContainText("manual");

  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await editor.fill("export const approvedOnly = () => 'broken'\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Restore saved playground attempt one" }).click();
  await expect(page.getByLabel("Saved playground status")).toContainText("Restored.");
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await page.getByLabel("Project file").selectOption("index.mjs");
  await expect(editor).toHaveValue("export const approvedOnly = (d) => d // attempt one\n");

  // The broken version was saved automatically before the restore; diff it.
  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  const restoreRow = table.getByRole("row").filter({ hasText: "restore" }).first();
  await restoreRow.getByRole("button", { name: /^Diff saved playground/ }).click();
  await expect(page.getByLabel("Diff from version")).toHaveValue(/^saved\./);
  await expect(page.getByRole("region", { name: "Diff of index.mjs" })).toContainText("'broken'");

  await page.getByRole("tab", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: "Pin attempt one" }).click();
  await expect(page.getByRole("button", { name: "Unpin attempt one" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete saved playground attempt one" }).click();
  await expect(table.getByRole("row").filter({ hasText: "attempt one" })).toHaveCount(0);
  const auto = page.getByLabel("Save automatically before replacing the playground");
  await auto.uncheck();
  await expect(page.getByLabel("Saved playground status")).toContainText("Automatic saves off.");
  await auto.check();
  await expect(auto).toBeChecked();
});

test("workshop update: check, typed confirmation, fast-forward and post-update hook", async ({ page }) => {
  await page.goto("/");
  await openLesson(page, /03 Your first live preview/);
  await expect(page.getByRole("article")).not.toContainText("Updated upstream");
  // The server fetched once at startup, so a banner announces the update.
  const banner = page.getByRole("region", { name: "Workshop update" });
  await expect(banner).toContainText("1 update(s) available");
  await banner.getByRole("button", { name: "Review update" }).click();
  await expect(page.getByLabel("Update status")).toContainText("1 update(s) available");
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(page.getByLabel("Incoming commits")).toContainText("Upstream lesson fix");
  await expect(page.getByText("Lessons changed by this update: 03")).toBeVisible();
  await page.getByRole("button", { name: "Update workshop", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Update", exact: true });
  await expect(confirm).toBeDisabled();
  const stash = dialog.getByRole("checkbox");
  if (await stash.count()) await stash.check();
  await dialog.getByLabel("Confirmation text").fill("update");
  await confirm.click();
  await expect(page.getByLabel("Update result")).toContainText("Updated");
  await expect(page.getByLabel("Update result")).toContainText("Post-update hook: passed");
  await expect(page.getByLabel("Update output")).toContainText("post-update hook ran from");
  await expect(page.getByLabel("Update status")).toContainText("Up to date");
  await page.reload();
  await expect(page.getByRole("region", { name: "Workshop update" })).toHaveCount(0);
  await openLesson(page, /02 Python/);
  await openLesson(page, /03 Your first live preview/);
  await expect(page.getByRole("article")).toContainText("Updated upstream: previews now explain ports.");
});
