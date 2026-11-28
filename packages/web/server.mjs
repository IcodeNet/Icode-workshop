import { lessonDocuments } from "./lessons.mjs";
import { handleContent } from "./content-routes.mjs";
import { handleQuestions, QUESTION_ROUTES } from "./question-routes.mjs";
import { handleUx } from "./ux-routes.mjs";
import { createSandboxServer } from "./sandbox.mjs";
import { SANDBOX_PORT } from "./content-config.mjs";
import { integrationStatus, readIntegration } from "./integrations.mjs";
import { planMigration, migrateWorkspace } from "./migration.mjs";
import { askTutor, tutorConfig } from "./tutor.mjs";
import { courseConfig, readProgress, updateProgress } from "./course.mjs";
import { executionWorkspace } from "./variants.mjs";
import { startPreview, stopPreview, stopAllPreviews } from "./previews.mjs";
import {
  courseOperations,
  indicatorStatus,
  startAction,
  actionRun,
  lastActionRunId,
  subscribeAction,
  sendActionInput,
  cancelAction,
  currentAction,
  stopActionsForShutdown,
} from "./operations.mjs";
import {
  registerProcess,
  listProcesses,
  stopProcess,
  portHolder,
  killAllNow,
} from "./processes.mjs";
import {
  startSidecars,
  listSidecars,
  sidecarLogs,
  restartSidecar,
  stopSidecar,
  stopAllSidecars,
  killAllSidecarsNow,
} from "./sidecars.mjs";
import { watchPlayground, closeAllWatchers } from "./watch.mjs";
import { detectEditors, publicEditors, launchEditor } from "./editors.mjs";
import { doctor } from "./setup.mjs";
import { lstat } from "node:fs/promises";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  listFiles,
  variantRoot,
  validateFile,
  assertSafePath,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  renameProjectFile,
} from "./files.mjs";
import { labConfig, testLab } from "./runtime.mjs";
import { stepLayout } from "../core/layout.mjs";
import { withPlaygroundHooks } from "./playground-ops.mjs";
import {
  listSaved,
  savePlayground,
  updateSaved,
  deleteSaved,
  restoreSaved,
  savedFilesPath,
  readPreferences,
  writePreferences,
} from "./saved-playgrounds.mjs";
import { diffSides, diffFile, touchedFiles, syncFile, parseSide, validateRelativePath } from "./diff.mjs";
import { updateStatus, checkForUpdates, applyUpdate } from "./update.mjs";
import { fileURLToPath } from "node:url";
import { validateId } from "../core/index.mjs";
import {
  resetWorkspace,
  replaceWorkspace,
  listBackups,
  selectWorkspace,
  saveWorkspace,
  workspacePath,
} from "./workspaces.mjs";

