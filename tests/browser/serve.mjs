import { createServer } from "node:http";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "icode-browser-"));
await cp("examples/exercises", join(root, "exercises"), { recursive: true });
const manifestPath = join(root, "exercises", "03", "lab.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.tools = [
  {
    id: "fixture",
    title: "Fixture tool",
    url: "http://127.0.0.1:4404",
    mode: "embed",
  },
  {
    id: "external",
    title: "External fixture",
    url: "http://127.0.0.1:4404",
    mode: "external",
  },
];
await writeFile(manifestPath, JSON.stringify(manifest));
createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end("<h1>Local service fixture</h1>");
}).listen(4404, "127.0.0.1");
process.env.WORKSHOP_CONTENT = root;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await rm(root, { recursive: true, force: true });
    process.exit(0);
  });
await import("../../packages/web/server.mjs");
