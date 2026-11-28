import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "http://127.0.0.1:4317/api";
// The fixture gives lesson 03's preview a free port; read it, never assume 4403.
async function previewPort(request) {
  return (await (await request.get(API + "/exercise?id=03")).json()).preview.port;
}
// Resolves once nothing accepts connections on the port.
async function portReleased(port, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => (socket.destroy(), resolve(true)));
      socket.once("error", () => resolve(false));
    });
    if (!open) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Port " + port + " still in use");
}

test("course action requires typed confirmation, renders ANSI and drives the cost banner", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  // Opening a lesson can run the course's set-playground hook; wait for it.
  await expect(page.locator(".heading h1")).toHaveText("Approved documents only");
  const banner = page.getByRole("region", { name: "Course status" });
  await expect(banner).toHaveCount(0);
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  await expect(page.getByText("Creates billable demo resources")).toBeVisible();

  // Cancel sends an empty line; the script refuses on its own.
  await page.getByRole("button", { name: "Deploy demo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This creates billable resources.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  const output = page.getByRole("log", { name: "Action output" });
  await expect(output).toContainText("Deployment cancelled");
  await expect(page.getByLabel("Action run")).toContainText("failed");

  await page.getByRole("button", { name: "Deploy demo", exact: true }).click();
  const confirm = dialog.getByRole("button", { name: "Continue" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Confirmation text").fill("deploy-dem");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Confirmation text").fill("deploy-demo");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(output).toContainText("deployed");
  await expect(output).toContainText("ICODE_ACTION=1");
  await expect(output).not.toContainText("icode-confirm");
  await expect(output.locator(".ansi-fg-green").first()).toHaveText(
    "Planning deployment",
  );
  await expect(page.getByLabel("Action run")).toContainText("passed");
  await expect(banner).toContainText(
    "Demo resources are running and incur cost.",
  );
  await page.screenshot({
    path: "docs/screenshots/workshop-actions.png",
    fullPage: true,
  });

  // The banner persists across lessons and clears after teardown.
  await page.getByRole("button", { name: /02 Python/ }).click();
  await expect(banner).toBeVisible();
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Tear down demo", exact: true })
    .click();
  await expect(output).toContainText("torn down");
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a running action survives a page reload, re-attaches, and is only stopped by an explicit, warned cancel", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  await page.getByRole("button", { name: "Long job", exact: true }).click();
  const output = page.getByRole("log", { name: "Action output" });
  await expect(output).toContainText("step 2");
  const banner = page.getByRole("region", { name: "Course status" });
  await expect(banner).toContainText("Long job");
  await page.reload();
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Actions ●", exact: true }).click();
  // Re-attached: earlier output plus new output, still running.
  await expect(output).toContainText("step 1");
  await expect(output).toContainText("step 8");
  await expect(page.getByLabel("Action run")).toContainText("running");
  await expect(
    page.getByText("keeps running if you reload or close this tab"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("can leave cloud resources running");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Action run")).toContainText("running");
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Cancel action", exact: true })
    .click();
  await expect(page.getByLabel("Action run")).toContainText("cancelled", {
    timeout: 15000,
  });
  await expect(output).toContainText("cleaning up after cancel");
  await expect(banner).toHaveCount(0);
});

test("the cost banner fails closed when indicators cannot be checked", async ({
  page,
}) => {
  await page.route("**/api/indicators", (route) =>
    route.fulfill({ status: 500, json: { error: "manifest unreadable" } }),
  );
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Course status" });
  await expect(banner).toContainText("Cost status unknown");
  await expect(banner).toContainText("manifest unreadable");
});

test("action endpoints reject unknown actions and unsolicited input", async ({
  request,
}) => {
  expect(
    (
      await request.post(API + "/actions/run", { data: { id: "node -e 1" } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(API + "/actions/input", {
        data: { runId: "x", text: "y" },
      })
    ).status(),
  ).toBe(400);
  const hostile = await request.post(API + "/actions/run", {
    headers: { origin: "https://untrusted.example" },
    data: { id: "deploy" },
  });
  expect(hostile.status()).toBe(403);
});

test("processes view lists previews and sidecars, shows sidecar logs and stops processes", async ({
  page,
  request,
}) => {
  const port = await previewPort(request);
  await page.goto("/");
  await page
    .getByRole("button", { name: /03 Your first live preview/ })
    .click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Start app", exact: true }).click();
  await expect(page.getByTitle("Live preview")).toBeVisible();
  await page.getByRole("tab", { name: "Processes", exact: true }).click();
  const table = page.getByRole("table", { name: "Running processes" });
  await expect(table).toContainText("Sidecar: mock-api");
  await expect(table).toContainText("Preview 03 (playground)");
  await expect(table).toContainText(String(port));
  await page.getByRole("button", { name: "Logs mock-api" }).click();
  const logs = page.getByRole("log", { name: "Sidecar logs" });
  await expect(logs).toContainText("[mock-api]");
  await expect(logs.locator(".ansi-fg-cyan").first()).toHaveText(
    "mock api listening",
  );
  await page
    .getByRole("button", { name: "Stop Preview 03 (playground)" })
    .click();
  await expect(table).not.toContainText("Preview 03");
  await portReleased(port);
  await page.getByRole("button", { name: "Restart mock-api" }).click();
  await expect(page.getByText(/running · pid \d+/)).toBeVisible();
});

test("a foreign process on the preview port can be freed after confirmation", async ({
  page,
  request,
}) => {
  const port = await previewPort(request);
  // Wait for an earlier preview's process tree to release the port.
  await portReleased(port);
  const squatter = spawn(
    process.execPath,
    [
      "-e",
      `require("node:net").createServer(s=>s.end("HTTP/1.1 200 OK\\r\\n\\r\\nsquatter")).listen(${port},"127.0.0.1",()=>console.log("up"))`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const closed = once(squatter, "close");
  try {
    await once(squatter.stdout, "data");
    await page.goto("/");
    await page
      .getByRole("button", { name: /03 Your first live preview/ })
      .click();
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "Start app", exact: true }).click();
    const conflict = page.getByRole("region", { name: "Port conflict" });
    await expect(conflict).toContainText(
      `Port ${port} is used by another process.`,
    );
    await conflict.getByRole("button", { name: `Free port ${port}…` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(String(squatter.pid));
    await expect(dialog).toContainText("127.0.0.1");
    await dialog
      .getByRole("button", { name: "Stop process " + squatter.pid })
      .click();
    await closed;
    await expect(conflict).toHaveCount(0);
    await page.getByRole("button", { name: "Start app", exact: true }).click();
    await expect(page.getByTitle("Live preview")).toBeVisible();
    await page.getByRole("button", { name: "Stop app", exact: true }).click();
  } finally {
    if (squatter.exitCode === null && squatter.signalCode === null)
      squatter.kill("SIGKILL");
  }
});

test("live reload updates a clean editor and flags conflicting unsaved edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await page.getByRole("tab", { name: "Playground", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Playground code editor" });
  await expect(editor).not.toHaveValue("");
  const original = await editor.inputValue();
  // Wait until the live-reload stream is connected, then an external writer
  // (another editor, an AI assistant) changes the file.
  await expect(page.locator('[data-live-reload="ready"]')).toHaveCount(1);
  await page.request.put("/api/file", {
    data: { id: "01", name: "index.mjs", code: "// changed on disk 1\n" },
  });
  await expect(editor).toHaveValue("// changed on disk 1\n");
  await editor.fill("// my unsaved edit\n");
  await page.request.put("/api/file", {
    data: { id: "01", name: "index.mjs", code: "// changed on disk 2\n" },
  });
  const notice = page.locator(".disk-change");
  await expect(notice).toContainText(
    "changed on disk while you have unsaved edits",
  );
  await expect(editor).toHaveValue("// my unsaved edit\n");
  await notice.getByRole("button", { name: "Load disk version" }).click();
  await expect(editor).toHaveValue("// changed on disk 2\n");
  await page.request.put("/api/file", {
    data: { id: "01", name: "index.mjs", code: original },
  });
  await expect(editor).toHaveValue(original);
});

test("launch editor spawns the configured editor and keeps the VS Code fallback", async ({
  page,
}) => {
  const log = join(tmpdir(), "icode-browser-editor.json");
  await rm(log, { force: true });
  await page.goto("/");
  await page.getByRole("button", { name: /01 Approved/ }).click();
  await expect(page.getByLabel("Editor", { exact: true })).toHaveValue(
    "override",
  );
  await expect(
    page.getByRole("button", { name: "Open in VS Code" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open in editor", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Opened index.mjs in ICODE_EDITOR",
  );
  await expect
    .poll(() => readFile(log, "utf8").catch(() => ""))
    .toMatch(/playgrounds/);
  const args = JSON.parse(await readFile(log, "utf8"));
  expect(args).toHaveLength(1);
  expect(args[0]).toMatch(
    /[\\/]\.workshop[\\/]playgrounds[\\/]01[\\/]index\.mjs$/,
  );
  const traversal = await page.request.post("/api/editor/launch", {
    data: { id: "01", name: "../../course.json" },
  });
  expect(traversal.status()).toBe(400);
});

test("setup check is quiet when installed and shows the exact install command otherwise", async ({
  page,
}) => {
  // The fixture course has its locked dependency installed.
  const report = await (await page.request.get("/api/doctor")).json();
  expect(
    report.checks.find((c) => c.name === "Course dependencies"),
  ).toMatchObject({ ok: true, status: "installed" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Choose a lab" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Setup check" })).toHaveCount(
    0,
  );
  // A missing install (the unit tests cover detection) is rendered with its fix command.
  await page.route("**/api/doctor", (route) =>
    route.fulfill({
      json: {
        ok: false,
        checks: [
          {
            name: "Course dependencies",
            ok: false,
            status: "missing",
            message: "Missing: icode-fixture-dependency",
            fix: 'cd "/course" && npm ci',
          },
        ],
      },
    }),
  );
  await page.reload();
  const setup = page.getByRole("region", { name: "Setup check" });
  await expect(setup).toContainText("Missing: icode-fixture-dependency");
  await expect(setup.locator("code")).toHaveText('cd "/course" && npm ci');
});
