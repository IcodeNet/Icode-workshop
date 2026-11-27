import { createServer } from "node:http";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "icode-browser-"));
await cp("examples/exercises", join(root, "exercises"), { recursive: true });
await cp("examples/course.json", join(root, "course.json"));
const manifestPath = join(root, "exercises", "03", "lab.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.media = {
  src: "http://127.0.0.1:4404/lesson.webm",
  captions: "http://127.0.0.1:4404/lesson.vtt",
  transcript: "A preview is a running local application.",
};
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
const video = await readFile("tests/browser/fixtures/lesson.webm");
createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  if (req.url === "/lesson.webm") {
    res.setHeader("content-type", "video/webm");
    return res.end(video);
  }
  if (req.url === "/lesson.vtt") {
    res.setHeader("content-type", "text/vtt");
    return res.end(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nWorkshop media fixture\n",
    );
  }
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
