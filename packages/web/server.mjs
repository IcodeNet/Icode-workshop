import { startPreview, stopPreview, stopAllPreviews } from "./previews.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  listFiles,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  renameProjectFile,
} from "./files.mjs";
import { labConfig, testLab } from "./runtime.mjs";
import { fileURLToPath } from "node:url";
import { listExercises, validateId } from "../core/index.mjs";
import {
  resetWorkspace,
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
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
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
  try {
    const url = new URL(req.url, "http://localhost");
    if (
      ["/api/start", "/api/stop"].includes(url.pathname) &&
      req.method === "POST"
    ) {
      const { id } = await readBody(req);
      validateId(id);
      return json(
        res,
        200,
        url.pathname === "/api/start"
          ? await startPreview(root, id)
          : await stopPreview(id),
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
        local = await listFiles(root, id, "playground"),
        reference = await listFiles(root, id, "solution");
      const changes = [];
      for (const name of [...new Set([...local, ...reference])].sort()) {
        const before = local.includes(name)
          ? await readProjectFile(root, id, name, "playground")
          : null;
        const after = reference.includes(name)
          ? await readProjectFile(root, id, name, "solution")
          : null;
        if (before !== after)
          changes.push({
            name,
            before,
            after,
            status:
              before === null
                ? "solution only"
                : after === null
                  ? "playground only"
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
    if (req.method === "GET" && url.pathname === "/api/exercises")
      return json(res, 200, {
        ids: await listExercises(root),
        exercises: await Promise.all(
          (await listExercises(root)).map(async (id) => ({
            id,
            ...(await labConfig(root, id)),
          })),
        ),
      });
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
    if (req.method === "POST" && url.pathname === "/api/test") {
      const { id } = await readBody(req);
      validateId(id);
      return json(res, 200, await testLab(root, id));
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 400, { error: error.message });
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
