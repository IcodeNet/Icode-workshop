import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createRustAdapter,
  createDotnetAdapter,
  createJupyterAdapter,
  createDockerAdapter,
} from "./extra-adapters.mjs";
const factories = [
  createRustAdapter,
  createDotnetAdapter,
  createJupyterAdapter,
  createDockerAdapter,
];
for (const factory of factories) {
  const adapter = factory();
  test(
    adapter.id +
      ": real failing starter, passing edit and no-assessment rejection",
    { timeout: 300000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "icode-native-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      let output = "";
      const context = {
        workspaceRoot: root,
        signal: AbortSignal.timeout(280000),
        emit: (e) => {
          output += e.text;
        },
      };
      const detection = await adapter.detect(context);
      if (detection.some((d) => d.level === "error")) {
        if (process.env.WORKSHOP_REQUIRE_ALL_RUNTIMES === "1")
          assert.fail(detection.map((d) => d.message).join("; "));
        t.skip(detection.map((d) => d.message).join("; "));
        return;
      }
      const put = (path, data) => writeFile(join(root, path), data);
      if (adapter.id === "rust") {
        await mkdir(join(root, "src"));
        await put(
          "Cargo.toml",
          '[package]\nname="workshop_fixture"\nversion="0.1.0"\nedition="2021"\n',
        );
        await put("src/lib.rs", "#[test] fn approved() { assert_eq!(1, 2); }");
      } else if (adapter.id === "dotnet") {
        await put(
          "Workshop.csproj",
          '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework><IsTestProject>true</IsTestProject></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1"/><PackageReference Include="xunit" Version="2.9.2"/><PackageReference Include="xunit.runner.visualstudio" Version="2.8.2"/></ItemGroup></Project>',
        );
        await put(
          "Tests.cs",
          "using Xunit; public class Tests { [Fact] public void Approved() { Assert.Equal(1, 2); } }",
        );
      } else if (adapter.id === "jupyter") {
        const notebook = {
          nbformat: 4,
          nbformat_minor: 5,
          metadata: {
            kernelspec: {
              name: "python3",
              language: "python",
              display_name: "Python 3",
            },
          },
          cells: [
            {
              id: "assessment",
              cell_type: "code",
              execution_count: null,
              outputs: [],
              metadata: { tags: ["workshop-test"] },
              source: "assert 1 == 2",
            },
          ],
        };
        await put("notebook.ipynb", JSON.stringify(notebook));
      } else {
        await put(
          "compose.yaml",
          'services:\n  test:\n    image: node:22-alpine\n    working_dir: /lab\n    volumes:\n      - .:/lab\n    command: ["node", "check.mjs"]\n',
        );
        await put("value.txt", "wrong");
        await put(
          "check.mjs",
          'import fs from "node:fs"; import assert from "node:assert/strict"; assert.equal(fs.readFileSync("value.txt","utf8"),"approved"); fs.writeFileSync(".workshop-results.json",JSON.stringify({passed:1,failed:0}));',
        );
      }
      await adapter.prepare(context);
      output = "";
      const failing = await adapter.run("test", context);
      assert.notEqual(failing.exitCode, 0, output);
      if (adapter.id === "rust")
        await put("src/lib.rs", "#[test] fn approved() { assert_eq!(1, 1); }");
      if (adapter.id === "dotnet")
        await put(
          "Tests.cs",
          "using Xunit; public class Tests { [Fact] public void Approved() { Assert.Equal(1, 1); } }",
        );
      if (adapter.id === "jupyter") {
        const notebook = JSON.parse(
          await readFile(join(root, "notebook.ipynb"), "utf8"),
        );
        notebook.cells[0].source = "assert 1 == 1";
        await put("notebook.ipynb", JSON.stringify(notebook));
      }
      if (adapter.id === "docker") await put("value.txt", "approved");
      output = "";
      const passing = await adapter.run("test", context);
      assert.equal(passing.exitCode, 0, output);
      if (adapter.id === "rust")
        await put("src/lib.rs", "pub fn no_tests() {}");
      if (adapter.id === "dotnet")
        await put("Tests.cs", "public class NoTests {}");
      if (adapter.id === "jupyter") {
        const notebook = JSON.parse(
          await readFile(join(root, "notebook.ipynb"), "utf8"),
        );
        notebook.cells[0].metadata = {};
        await put("notebook.ipynb", JSON.stringify(notebook));
      }
      if (adapter.id === "docker")
        await put("check.mjs", 'console.log("No assessment executed");');
      output = "";
      const empty = await adapter.run("test", context);
      assert.notEqual(empty.exitCode, 0, output);
    },
  );
}
test("additional adapters diagnose missing executables without reporting success", async () => {
  for (const factory of factories) {
    const diagnostics = await factory({
      executable: "icode-deliberately-missing-toolchain",
    }).detect({ workspaceRoot: process.cwd() });
    assert.ok(diagnostics.some((d) => d.level === "error"));
  }
});
