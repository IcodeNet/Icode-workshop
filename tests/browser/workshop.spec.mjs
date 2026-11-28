import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("Node and Python learner journeys, multi-file CRUD, persistence, compare and reset", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("FAIL");
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  await editor.fill(
    await readFile("examples/exercises/01/solution/index.mjs", "utf8"),
  );
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("PASS");
  page.once("dialog", (d) => d.accept("src/helper.mjs"));
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await editor.fill("export const helper = 42\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  page.once("dialog", (d) => d.accept("src/value.mjs"));
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByLabel("Project file")).toHaveValue("src/value.mjs");
  await page.getByRole("tab", { name: "Diff", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Diff of src/value.mjs" }),
  ).toContainText("deleted");
  await page.reload();
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByText("Project file tree", { exact: true }).click();
  await page.getByRole("button", { name: "value.mjs", exact: true }).click();
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await expect(editor).toHaveValue("export const helper = 42\n");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByLabel("Project file").locator("option"),
  ).not.toContainText(["src/value.mjs"]);
  await page.getByRole("button", { name: /02 Python/ }).click();
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("FAIL");
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await editor.fill(
    await readFile("examples/exercises/02/solution/main.py", "utf8"),
  );
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("PASS");
  await page.screenshot({
    path: "docs/screenshots/workshop-python.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Reset playground", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Reset completed");
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("FAIL");
  expect(errors).toEqual([]);
});

test("live preview starts, shows edited code, and stops; lesson remains visible", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  await expect(page.getByRole("article")).toContainText(
    "Connect a pure function",
  );
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Playground code editor" })
    .fill("export const message = () => 'Hello, Icode Workshop!'\n");
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("PASS");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Start app", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Live preview"]').locator("body"),
  ).toContainText("Hello, Icode Workshop!");
  await page.screenshot({
    path: "docs/screenshots/workshop-live-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop app", exact: true }).click();
  await expect(page.locator('iframe[title="Live preview"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark incomplete", exact: true }),
  ).toBeVisible();
});

test("unsaved navigation can be cancelled and mobile layout stays within viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  await editor.fill("// unsaved draft");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: /02 Python/ }).click();
  await expect(editor).toHaveValue("// unsaved draft");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /02 Python/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Python approved documents",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("local tools embed an allowed service and keep external-only services outside frames", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Fixture tool"]').getByRole("heading"),
  ).toHaveText("Local service fixture");
  await page.getByLabel("Local tool").selectOption("external");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open External fixture externally" }),
  ).toHaveAttribute("href", "http://127.0.0.1:4404/");
});

test("API rejects hostile browser origins, host headers and traversal", async ({
  request,
}) => {
  const origin = await request.post("http://127.0.0.1:4317/api/select", {
    headers: { origin: "https://untrusted.example" },
    data: { id: "01" },
  });
  expect(origin.status()).toBe(403);
  const host = await request.get("http://127.0.0.1:4317/api/exercises", {
    headers: { host: "untrusted.example" },
  });
  expect(host.status()).toBe(403);
  const path = await request.put("http://127.0.0.1:4317/api/file", {
    data: { id: "01", name: "../escape", code: "bad" },
  });
  expect(path.status()).toBe(400);
});

