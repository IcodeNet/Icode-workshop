import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

async function available(port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const assigned = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return assigned;
}

test(
  "CLI start serves API and Vite then releases both ports on shutdown",
  { timeout: 20000 },
  async () => {
    const apiPort = await available();
    await available(5173);
    const cwd = fileURLToPath(new URL("../../", import.meta.url));
    const child = spawn(
      process.execPath,
      ["packages/cli/bin.mjs", "start", "--content", "examples"],
      {
        cwd,
        env: { ...process.env, WORKSHOP_API_PORT: String(apiPort) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const closed = once(child, "close");
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const deadline = Date.now() + 12000;
      let ready = false;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, output);
        try {
          const responses = await Promise.all([
            fetch(`http://127.0.0.1:${apiPort}/api/exercises`, {
              signal: AbortSignal.timeout(500),
            }),
            fetch("http://127.0.0.1:5173/", {
              signal: AbortSignal.timeout(500),
            }),
          ]);
          if (responses.every((response) => response.ok)) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, output);
      child.kill("SIGTERM");
      const [code] = await closed;
      assert.equal(code, 0, output);
      await available(apiPort);
      await available(5173);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await closed;
    }
  },
);
