import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Managed local process. stop waits for exit; abort escalates after 500ms.
 * Optional context fields: stdin (pipe stdin and expose write/end),
 * outputLimit (characters emitted; default 50000, Infinity for long-lived
 * processes; a single "[output truncated]" notice marks the cut) and onSpawn
 * (observer receiving the session once spawned). stop({ signal, graceMs })
 * sends `signal` (default SIGTERM) to the process group and escalates to
 * SIGKILL after graceMs (default 500).
 */
export function startProcess(command, args, context) {
  if (!context || typeof context.workspaceRoot !== "string")
    throw new TypeError("workspaceRoot required");
  if (context.signal?.aborted) throw new Error("Execution already aborted");
  const env = { ...process.env, ...context.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, args, {
    cwd: context.workspaceRoot,
    shell: false,
    stdio: [context.stdin ? "pipe" : "ignore", "pipe", "pipe"],
    env,
    detached: process.platform !== "win32",
  });
  let timer,
    stopped = false,
    output = 0;
  const limit = context.outputLimit ?? 50000;
  const kill = (signal) => {
    if (child.pid === undefined) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, signal);
      else {
        const force = signal === "SIGKILL" || signal === "SIGTERM";
        const result = spawnSync(
          "taskkill",
          ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
          { windowsHide: true, stdio: "ignore", timeout: 3000 },
        );
        if (force && (result.error || result.status !== 0)) child.kill(signal);
      }
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  };
  let killAt = Infinity;
  const abort = (signal = "SIGTERM", graceMs = 500) => {
    if (stopped) return;
    kill(signal);
    // A later, more urgent stop (for example shutdown) may shorten the grace.
    if (Date.now() + graceMs < killAt) {
      killAt = Date.now() + graceMs;
      clearTimeout(timer);
      timer = setTimeout(() => kill("SIGKILL"), graceMs);
    }
  };
  const onAbort = () => abort();
  const completion = new Promise((resolve, reject) => {
    const clean = () => {
      stopped = true;
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (e) => {
      clean();
      reject(e);
    });
    child.on("close", (exitCode) => {
      clean();
      resolve({ exitCode, aborted: Boolean(context.signal?.aborted) });
    });
    let truncated = false;
    for (const type of ["stdout", "stderr"]) {
      // Decode as a stream so multi-byte characters split across chunks survive.
      child[type].setEncoding("utf8");
      child[type].on("data", (chunk) => {
        const text = chunk.slice(0, Math.max(0, limit - output));
        output += text.length;
        if (text) context.emit?.({ type, text });
        if (text.length < chunk.length && !truncated) {
          truncated = true;
          context.emit?.({ type: "stderr", text: "\n[output truncated]\n" });
        }
      });
    }
  });
  context.signal?.addEventListener("abort", onAbort, { once: true });
  if (context.signal?.aborted) abort();
  child.stdin?.on("error", () => {});
  const session = {
    id: randomUUID(),
    pid: child.pid,
    completion,
    get running() {
      return !stopped;
    },
    write(text) {
      if (
        !child.stdin ||
        stopped ||
        child.stdin.destroyed ||
        child.stdin.writableEnded
      )
        return false;
      child.stdin.write(text);
      return true;
    },
    end() {
      child.stdin?.end();
    },
    /** Synchronous best-effort termination for process exit handlers. */
    killNow() {
      if (!stopped) kill("SIGKILL");
    },
    async stop({ signal = "SIGTERM", graceMs = 500 } = {}) {
      abort(signal, graceMs);
      await completion;
    },
  };
  context.onSpawn?.(session);
  return session;
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
