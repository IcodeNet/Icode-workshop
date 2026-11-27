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
        db: "node sidecar.mjs",
      },
    }),
  );
  await writeFile(
    join(root, "deploy.mjs"),
    `import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
console.log("\\x1b[32mICODE_ACTION=" + process.env.ICODE_ACTION + "\\x1b[0m");
process.stdout.write("::icode-confirm::" + JSON.stringify({ expected: "deploy-prod", message: "Type deploy-prod to create paid resources" }) + "\\n");
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
        { id: "sleep", label: "Sleep", script: "sleep" },
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