const root = resolve(
  process.env.WORKSHOP_CONTENT ??
    fileURLToPath(new URL("../../examples", import.meta.url)),
);
const port = Number(process.env.WORKSHOP_API_PORT ?? 4317);
const host = "127.0.0.1";
const allowedOrigin = "http://127.0.0.1:5173";
// Course content (apps, browser tests, Mermaid, images) is served
// from this separate, read-only origin, which the API refuses.
const sandboxOrigin = "http://127.0.0.1:" + SANDBOX_PORT;
let sandboxServer = null;
// Per-process session token. Browser requests that mutate (they carry Origin
// or Fetch Metadata) must echo it in x-icode-session; the UI fetches it from
// /api/session, which only a same-origin page can read. Non-browser clients
// (CLI, tests) send neither header and are unaffected.
const sessionToken = randomBytes(32).toString("hex");
function hasSessionToken(req) {
  const given = Buffer.from(String(req.headers["x-icode-session"] ?? ""));
  const expected = Buffer.from(sessionToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
const json = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allowedOrigin,
    vary: "Origin",
  });
  res.end(JSON.stringify(body));
};
async function readBody(req) {
  if (req.parsedBody !== undefined) return req.parsedBody;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request too large");
  }
  return (req.parsedBody = JSON.parse(body || "{}"));
}
async function readText(path) {
  return readFile(path, "utf8");
}
async function load(id) {
  validateId(id);
  const base = join(root, "exercises", id);
  const config = await labConfig(root, id);
  const documents = await lessonDocuments(root, id, { sandboxOrigin });
  const main = documents.find((d) => d.title === "Problem lesson") || documents[0];
  const instructions = main?.content || config.description;
  return {
    id,
    ...config,
    instructions,
    // Sanitised, highlighted HTML of the main lesson.
    lesson: main ? { path: main.path, html: main.html, toc: main.toc, warnings: main.warnings } : null,
    documents,
    topic: "AI engineering",
    problem: await readProjectFile(root, id, config.entry, "problem"),
    solution: await readProjectFile(root, id, config.entry, "solution"),
  };
}
let mutationActive = false;
// Registry ids of the processes started by the request holding the gate (a
// test run), so that exactly those can be stopped while it runs.
const gateProcessIds = new Set();
// Course-level operations that must not overlap a running action (it is
// detached from any request and may run for a long time). Learner work in
// playgrounds (lessons, files, tests, previews) stays available meanwhile.
const ACTION_EXCLUSIVE = new Set([
  "/api/actions/run",
  "/api/sidecars/restart",
  "/api/sidecars/stop",
  "/api/ports/free",
  "/api/processes/stop",
  "/api/update/check",
  "/api/update/apply",
]);
const ownGate = (id) => gateProcessIds.add(id);
const diffOptions = (params) => ({
  whitespace: params.get("ws") === "ignore",
  context: params.get("context") === "all" ? -1 : Number(params.get("context") ?? 3),
});
async function playgroundExists(id) {
  try {
    return (await lstat(workspacePath(root, id))).isDirectory();
  } catch {
    return false;
  }
}
/**
 * Mutation gate. Exempt: answering/cancelling the running action and stopping
 * the specific process that holds the gate (the action or the running test).
 * Course-level operations wait for a running action; everything else is
 * serialised by the request gate.
 */
