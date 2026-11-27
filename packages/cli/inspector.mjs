#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { npmCLI, courseEnvironment } from "../web/setup.mjs";
const root = resolve(process.env.WORKSHOP_CONTENT || process.cwd());
const require = createRequire(join(root, "package.json"));
const cli = join(
  dirname(require.resolve("@modelcontextprotocol/inspector/package.json")),
  "cli/build/cli.js",
);
const port = Number(process.env.PORT || 4401),
  clientPort = port + 2000,
  serverPort = port + 1000;
const token = randomBytes(32).toString("hex");
const child = spawn(process.execPath, [cli], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...courseEnvironment(root),
    HOST: "127.0.0.1",
    CLIENT_PORT: String(clientPort),
    SERVER_PORT: String(serverPort),
    MCP_PROXY_AUTH_TOKEN: token,
    MCP_AUTO_OPEN_ENABLED: "false",
    ALLOWED_ORIGINS: `http://127.0.0.1:${clientPort},http://localhost:${clientPort},http://127.0.0.1:${port}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
// Inspector logs contain its session token; retain only a generic startup error.
child.stdout.resume();
child.stderr.resume();
let exited = false;
child.on("exit", () => {
  exited = true;
  server.close();
});
child.on("error", () => {
  exited = true;
  process.exitCode = 1;
});
const target = new URL(`http://127.0.0.1:${clientPort}/`);
target.searchParams.set("transport", "stdio");
target.searchParams.set("serverCommand", process.execPath);
const quoted = (s) =>
  '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
target.searchParams.set(
  "serverArgs",
  [npmCLI(), "--silent", "--prefix", process.cwd(), "run", "dev:mcp"]
    .map(quoted)
    .join(" "),
);
target.searchParams.set("MCP_PROXY_AUTH_TOKEN", token);
target.searchParams.set(
  "MCP_PROXY_FULL_ADDRESS",
  `http://127.0.0.1:${serverPort}`,
);
const server = createServer((req, res) => {
  res.writeHead(302, { location: target.href });
  res.end();
});
const stop = () => {
  child.kill("SIGTERM");
  server.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (let i = 0; i < 80 && !exited; i++) {
  try {
    const response = await fetch(`http://127.0.0.1:${clientPort}`, {
      signal: AbortSignal.timeout(300),
    });
    if (response.ok) {
      server.listen(port, "127.0.0.1", () =>
        console.log("MCP Inspector ready"),
      );
      break;
    }
  } catch {}
  if (i === 79) {
    console.error("Inspector did not become ready");
    process.exitCode = 1;
    stop();
  }
  await new Promise((r) => setTimeout(r, 100));
}
