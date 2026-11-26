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
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await expect(page.getByText("src/value.mjs — playground only")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByLabel("Project file").selectOption("src/value.mjs");
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