async function gateDecision(req, pathname) {
  if (["GET", "HEAD"].includes(req.method)) return "none";
  const action = currentAction();
  if (action && ["/api/actions/input", "/api/actions/cancel"].includes(pathname))
    return "exempt";
  if (pathname === "/api/processes/stop") {
    const { id } = await readBody(req);
    if ((action && id === action.processId) || gateProcessIds.has(id))
      return "exempt";
  }
  // Check questions touch only progress.json (serialised by its own queue):
  // a learner can answer them while a test run or hook holds the gate.
  if (QUESTION_ROUTES.has(pathname)) return "exempt";
  if (action && ACTION_EXCLUSIVE.has(pathname))
    return "A course action is running. Wait for it to finish or cancel it first.";
  if (mutationActive)
    return "Another workshop operation is still running. Please retry when it finishes.";
  return "gated";
}
// One background fetch at startup feeds the update banner (offline-safe;
// ICODE_UPDATE_CHECK=0 disables it). Update routes wait for it.
let startupCheck = Promise.resolve();
let lastPortScan = 0;
let eventStreams = 0;
const MAX_EVENT_STREAMS = 16;
async function previewPorts() {
  const { ids } = await courseConfig(root);
  const ports = new Set();
  for (const id of ids) {
    const port = (await labConfig(root, id)).preview?.port;
    if (port) ports.add(port);
  }
  return [...ports];
}
function ndjson(res) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-store",
  });
  return (event) => {
    if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
  };
}
const server = createServer(async (req, res) => {
  // The API is never a document or a frame.
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  res.setHeader("x-content-type-options", "nosniff");
  if (!["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host))
    return json(res, 403, { error: "Host denied" });
  if (req.headers.origin && req.headers.origin !== allowedOrigin)
    return json(res, 403, { error: "Origin denied" });
  // Browsers omit Origin on simple cross-site GETs (<img>, <script>), but send
  // Fetch Metadata. Only same-origin pages (the UI via its proxy) and direct
  // navigation/tools may call the API.
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site))
    return json(res, 403, { error: "Cross-site request denied" });
  const browser = req.headers.origin !== undefined || site !== undefined;
  if (browser && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !hasSessionToken(req))
    return json(res, 403, { error: "Missing or invalid workshop session" });
  if (req.method === "GET" && req.url === "/api/session") {
    // Only a same-origin script (the UI through its proxy) may read the token.
    if (site !== "same-origin" || req.headers["sec-fetch-dest"] !== "empty")
      return json(res, 403, { error: "Session token is only available to the workshop UI" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { token: sessionToken });
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type, x-icode-session",
    });
    return res.end();
  }
  let ownsMutation = false;
  try {
    const url = new URL(req.url, "http://localhost");
    const gate = await gateDecision(req, url.pathname);
    if (gate !== "none" && gate !== "exempt") {
      if (gate !== "gated") return json(res, 409, { error: gate });
      mutationActive = true;
      ownsMutation = true;
    }
    if (
      ["/api/start", "/api/stop"].includes(url.pathname) &&
      req.method === "POST"
    ) {
      const { id, variant } = await readBody(req);
      validateId(id);
      return json(
        res,
        200,
        url.pathname === "/api/start"
          ? await startPreview(root, id, variant)
          : await stopPreview(id),
      );
    }
    if (url.pathname === "/api/operations" && req.method === "GET") {
      const { actions, sidecars } = await courseOperations(root);
      return json(res, 200, {
        actions,
        sidecars: sidecars.map((sidecar) => ({
          ...sidecar,
          ...listSidecars().find((item) => item.name === sidecar.name),
        })),
        running: currentAction(),
        lastRunId: lastActionRunId(),
      });
    }
    if (url.pathname === "/api/actions/run" && req.method === "POST") {
      // Starts the action detached from this request: closing or reloading the
      // tab never cancels it. Follow it with /api/actions/stream.
      const { id } = await readBody(req);
      if (typeof id !== "string") throw new Error("Unknown course action");
      return json(res, 200, await startAction(root, id));
    }
    if (url.pathname === "/api/actions/run" && req.method === "GET") {
      const run = actionRun(url.searchParams.get("runId") || undefined);
      return run ? json(res, 200, run) : json(res, 404, { error: "No action run" });
    }
    if (url.pathname === "/api/actions/stream" && req.method === "GET") {
      const runId = url.searchParams.get("runId") || currentAction()?.runId;
      if (!runId) return json(res, 404, { error: "No action run" });
      let events = [];
      let deliver = (event) => events.push(event);
      const { snapshot, unsubscribe } = subscribeAction(runId, (event) =>
        deliver(event),
      );
      const send = ndjson(res);
      send({ type: "snapshot", ...snapshot });
      for (const event of events) send(event);
      const finished = ["passed", "failed", "cancelled", "error"].includes(
        snapshot.status,
      );
      if (finished || events.some((e) => e.type === "result")) {
        unsubscribe();
        return res.end();
      }
      deliver = (event) => {
        send(event);
        if (event.type === "result") {
          unsubscribe();
          res.end();
        }
      };
      res.on("close", unsubscribe);
      return;
    }
    if (url.pathname === "/api/actions/input" && req.method === "POST") {
      const { runId, text } = await readBody(req);
      return json(res, 200, sendActionInput(runId, text));
    }
    if (url.pathname === "/api/actions/cancel" && req.method === "POST") {
      const { runId } = await readBody(req);
      const running = currentAction();
      if (!running || running.runId !== runId)
        throw new Error("No matching action is running");
      // Graceful: SIGINT, then SIGKILL after the action's grace period.
      cancelAction(runId).catch(() => {});
      return json(res, 200, { cancelling: true });
    }
    if (url.pathname === "/api/indicators" && req.method === "GET")
      return json(res, 200, await indicatorStatus(root));
    if (url.pathname === "/api/processes" && req.method === "GET")
      return json(res, 200, {
        processes: listProcesses(),
        previewPorts: await previewPorts(),
      });
    if (url.pathname === "/api/processes/stop" && req.method === "POST") {
      const { id } = await readBody(req);
      if (typeof id !== "string") throw new Error("Unknown or finished process");
      return json(res, 200, await stopProcess(id));
    }
    if (url.pathname === "/api/ports/holder" && req.method === "GET") {
      const requested = Number(url.searchParams.get("port"));
      const ports = await previewPorts();
      if (!ports.includes(requested))
        throw new Error("Only configured preview ports can be freed");
      if (Date.now() - lastPortScan < 500)
        return json(res, 429, { error: "Port lookups are rate limited; retry shortly" });
      lastPortScan = Date.now();
      return json(res, 200, await portHolder(requested, ports));
    }
    if (url.pathname === "/api/ports/free" && req.method === "POST") {
      const { port, pid, confirm, confirmName } = await readBody(req);
      if (confirm !== true || !Number.isInteger(pid))
        throw new Error("Freeing a port requires explicit confirmation");
      return json(
        res,
        200,
        await portHolder(Number(port), await previewPorts(), {
          confirmPid: pid,
          confirmName,
        }),
      );
    }
    if (url.pathname === "/api/sidecars" && req.method === "GET")
      return json(res, 200, { sidecars: listSidecars() });
    if (url.pathname === "/api/sidecars/logs" && req.method === "GET")
      return json(res, 200, sidecarLogs(url.searchParams.get("name")));
    if (
      ["/api/sidecars/restart", "/api/sidecars/stop"].includes(url.pathname) &&
      req.method === "POST"
    ) {
      const { name } = await readBody(req);
      if (typeof name !== "string") throw new Error("Unknown sidecar");
      return json(
        res,
        200,
        url.pathname.endsWith("restart")
          ? await restartSidecar(root, name)
          : await stopSidecar(name),
      );
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      const id = url.searchParams.get("id");
      validateId(id);
      if (eventStreams >= MAX_EVENT_STREAMS)
        return json(res, 429, { error: "Too many live-reload connections" });
      // Read-only: the playground must already exist (POST /api/select creates
      // it under the mutation gate); this endpoint never copies or seeds.
      try {
        if (!(await lstat(workspacePath(root, id))).isDirectory())
          throw new Error();
      } catch {
        return json(res, 404, { error: "Playground not created" });
      }
      eventStreams++;
      res.on("close", () => eventStreams--);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "access-control-allow-origin": allowedOrigin,
      });
      res.write("retry: 2000\n\n");
      const unsubscribe = await watchPlayground(root, id, (event) => {
        if (!res.destroyed)
          res.write("event: change\ndata: " + JSON.stringify(event) + "\n\n");
      });
      res.write("event: ready\ndata: " + JSON.stringify({ id }) + "\n\n");
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(": keep-alive\n\n");
      }, 15000);
      res.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }
    if (url.pathname === "/api/editors" && req.method === "GET")
      return json(res, 200, { editors: publicEditors(detectEditors()) });
    if (url.pathname === "/api/editor/launch" && req.method === "POST") {
      const { id, name, variant = "playground", line, column, editor } =
        await readBody(req);
      validateFile(name);
      const path = await assertSafePath(
        resolve(variantRoot(root, id, variant), name),
      );
      if (!(await lstat(path)).isFile()) throw new Error("Not a file");
      if (editor !== undefined && typeof editor !== "string")
        throw new Error("Unknown editor");
      return json(res, 200, await launchEditor(path, { line, column, editor }));
    }
    if (url.pathname === "/api/doctor" && req.method === "GET")
      return json(res, 200, await doctor(root));
    if (url.pathname === "/api/integrations" && req.method === "GET")
      return json(res, 200, { integrations: integrationStatus() });
    if (url.pathname === "/api/integrations/read" && req.method === "POST")
      return json(res, 200, await readIntegration((await readBody(req)).id));
    if (url.pathname === "/api/editor" && req.method === "GET") {
      const id = url.searchParams.get("id"),
        name = url.searchParams.get("name"),
        variant = url.searchParams.get("variant") || "playground";
      await readProjectFile(root, id, name, variant);
      return json(res, 200, {
        url:
          "vscode://file" +
          encodeURI(join(variantRoot(root, id, variant), name))
            .replaceAll("#", "%23")
            .replaceAll("?", "%3F"),
      });
    }
    if (url.pathname === "/api/migrate" && req.method === "POST") {
      const { sourceId, targetId, apply = false } = await readBody(req);
      if (!apply) return json(res, 200, await planMigration(root, sourceId, targetId));
      validateId(sourceId);
      validateId(targetId);
      return json(
        res,
        200,
        await withPlaygroundHooks(
          root,
          targetId,
          { operation: "migrate", source: { step: sourceId, variant: "playground" }, srcDir: workspacePath(root, sourceId) },
          async () => {
            await stopPreview(targetId);
            return migrateWorkspace(root, sourceId, targetId);
          },
          { onSpawn: ownGate },
        ),
      );
    }
    if (url.pathname === "/api/tutor" && req.method === "GET")
      return json(res, 200, { enabled: Boolean(tutorConfig()) });
    if (url.pathname === "/api/tutor" && req.method === "POST") {
      const input = await readBody(req);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.on("close", cancel);
      try {
        return json(
          res,
          200,
          await askTutor(root, input, { signal: controller.signal }),
        );
      } finally {
        res.off("close", cancel);
      }
    }
    if (url.pathname === "/api/backups" && req.method === "GET")
      return json(res, 200, {
        backups: await listBackups(root, url.searchParams.get("id")),
      });
    if (url.pathname === "/api/replace-workspace" && req.method === "POST") {
      const { id, sourceId = id, variant = "problem", backup } = await readBody(req);
      validateId(id);
      validateId(sourceId);
      if (backup !== undefined && (typeof backup !== "string" || !(await listBackups(root, id)).includes(backup)))
        throw new Error("Unknown backup");
      const srcDir =
        backup === undefined
          ? variantRoot(root, sourceId, variant)
          : join(root, ".workshop", "playgrounds", backup);
      return json(
        res,
        200,
        await withPlaygroundHooks(
          root,
          id,
          {
            operation: "replace",
            source: backup === undefined ? { step: sourceId, variant } : { step: id, variant: "backup" },
            srcDir,
          },
          async () => {
            await stopPreview(id);
            return replaceWorkspace(root, id, { sourceId, variant, backup });
          },
          { onSpawn: ownGate },
        ),
      );
    }
    if (url.pathname === "/api/reset" && req.method === "POST") {
      const { id } = await readBody(req);
      validateId(id);
      return json(
        res,
        200,
        await withPlaygroundHooks(
          root,
          id,
          { operation: "reset", source: { step: id, variant: "problem" }, srcDir: stepLayout(root, id).problem },
          async () => {
            await stopPreview(id);
            return resetWorkspace(root, id);
          },
          { onSpawn: ownGate },
        ),
      );
    }
    if (url.pathname === "/api/preferences") {
      if (req.method === "GET") return json(res, 200, await readPreferences(root));
      if (req.method === "PUT") return json(res, 200, await writePreferences(root, await readBody(req)));
    }
    if (url.pathname === "/api/saved-playgrounds") {
      if (req.method === "GET") {
        const id = url.searchParams.get("id");
        return json(res, 200, {
          saved: await listSaved(root, id),
          preferences: await readPreferences(root),
        });
      }
      const { id, savedId, label, pinned } = await readBody(req);
      validateId(id);
      if (req.method === "POST")
        return json(res, 200, await savePlayground(root, id, { label, reason: "manual", source: { step: id, variant: "playground" }, pinned: pinned === true }));
      if (req.method === "PATCH") return json(res, 200, await updateSaved(root, id, savedId, { label, pinned }));
      if (req.method === "DELETE") return json(res, 200, await deleteSaved(root, id, savedId));
    }
    if (url.pathname === "/api/saved-playgrounds/restore" && req.method === "POST") {
      const { id, savedId } = await readBody(req);
      validateId(id);
      const srcDir = await savedFilesPath(root, id, savedId);
      return json(
        res,
        200,
        await withPlaygroundHooks(
          root,
          id,
          { operation: "restore", source: { step: id, variant: "saved", savedId }, srcDir },
          async () => {
            await stopPreview(id);
            const restored = await restoreSaved(root, id, savedId);
            return { ...(await selectWorkspace(root, id)), backup: restored.previous };
          },
          { onSpawn: ownGate },
        ),
      );
    }
    if (url.pathname === "/api/diff" && req.method === "GET")
      return json(
        res,
        200,
        await diffSides(root, url.searchParams.get("a"), url.searchParams.get("b"), diffOptions(url.searchParams)),
      );
    if (url.pathname === "/api/diff/file" && req.method === "GET")
      return json(
        res,
        200,
        await diffFile(root, url.searchParams.get("a"), url.searchParams.get("b"), url.searchParams.get("path"), diffOptions(url.searchParams)),
      );
    if (url.pathname === "/api/touched" && req.method === "GET")
      return json(res, 200, await touchedFiles(root, url.searchParams.get("id")));
    if (url.pathname === "/api/file/sync" && req.method === "POST") {
      const { id, name, from, remove = false } = await readBody(req);
      validateId(id);
      validateRelativePath(name);
      if (typeof remove !== "boolean") throw new Error("Invalid remove flag");
      // Validate fully before the automatic save.
      await syncFile(root, id, name, from, { remove, dryRun: true });
      return json(
        res,
        200,
        await withPlaygroundHooks(
          root,
          id,
          { operation: "sync", source: parseSide(from), hooks: false },
          () => syncFile(root, id, name, from, { remove }),
        ),
      );
    }
    if (url.pathname === "/api/update" && req.method === "GET") {
      const { allDirty, ...status } = await updateStatus(root);
      return json(res, 200, status);
    }
    if (url.pathname === "/api/update/check" && req.method === "POST") {
      await startupCheck;
      const { allDirty, ...status } = await checkForUpdates(root, { onSpawn: ownGate });
      return json(res, 200, status);
    }
    if (url.pathname === "/api/update/apply" && req.method === "POST") {
      const { confirm, stash = false, backupOverwritten = false } = await readBody(req);
      await startupCheck;
      // Validate before streaming so refusals are plain 400 responses.
      if (confirm !== "update") throw new Error('Updating requires typing "update" to confirm');
      const send = ndjson(res);
      send({ type: "started" });
      try {
        const result = await applyUpdate(root, { confirm, stash, backupOverwritten, emit: send, onSpawn: ownGate });
        send({ type: "result", ok: true, ...result });
      } catch (error) {
        send({ type: "result", ok: false, error: error.message, code: error.code, dirty: error.dirty, paths: error.paths });
      }
      return res.end();
    }
    if (url.pathname === "/api/compare" && req.method === "GET") {
      const id = url.searchParams.get("id"),
        targetId = url.searchParams.get("targetId") || id,
        from = url.searchParams.get("from") || "playground",
        to = url.searchParams.get("to") || "solution",
        local = await listFiles(root, id, from),
        reference = await listFiles(root, targetId, to);
      const changes = [];
      for (const name of [...new Set([...local, ...reference])].sort()) {
        const before = local.includes(name)
          ? await readProjectFile(root, id, name, from)
          : null;
        const after = reference.includes(name)
          ? await readProjectFile(root, targetId, name, to)
          : null;
        if (before !== after)
          changes.push({
            name,
            before,
            after,
            status:
              before === null
                ? to + " only"
                : after === null
                  ? from + " only"
                  : "modified",
          });
      }
      return json(res, 200, { changes });
    }
    if (url.pathname === "/api/files" && req.method === "GET")
      return json(res, 200, {
        files: await listFiles(
          root,
          url.searchParams.get("id"),
          url.searchParams.get("variant") || "playground",
        ),
      });
    if (url.pathname === "/api/file") {
      if (req.method === "GET")
        return json(res, 200, {
          code: await readProjectFile(
            root,
            url.searchParams.get("id"),
            url.searchParams.get("name"),
            url.searchParams.get("variant") || "playground",
          ),
        });
      const { id, name, code, to } = await readBody(req);
      if (req.method === "PUT" || req.method === "POST")
        await writeProjectFile(root, id, name, code, {
          create: req.method === "POST",
        });
      else if (req.method === "DELETE") await deleteProjectFile(root, id, name);
      else if (req.method === "PATCH")
        await renameProjectFile(root, id, name, to);
      else throw new Error("Unsupported file operation");
      return json(res, 200, { saved: true });
    }
    if (url.pathname === "/api/progress") {
      if (req.method === "GET") return json(res, 200, await readProgress(root));
      if (req.method === "PUT") {
        const { id, complete } = await readBody(req);
        return json(res, 200, await updateProgress(root, id, complete));
      }
    }
    if (req.method === "GET" && url.pathname === "/api/exercises") {
      const course = await courseConfig(root);
      return json(res, 200, {
        course,
        ids: course.ids,
        exercises: await Promise.all(
          course.ids.map(async (id) => ({
            id,
            ...(await labConfig(root, id)),
          })),
        ),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/exercise")
      return json(res, 200, await load(url.searchParams.get("id")));
    if (req.method === "GET" && url.pathname === "/api/playground") {
      const id = url.searchParams.get("id");
      const config = await labConfig(root, id);
      const path = join(workspacePath(root, id), config.entry);
      try {
        return json(res, 200, {
          code: await readProjectFile(root, id, config.entry),
        });
      } catch (error) {
        if (error.code === "ENOENT")
          return json(res, 404, { error: "Playground not created" });
        throw error;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/select") {
      const { id } = await readBody(req);
      validateId(id);
      // Creating a playground is "setting" it: hooks run, nothing to save.
      const result = (await playgroundExists(id))
        ? await selectWorkspace(root, id)
        : await withPlaygroundHooks(
            root,
            id,
            { operation: "create", source: { step: id, variant: "problem" }, srcDir: stepLayout(root, id).problem },
            () => selectWorkspace(root, id),
            { onSpawn: ownGate },
          );
      return json(res, 200, {
        code: result.code,
        entry: result.entry,
        restored: true,
        hooks: result.hooks ?? [],
      });
    }
    if (req.method === "PUT" && url.pathname === "/api/playground") {
      const { id, code } = await readBody(req);
      validateId(id);
      await saveWorkspace(root, id, code);
      return json(res, 200, { saved: true });
    }
    if (
      req.method === "POST" &&
      ["/api/test", "/api/test-stream"].includes(url.pathname)
    ) {
      const { id, variant = "playground" } = await readBody(req);
      validateId(id);
      const workspace = await executionWorkspace(root, id, variant);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.on("close", cancel);
      try {
        if (url.pathname === "/api/test-stream") {
          res.writeHead(200, {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
          });
          const send = (event) => {
            if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
          };
          send({ type: "started", variant });
          const result = await testLab(root, id, {
            workspaceRoot: workspace.path,
            signal: controller.signal,
            emit: send,
            onSpawn: (session) =>
              gateProcessIds.add(
                registerProcess({
                  kind: "test",
                  label: "Tests " + id + " (" + variant + ")",
                  command: ["test", id, variant],
                  session,
                  stop: () => controller.abort(),
                }).id,
              ),
          });
          await workspace.cleanup();
          send({ type: "result", ...result });
          res.end();
        } else {
          const result = await testLab(root, id, {
            workspaceRoot: workspace.path,
            signal: controller.signal,
          });
          await workspace.cleanup();
          return json(res, 200, result);
        }
      } finally {
        res.off("close", cancel);
        await workspace.cleanup();
      }
      return;
    }
    if (await handleQuestions({ req, res, url, root, json, readBody, sandboxOrigin })) return;
    if (await handleUx({ req, res, url, root, json })) return;
    if (await handleContent({ req, res, url, root, json, readBody, sandboxOrigin })) return;
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    if (res.headersSent) {
      if (!res.destroyed)
        res.end(
          JSON.stringify({
            type: "result",
            passed: false,
            output: error.message,
          }) + "\n",
        );
    } else
      json(res, 400, {
        error: error.message,
        ...(error.code === "PORT_OCCUPIED" ? { code: error.code, port: error.port } : {}),
        ...(error.hooks?.length ? { hooks: error.hooks } : {}),
      });
  } finally {
    if (ownsMutation) {
      mutationActive = false;
      gateProcessIds.clear();
    }
  }
});
server.listen(port, host, () => {
  console.log(
    "Icode Workshop API on http://" + host + ":" + port + " using " + root,
  );
  if (process.env.ICODE_SANDBOX !== "0") {
    sandboxServer = createSandboxServer({ root, port: SANDBOX_PORT, uiOrigin: allowedOrigin });
    sandboxServer.on("error", (error) => console.error("Sandbox origin not started: " + error.message));
  }
  if (process.env.ICODE_UPDATE_CHECK !== "0")
    startupCheck = checkForUpdates(root).catch(() => {});
  if (process.env.ICODE_SIDECARS !== "0")
    startSidecars(root).catch((error) =>
      console.error("Sidecars not started: " + error.message),
    );
});

let shuttingDown = false;
// Every exit path stops every owned process: signals (including a closed
// terminal) stop them gracefully; the exit handler force-kills whatever is left
// (also after an uncaught exception).
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", ...(process.platform === "win32" ? ["SIGBREAK"] : [])])
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closeAllWatchers();
    const timeout = new Promise((resolve) => setTimeout(resolve, 1500).unref());
    await Promise.race([
      Promise.allSettled([
        stopAllPreviews(),
        stopAllSidecars(),
        stopActionsForShutdown(),
      ]),
      timeout,
    ]);
    server.close();
    sandboxServer?.close();
    process.exit(0);
  });
process.on("exit", () => {
  killAllSidecarsNow();
  killAllNow();
});
