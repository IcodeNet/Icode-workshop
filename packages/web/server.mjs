import { integrationStatus, readIntegration } from "./integrations.mjs";
import { planMigration, migrateWorkspace } from "./migration.mjs";
import { askTutor, tutorConfig } from "./tutor.mjs";
import { courseConfig, readProgress, updateProgress } from "./course.mjs";
import { executionWorkspace } from "./variants.mjs";
import { startPreview, stopPreview, stopAllPreviews } from "./previews.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  listFiles,
  variantRoot,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  renameProjectFile,
} from "./files.mjs";
import { labConfig, testLab } from "./runtime.mjs";
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
  let instructions = config.description;
  try {
    instructions = await readText(join(base, "README.md"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return {
    id,
    ...config,
    instructions,
    topic: "AI engineering",
    problem: await readProjectFile(root, id, config.entry, "problem"),
    solution: await readProjectFile(root, id, config.entry, "solution"),
  };
}
let mutationActive = false;
const server = createServer(async (req, res) => {
  if (!["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host))
    return json(res, 403, { error: "Host denied" });
  if (req.headers.origin && req.headers.origin !== allowedOrigin)
    return json(res, 403, { error: "Origin denied" });
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }
  let ownsMutation = false;
  try {
    const url = new URL(req.url, "http://localhost");
    if (!["GET", "HEAD"].includes(req.method)) {
      if (mutationActive)
        return json(res, 409, {
          error:
            "Another workshop operation is still running. Please retry when it finishes.",
        });
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
      if (apply) await stopPreview(targetId);
      return json(
        res,
        200,
        apply
          ? await migrateWorkspace(root, sourceId, targetId)
          : await planMigration(root, sourceId, targetId),
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
      const { id, sourceId, variant, backup } = await readBody(req);
      validateId(id);
      await stopPreview(id);
      return json(
        res,
        200,
        await replaceWorkspace(root, id, { sourceId, variant, backup }),
      );
    }
    if (url.pathname === "/api/reset" && req.method === "POST") {
      const { id } = await readBody(req);
      validateId(id);
      await stopPreview(id);
      return json(res, 200, await resetWorkspace(root, id));
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
      const result = await selectWorkspace(root, id);
      return json(res, 200, {
        code: result.code,
        entry: result.entry,
        restored: true,
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
    } else json(res, 400, { error: error.message });
  } finally {
    if (ownsMutation) mutationActive = false;
  }
});
server.listen(port, host, () =>
  console.log(
    "Icode Workshop API on http://" + host + ":" + port + " using " + root,
  ),
);

for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await stopAllPreviews();
    server.close();
    process.exit(0);
  });
