import { createServer } from "node:http";
import { mkdtemp, cp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
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
// Stage 1 operations fixture: actions, an indicator, a sidecar, an editor
// stand-in and an installed, locked dependency for the setup check.
const course = JSON.parse(await readFile(join(root, "course.json"), "utf8"));
course.actions = [
  { id: "deploy", label: "Deploy demo", script: "deploy", group: "Cloud", destructive: true, description: "Creates billable demo resources" },
  { id: "teardown", label: "Tear down demo", script: "teardown", group: "Cloud" },
];
course.indicators = [{ path: ".icode-deployed", message: "Demo resources are running and incur cost.", level: "danger" }];
course.sidecars = { "mock-api": { script: "mock-api" } };
await writeFile(join(root, "course.json"), JSON.stringify(course));
await writeFile(
  join(root, "package.json"),
  JSON.stringify({
    name: "browser-course",
    private: true,
    scripts: { deploy: "node ops/deploy.mjs", teardown: "node ops/teardown.mjs", "mock-api": "node ops/mock-api.mjs" },
    dependencies: { "icode-fixture-dependency": "1.0.0" },
  }),
);
await writeFile(
  join(root, "package-lock.json"),
  JSON.stringify({
    name: "browser-course",
    lockfileVersion: 3,
    packages: {
      "": { name: "browser-course", dependencies: { "icode-fixture-dependency": "1.0.0" } },
      "node_modules/icode-fixture-dependency": { version: "1.0.0" },
    },
  }),
);
await mkdir(join(root, "node_modules", "icode-fixture-dependency"), { recursive: true });
await writeFile(
  join(root, "node_modules", "icode-fixture-dependency", "package.json"),
  JSON.stringify({ name: "icode-fixture-dependency", version: "1.0.0" }),
);
await mkdir(join(root, "ops"));
await writeFile(
  join(root, "ops", "deploy.mjs"),
  `import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
console.log("\\x1b[32mPlanning deployment\\x1b[0m (ICODE_ACTION=" + process.env.ICODE_ACTION + ")");
console.log("::icode-confirm::" + JSON.stringify({ expected: "deploy-demo", message: "This creates billable resources." }));
const rl = createInterface({ input: process.stdin });
rl.once("line", (line) => {
  rl.close();
  process.stdin.destroy();
  if (line !== "deploy-demo") { console.log("Deployment cancelled"); process.exit(2); }
  writeFileSync(".icode-deployed", "1");
  console.log("\\x1b[1;32mdeployed\\x1b[0m");
});
`,
);
await writeFile(join(root, "ops", "teardown.mjs"), `import { rmSync } from "node:fs"; rmSync(".icode-deployed", { force: true }); console.log("torn down");\n`);
await writeFile(
  join(root, "ops", "mock-api.mjs"),
  `console.log("\\x1b[36mmock api listening\\x1b[0m"); setInterval(() => console.log("heartbeat"), 1000);\n`,
);
const editorLog = join(tmpdir(), "icode-browser-editor.json");
await rm(editorLog, { force: true });
await writeFile(
  join(root, "ops", "editor.mjs"),
  `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(editorLog)}, JSON.stringify(process.argv.slice(2)));\n`,
);
process.env.ICODE_EDITOR = JSON.stringify([process.execPath, join(root, "ops", "editor.mjs")]);
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