test("hippo, module navigation, independent reference execution and durable progress", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(page.getByAltText("Icode hippo")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "01 · Trusted retrieval" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Solution", exact: true }).click();
  await expect(page.getByLabel("Reference file")).toHaveValue("index.mjs");
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("PASS · solution");
  await page.getByRole("tab", { name: "Problem", exact: true }).click();
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("FAIL · problem");
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark incomplete", exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:5173");
  await other.getByRole("button", { name: /01 Approved/ }).click();
  await expect(
    other.getByRole("button", { name: "Mark incomplete", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("running indicator, streamed output, cancellation and keyboard save", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  page.once("dialog", (d) => d.accept("slow.test.mjs"));
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page
    .getByLabel("Playground code editor")
    .fill(
      'import test from "node:test"; test("slow", async () => { console.log("streaming marker"); await new Promise(r => setTimeout(r, 10000)); });',
    );
  await page.getByLabel("Playground code editor").press("Control+s");
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Run tests", exact: true }).click();
  await expect(page.getByLabel("Workshop activity")).toContainText(
    "Running playground tests",
  );
  // Node's reporter may buffer the slow file; earlier completed tests must stream before the run finishes.
  await expect(page.getByRole("status")).toContainText("approved");
  const overlapping = await page.request.put("/api/file", {
    data: {
      id: "01",
      name: "index.mjs",
      code: "// must not overwrite during a run",
    },
  });
  expect(overlapping.status()).toBe(409);
  await page.getByRole("button", { name: "Cancel test run" }).click();
  await expect(page.getByRole("status")).toContainText("Test run cancelled");
  await expect(page.getByLabel("Workshop activity")).toContainText("Ready");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
});

test("reference preview restart and backup restoration preserve the learner workspace", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  await page.getByRole("tab", { name: "Solution", exact: true }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Start app", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Live preview"]').locator("body"),
  ).toContainText("Hello, Icode Workshop!");
  await page.getByRole("button", { name: "Restart app", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Live preview"]').locator("body"),
  ).toContainText("Hello, Icode Workshop!");
  await page.getByRole("button", { name: "Stop app", exact: true }).click();
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  await page
    .getByLabel("Playground code editor")
    .fill('export const message = () => "My saved work";');
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("tab", { name: "Problem", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Use problem in playground", exact: true })
    .click();
  await expect(page.getByLabel("Playground code editor")).not.toHaveValue(
    /My saved work/,
  );
  const accept = (d) =>
    d.accept(d.type() === "prompt" ? d.defaultValue() : undefined);
  page.on("dialog", accept);
  await page
    .getByRole("button", { name: "Restore backup", exact: true })
    .click();
  await expect(page.getByLabel("Playground code editor")).toHaveValue(
    'export const message = () => "My saved work";',
  );
  page.off("dialog", accept);
});

test("diffs support other lessons and transcript remains alongside the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  await page.getByText("Lesson transcript", { exact: true }).click();
  await expect(page.getByRole("article")).toContainText(
    "A preview is a running local application.",
  );
  await page.getByRole("tab", { name: "Diff", exact: true }).click();
  await page.getByLabel("Diff from version").selectOption("problem");
  await page.getByLabel("Diff to lesson").selectOption("01");
  await expect(
    page.getByRole("region", { name: "Diff of index.mjs" }),
  ).toContainText("added");
});

test("unconfigured tutor is explicit and never fabricates an answer", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Tutor", exact: true }).click();
  await expect(page.getByText(/The tutor is not configured/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ask tutor", exact: true }),
  ).toHaveCount(0);
});

test("video playback, captions, progress export and editor URI use real resources", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  const video = page.getByLabel("Lesson video");
  await video.evaluate(async (element) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element) => element.currentTime))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator("track").evaluate((element) => element.readyState))
    .toBe(2);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export progress" }).click();
  const download = await downloadPromise,
    stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk;
  expect(Array.isArray(JSON.parse(content).completed)).toBeTruthy();
  const uri = await page.request.get("/api/editor?id=03&name=message.mjs");
  expect((await uri.json()).url).toMatch(/^vscode:\/\/file\//);
});

test("configured tutor UI handles a transport fixture and labels its data sharing", async ({
  page,
}) => {
  // Explicit UI transport fixture, not a real model-quality claim.
  await page.route("**/api/tutor", (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? { enabled: true }
          : { answer: "Fixture hint: inspect the approval field." },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Tutor", exact: true }).click();
  await expect(page.getByText(/Asking sends this lesson/)).toBeVisible();
  await page.getByLabel("Ask about this lesson").fill("Give me a hint");
  await page.getByRole("button", { name: "Ask tutor", exact: true }).click();
  await expect(page.getByLabel("Tutor conversation")).toContainText(
    "Fixture hint: inspect the approval field.",
  );
});
