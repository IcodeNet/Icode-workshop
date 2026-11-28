import { courseEnvironment } from "./setup.mjs";
import { executionWorkspace } from "./variants.mjs";
import { startProcess } from "../adapter-api/node.mjs";
import { labConfig } from "./runtime.mjs";
import { registerProcess } from "./processes.mjs";
const sessions = new Map();
export function validatePreview(preview) {
  if (preview === undefined) return undefined;
  if (
    !preview ||
    !Array.isArray(preview.command) ||
    !preview.command.length ||
    preview.command.some((x) => typeof x !== "string" || !x) ||
    !Number.isInteger(preview.port) ||
    preview.port < 1024 ||
    preview.port > 65535 ||
    [4317, 5173, Number(process.env.WORKSHOP_SANDBOX_PORT ?? 4318)].includes(preview.port)
  )
    throw new Error("Invalid preview configuration");
  return { command: preview.command, port: preview.port };
}
export async function stopPreview(id) {
  const session = sessions.get(id);
  if (session) {
    await session.stop();
    await session.cleanup?.();
    sessions.delete(id);
  }
  return { running: false };
}
export async function startPreview(root, id, variant = "playground") {
  const config = await labConfig(root, id);
  if (!config.preview) throw new Error("This lab has no preview");
  await stopPreview(id);
  const { port, command } = config.preview;
  if ([...sessions.values()].some((s) => s.port === port))
    throw new Error("Preview port already used by another lab");
  // Refuse to claim an unrelated process as the newly launched preview.
  try {
    await fetch("http://127.0.0.1:" + port, {
      signal: AbortSignal.timeout(400),
    });
    throw Object.assign(new Error("Preview port already occupied"), {
      code: "PORT_OCCUPIED",
      port,
    });
  } catch (e) {
    if (e.code === "PORT_OCCUPIED") throw e;
  }
  let output = "",
    finished = false;
  const workspace = await executionWorkspace(root, id, variant);
  const session = startProcess(command[0], command.slice(1), {
    workspaceRoot: workspace.path,
    env: { ...courseEnvironment(root), PORT: String(port), HOST: "127.0.0.1" },
    emit: (e) => {
      output = (output + e.text).slice(-10000);
    },
  });
  session.cleanup = workspace.cleanup;
  session.port = port;
  session.variant = variant;
  sessions.set(id, session);
  registerProcess({
    kind: "preview",
    label: "Preview " + id + " (" + variant + ")",
    command,
    port,
    session,
    stop: () => stopPreview(id),
  });
  session.completion.then(
    () => {
      finished = true;
      workspace.cleanup().catch(() => {});
      if (sessions.get(id) === session) sessions.delete(id);
    },
    () => {
      finished = true;
      workspace.cleanup().catch(() => {});
      if (sessions.get(id) === session) sessions.delete(id);
    },
  );
  const url = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) {
    if (finished) throw new Error("Preview exited: " + output);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300) });
      if (response.ok && !finished) return { running: true, url };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await stopPreview(id);
  throw new Error("Preview did not become ready: " + output);
}
export async function stopAllPreviews() {
  await Promise.all([...sessions.keys()].map(stopPreview));
}

export function runningPreviews() {
  return [...sessions.entries()].map(([id, s]) => ({
    id,
    port: s.port,
    variant: s.variant,
  }));
}
