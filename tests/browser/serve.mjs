import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
async function freePort() {
  for (;;) {
    const server = createNetServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    await new Promise((r) => server.close(r));
    if (![4317, 4318, 4403, 4404, 5173].includes(port)) return port;
  }
}
import { spawnSync } from "node:child_process";
import { mkdtemp, cp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = await mkdtemp(join(tmpdir(), "icode-browser-"));
await cp("examples/exercises", join(root, "exercises"), { recursive: true });
await cp("examples/course.json", join(root, "course.json"));
const manifestPath = join(root, "exercises", "03", "lab.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
// A free port for the lesson 03 preview (not the fixed 4403 of examples/):
// specs read it from the API, so a slow-to-release port never collides.
manifest.preview = { ...manifest.preview, port: await freePort() };
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
// Lesson 01 declares its own set-playground hook (lab.json overrides course hooks).
const lab01 = join(root, "exercises", "01", "lab.json");
await writeFile(lab01, JSON.stringify({ ...JSON.parse(await readFile(lab01, "utf8")), hooks: { postSetPlayground: "playground:post" } }));
// Stage 1 operations fixture: actions, an indicator, a sidecar, an editor
// stand-in and an installed, locked dependency for the setup check.
const course = JSON.parse(await readFile(join(root, "course.json"), "utf8"));
course.actions = [
  { id: "deploy", label: "Deploy demo", script: "deploy", group: "Cloud", destructive: true, description: "Creates billable demo resources" },
  { id: "teardown", label: "Tear down demo", script: "teardown", group: "Cloud" },
  { id: "long-job", label: "Long job", script: "long-job", group: "Cloud", cancelGraceSeconds: 5 },
];
course.indicators = [{ path: ".icode-deployed", message: "Demo resources are running and incur cost.", level: "danger" }];
course.sidecars = { "mock-api": { script: "mock-api" } };
// Stage 2: playground and update hooks.
course.hooks = { postUpdate: "postupdate", timeoutSeconds: 60 };
// Stage 3: content settings and a hostile step (06): a lesson full of XSS
// attempts and an app that tries to reach the engine API and the UI.
course.instructor = { name: "Ada Example", url: "https://example.com/ada" };
course.forms = { workshop: "https://example.com/feedback?w={workshopTitle}", exercise: "https://example.com/exercise?e={exerciseTitle}" };
course.support = { text: "Ask in the **course channel**.", email: "help@example.com" };
course.community = { title: "Course forum", url: "https://example.com/forum" };
course.notifications = [
  { id: "welcome", title: "Welcome notice", message: "A new **lesson** is available.", type: "info", link: "https://example.com/news" },
  { id: "old", title: "Expired notice", message: "Gone", expiresAt: "2020-01-01" },
];
course.modules.push({ id: "hostile", title: "03 · Hostile content", steps: ["06"] });
await writeFile(join(root, "exercises", "README.md"), (await readFile(join(root, "exercises", "README.md"), "utf8")) + "\nIntro pages have no step: <DiffLink>See the first diff</DiffLink> and <NextDiffLink /> stay inactive instead of failing.\n");
await mkdir(join(root, "exercises", "06", "problem"), { recursive: true });
await mkdir(join(root, "exercises", "06", "solution"), { recursive: true });
await writeFile(join(root, "exercises", "06", "lab.json"), JSON.stringify({ schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Hostile content", app: { type: "simple" } }));
await writeFile(
  join(root, "exercises", "06", "README.md"),
  `# Hostile lesson

Safe paragraph before the attacks.

<script>window.__xss = 1; alert(1)</script>

<img src="x.png" onerror="window.__xss = 2">

[javascript link](javascript:window.__xss=3)

<a href="jav&#x09;ascript:window.__xss=4">tab link</a>

<svg onload="window.__xss=5"><circle r="5"></circle></svg>

<iframe src="javascript:parent.__xss=6"></iframe>

<details open ontoggle="window.__xss=7"><summary>toggle</summary>content</details>

<p onclick="window.__xss=8" style="background:url(javascript:alert(1))">styled paragraph</p>

<math><mi xlink:href="javascript:alert(1)">m</mi></math>

<a href="data:text/html,<script>alert(1)</script>">data link</a>

<form action="http://127.0.0.1:4317/api/progress"><button>submit</button></form>

<InlineFile file="../../../etc/passwd" />

${"```"}mermaid
graph TD
  A["<img src=x onerror=alert(1)>"] --> B
  click A call alert(1)
  click B "javascript:alert(1)"
${"```"}

Safe paragraph after the attacks.
`,
);
const hostileApp = `<!doctype html><html><head><title>Hostile app</title></head><body><h1>Hostile app</h1><pre id="out">running</pre>
<script>
(async () => {
  const results = {};
  const targets = { api: ["http://127.0.0.1:4317/api/exercises"], ui: ["http://127.0.0.1:5173/api/exercises"], mutate: ["http://127.0.0.1:4317/api/progress", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "01", complete: true }) }], uiMutate: ["http://127.0.0.1:5173/api/progress", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "01", complete: true }) }] };
  for (const [key, args] of Object.entries(targets)) {
    try { const r = await fetch(...args); results[key] = "status " + r.status; } catch { results[key] = "blocked"; }
  }
  try { results.parent = String(window.parent.document.title); } catch { results.parent = "blocked"; }
  try { window.top.location.href = "http://127.0.0.1:5173/?hijacked"; results.top = "navigated"; } catch { results.top = "blocked"; }
  document.getElementById("out").textContent = JSON.stringify(results);
})();
</script></body></html>`;
// BL-1 regression: course-like HTML inside the engine checkout (where Vite's
// default fs.allow would serve it on the UI origin) and an app (07) that tries
// to reach it by navigating its frame, a popup or a top-level tab.
const evilPaths = [join(process.cwd(), "bl1-evil.html"), join(process.cwd(), "packages", "web", "bl1-evil.html"), join(process.cwd(), "examples", "bl1-evil.html")];
// The content spec plants course-like HTML at these paths during its test.
const toFs = (path) => "http://127.0.0.1:5173/@fs" + (path.startsWith("/") ? "" : "/") + path.replaceAll("\\", "/");
const escapeApp = `<!doctype html><html><head><title>Escape</title></head><body><pre id="out">idle</pre><script>
const targets = ${JSON.stringify(["http://127.0.0.1:5173/bl1-evil.html", ...evilPaths.map(toFs), "http://127.0.0.1:5173/"])};
const go = new URLSearchParams(location.search).get("go");
const index = Number(new URLSearchParams(location.search).get("i") || 0);
if (go === "frame") location.href = targets[index];
if (go === "spoof") location.href = "http://127.0.0.1:4404/spoof";
if (go === "sw") navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready).then(() => { document.getElementById("out").textContent = "registered"; }, (e) => { document.getElementById("out").textContent = "sw refused: " + e.name; });
if (go === "popup") { let w = null; try { w = window.open(targets[index]); } catch {} document.getElementById("out").textContent = w ? "opened" : "popup blocked"; }
</script></body></html>`;
await mkdir(join(root, "exercises", "07", "problem"), { recursive: true });
await mkdir(join(root, "exercises", "07", "solution"), { recursive: true });
await writeFile(join(root, "exercises", "07", "lab.json"), JSON.stringify({ schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Escape attempt", app: { type: "simple" } }));
await writeFile(join(root, "exercises", "07", "README.md"), "# Escape attempt\n");
for (const variant of ["problem", "solution"]) {
  await writeFile(join(root, "exercises", "07", variant, "index.html"), escapeApp);
  await writeFile(join(root, "exercises", "07", variant, "index.mjs"), "export const value = 1;\n");
  // A service worker that would take over every later load of this app (SF-A).
  await writeFile(join(root, "exercises", "07", variant, "sw.js"), "self.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));\nself.addEventListener('fetch', (e) => e.respondWith(new Response('<h1>SW owned</h1>', { headers: { 'content-type': 'text/html' } })));\n");
}
course.modules.at(-1).steps.push("07");
// Stage 4: crafted course, module, exercise, step and file names (08) that
// the command palette must show as text.
await mkdir(join(root, "exercises", "08", "problem"), { recursive: true });
await mkdir(join(root, "exercises", "08", "solution"), { recursive: true });
await writeFile(join(root, "exercises", "08", "lab.json"), JSON.stringify({ schemaVersion: 1, runtime: "node", entry: "index.mjs", title: '<img src=x onerror="window.__xss=10">Crafted step' }));
await writeFile(join(root, "exercises", "08", "README.md"), "# Crafted names\n");
for (const variant of ["problem", "solution"]) {
  await writeFile(join(root, "exercises", "08", variant, "index.mjs"), "export const value = 1;\n");
  await writeFile(join(root, "exercises", "08", variant, "<img src=x onerror=window.__xss=13>.mjs"), "export const crafted = 1;\n");
}
course.modules.push({ id: "crafted", title: "<script>window.__xss=11</script>Crafted module", exercises: [{ id: "crafted-ex", title: '<svg onload="window.__xss=12">Crafted exercise', steps: ["08"] }] });
// Stage 4 (review S-1): code blocks in every language Shiki bundles, ~25 per
// lesson (steps 09–18) so each lesson renders well inside the 5 s limit. The
// axe checks open each of them in every theme.
const shiki = await import(pathToFileURL(join(process.cwd(), "packages", "web", "node_modules", "shiki", "dist", "index.mjs")).href);
const languages = shiki.bundledLanguagesInfo.map((l) => l.id);
const sample = [
  "// comment: TODO fix #1",
  'import { x } from "module";',
  "const answer = 42, ok = true, re = /a+b/g;",
  "function greet(name) { return `hi ${name}`; } # also a comment",
  '<tag attr="value">text &amp; more</tag>',
  "+ added line",
  "- removed line",
  "SELECT * FROM t WHERE id = 1; -- sql comment",
  "key: value  # yaml",
  "@decorator class Thing(Base): pass",
].join("\n");
const codeSteps = [];
for (let i = 0; i * 25 < languages.length; i++) {
  const id = String(9 + i).padStart(2, "0");
  const chunk = languages.slice(i * 25, i * 25 + 25);
  codeSteps.push(id);
  await mkdir(join(root, "exercises", id, "problem"), { recursive: true });
  await mkdir(join(root, "exercises", id, "solution"), { recursive: true });
  await writeFile(join(root, "exercises", id, "lab.json"), JSON.stringify({ schemaVersion: 1, runtime: "node", entry: "index.mjs", title: "Code samples " + (i + 1) }));
  await writeFile(join(root, "exercises", id, "README.md"), "# Code samples " + (i + 1) + "\n\n" + chunk.map((lang) => "## " + lang + "\n\n```" + lang + " {2}\n" + sample + "\n```\n").join("\n"));
  for (const variant of ["problem", "solution"]) await writeFile(join(root, "exercises", id, variant, "index.mjs"), "export const value = 1;\n");
}
course.modules.push({ id: "code-samples", title: "Code samples (every highlighted language)", steps: codeSteps });
await writeFile(join(tmpdir(), "icode-browser-code-steps.json"), JSON.stringify(codeSteps));
await writeFile(join(tmpdir(), "icode-browser-root.txt"), root);
await writeFile(join(root, "course.json"), JSON.stringify(course));
for (const variant of ["problem", "solution"]) {
  await writeFile(join(root, "exercises", "06", variant, "index.html"), hostileApp);
  await writeFile(join(root, "exercises", "06", variant, "index.mjs"), "export const value = 1;\n");
}
await writeFile(join(root, "course.json"), JSON.stringify(course));
await writeFile(
  join(root, "package.json"),
  JSON.stringify({
    name: "browser-course",
    private: true,
    scripts: { deploy: "node ops/deploy.mjs", teardown: "node ops/teardown.mjs", "mock-api": "node ops/mock-api.mjs", "long-job": "node ops/long-job.mjs", "playground:post": "node ops/post-set.mjs", postupdate: "node ops/post-update.mjs" },
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
console.log("::icode-confirm:" + process.env.ICODE_CONFIRM_TOKEN + "::" + JSON.stringify({ expected: "deploy-demo", message: "This creates billable resources." }));
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
await writeFile(
  join(root, "ops", "long-job.mjs"),
  `let n = 0;
