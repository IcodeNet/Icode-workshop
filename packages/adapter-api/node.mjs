import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";

/** Managed local process. stop waits for exit; abort escalates after 500ms. */
export function startProcess(command, args, context) {
  if (!context || typeof context.workspaceRoot !== "string")
    throw new TypeError("workspaceRoot required");
  if (context.signal?.aborted) throw new Error("Execution already aborted");
  const env = { ...process.env, ...context.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, args, {
    cwd: context.workspaceRoot,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    detached: process.platform !== "win32",
  });
  let timer,
    stopped = false,
    output = 0;
  const kill = (signal) => {
    try {
      if (process.platform !== "win32") process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  };
  const abort = () => {
    if (stopped) return;
    kill("SIGTERM");
    timer ??= setTimeout(() => kill("SIGKILL"), 500);
  };
  const completion = new Promise((resolve, reject) => {
    const clean = () => {
      stopped = true;
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
    };
    child.on("error", (e) => {
      clean();
      reject(e);
    });
    child.on("close", (exitCode) => {
      clean();
      resolve({ exitCode, aborted: Boolean(context.signal?.aborted) });
    });
    for (const type of ["stdout", "stderr"])
      child[type].on("data", (chunk) => {
        const text = chunk.toString().slice(0, Math.max(0, 50000 - output));
        output += text.length;
        if (text) context.emit?.({ type, text });
      });
  });
  context.signal?.addEventListener("abort", abort, { once: true });
  if (context.signal?.aborted) abort();
  return {
    id: randomUUID(),
    completion,
    async stop() {
      abort();
      await completion;
    },
  };
}
export async function execute(command, args, context) {
  if (context?.signal?.aborted) return { exitCode: null, aborted: true };
  return startProcess(command, args, context).completion;
}
export async function fileExists(root, name) {
  try {
    await access(join(root, name));
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
