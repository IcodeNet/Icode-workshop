// Shared fixture: a minimal course with actions, an indicator and a sidecar.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function operationsCourse() {
  const root = await mkdtemp(join(tmpdir(), "icode-ops-"));
  await mkdir(join(root, "exercises", "01", "problem"), { recursive: true });
  await mkdir(join(root, "exercises", "01", "solution"), { recursive: true });
  await writeFile(
    join(root, "exercises", "01", "problem", "index.mjs"),
    "export default 1\n",
  );
  await writeFile(
    join(root, "exercises", "01", "solution", "index.mjs"),
    "export default 1\n",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "ops-course",
      private: true,
      scripts: {
        deploy: "node deploy.mjs",
        teardown: "node teardown.mjs",
        sleep: "node sleep.mjs",
        noisy: "node noisy.mjs",
        spoof: "node spoof.mjs",
        graceful: "node graceful.mjs",
        listen: "node listen.mjs",
        db: "node sidecar.mjs",
      },
    }),
  );
  await writeFile(
    join(root, "deploy.mjs"),
    `import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
console.log("\\x1b[32mICODE_ACTION=" + process.env.ICODE_ACTION + "\\x1b[0m");
process.stdout.write("::icode-confirm:" + process.env.ICODE_CONFIRM_TOKEN + "::" + JSON.stringify({ expected: "deploy-prod", message: "Type deploy-prod to create paid resources" }) + "\\n");
const rl = createInterface({ input: process.stdin });
rl.once("line", (line) => {
  rl.close();
  process.stdin.destroy();
  if (line !== "deploy-prod") { console.log("cancelled by learner"); process.exit(3); }
  writeFileSync(".deployed", "yes");
  console.log("deployed");
});
`,
  );
  await writeFile(
    join(root, "teardown.mjs"),
    `import { rmSync } from "node:fs"; rmSync(".deployed", { force: true }); console.log("removed");\n`,
  );
  // More than 2 MB of output, then a confirmation (protocol must survive caps).
  await writeFile(
    join(root, "noisy.mjs"),
    `const line = "x".repeat(999) + "\\n";
for (let i = 0; i < 2200; i++) process.stdout.write(line);
process.stdout.write("::icode-confirm:" + process.env.ICODE_CONFIRM_TOKEN + "::" + JSON.stringify({ expected: "go" }) + "\\n");
process.stdin.once("data", (d) => { console.log("answer=" + String(d).trim()); process.stdin.destroy(); });
`,
  );
  // A forged prompt (no token), then a real one from a grandchild on stderr.
  await writeFile(
    join(root, "spoof.mjs"),
    `import { execFileSync } from "node:child_process";
console.log('::icode-confirm::{"expected":"deploy-prod","message":"forged"}');
console.log('::icode-confirm:wrong-token::{"expected":"deploy-prod"}');
execFileSync(process.execPath, ["-e", 'console.error("::icode-confirm:" + process.env.ICODE_CONFIRM_TOKEN + "::" + JSON.stringify({ expected: "real" }))'], { stdio: "inherit" });
process.stdin.once("data", (d) => { console.log("answer=" + String(d).trim()); process.stdin.destroy(); });
`,
  );
  // Cleans up on SIGINT (graceful cancel).
  await writeFile(
    join(root, "graceful.mjs"),
    `import { writeFileSync } from "node:fs";
process.on("SIGINT", () => { writeFileSync(".cleaned", "yes"); process.exit(130); });
console.log("working");
setInterval(() => {}, 1000);
`,
  );
  // Listens on PORT (for engine-owned descendant tests).
  await writeFile(
    join(root, "listen.mjs"),
    `import { createServer } from "node:net";
createServer().listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening"));
`,
  );
  await writeFile(
    join(root, "sleep.mjs"),
    `console.log("sleeping"); setInterval(() => {}, 1000);\n`,
  );
  await writeFile(
    join(root, "sidecar.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(process.env.ICODE_SIDECAR + ".pid", String(process.pid));
let n = 0;
console.log("\\x1b[36mready\\x1b[0m");
setInterval(() => console.log("tick " + n++), 20);
`,
  );
  await writeFile(
    join(root, "course.json"),
    JSON.stringify({
      schemaVersion: 1,
      title: "Operations course",
      actions: [
        {
          id: "deploy",
          label: "Deploy to Azure",
          script: "deploy",
          group: "Cloud",
          destructive: true,
          description: "Creates paid resources",
        },
        {
          id: "teardown",
          label: "Tear down",
          script: "teardown",
          group: "Cloud",
        },
        { id: "sleep", label: "Sleep", script: "sleep", cancelGraceSeconds: 1 },
        { id: "noisy", label: "Noisy", script: "noisy" },
        { id: "spoof", label: "Spoof", script: "spoof" },
        {
          id: "graceful",
          label: "Graceful",
          script: "graceful",
          cancelGraceSeconds: 20,
        },
      ],
      indicators: [
        {
          path: ".deployed",
          message: "Azure resources are running and cost money",
          level: "danger",
        },
      ],
      sidecars: { db: { script: "db" } },
    }),
  );
  return root;
}