process.on("SIGINT", () => { console.log("cleaning up after cancel"); process.exit(130); });
setInterval(() => console.log("step " + n++), 200);
`,
);
await writeFile(join(root, "ops", "teardown.mjs"), `import { rmSync } from "node:fs"; rmSync(".icode-deployed", { force: true }); console.log("torn down");\n`);
await writeFile(
  join(root, "ops", "mock-api.mjs"),
  `console.log("\\x1b[36mmock api listening\\x1b[0m"); setInterval(() => console.log("heartbeat"), 1000);\n`,
);
await writeFile(
  join(root, "ops", "post-set.mjs"),
  `const c = JSON.parse(process.env.ICODE_HOOK_CONTEXT);
console.log("\\x1b[35mpost-set hook\\x1b[0m " + c.operation + " " + c.step + " restart=" + process.env.EPICSHOP_PLAYGROUND_RESTART_PLAYGROUND);
`,
);
await writeFile(join(root, "ops", "post-update.mjs"), `console.log("post-update hook ran from " + process.env.ICODE_UPDATE_FROM.slice(0, 7));\n`);
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
  if (req.url === "/spoof")
    // Another origin inside the app frame forges workshop messages (U5).
    return res.end('<h1>Spoof</h1><script>for (const m of [{ type: "icode:location", href: "/app/07/playground/spoofed" }, { type: "icode:mermaid", ok: true, height: 9999 }]) parent.postMessage(m, "*");</script>');
  res.end("<h1>Local service fixture</h1>");
}).listen(4404, "127.0.0.1");
// Stage 2 update fixture: the course is a clone that is one commit behind its
// upstream (a bare repository next to it), so "Update workshop" has work to do.
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" };
const runGit = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
};
const gitBase = await mkdtemp(join(tmpdir(), "icode-browser-git-"));
if (spawnSync("git", ["--version"]).status === 0) {
  await writeFile(join(root, ".gitignore"), ".workshop/\n.icode-deployed\n");
  runGit(root, "init", "-q", "-b", "main");
  runGit(root, "add", ".");
  runGit(root, "commit", "-q", "-m", "Fixture course");
  runGit(gitBase, "clone", "-q", "--bare", root, "remote.git");
  runGit(root, "remote", "add", "origin", join(gitBase, "remote.git"));
  runGit(root, "fetch", "-q", "origin");
  runGit(root, "branch", "-q", "--set-upstream-to=origin/main", "main");
  runGit(gitBase, "clone", "-q", join(gitBase, "remote.git"), "author");
  const readme = join(gitBase, "author", "exercises", "03", "README.md");
  await writeFile(readme, (await readFile(readme, "utf8")) + "\nUpdated upstream: previews now explain ports.\n");
  runGit(join(gitBase, "author"), "commit", "-q", "-am", "Upstream lesson fix");
  runGit(join(gitBase, "author"), "push", "-q");
}
process.env.WORKSHOP_CONTENT = root;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await rm(root, { recursive: true, force: true });
    await rm(gitBase, { recursive: true, force: true });
    process.exit(0);
  });
await import("../../packages/web/server.mjs");
