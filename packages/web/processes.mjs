// Registry of every process the engine starts (previews, tests, actions,
// sidecars), plus helpers to identify and stop a foreign process holding a
// configured loopback port.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

const entries = new Map();
const KINDS = new Set(["preview", "test", "action", "sidecar"]);

/**
 * Track a started session. `session` needs `completion` and `stop()`; `pid`
 * is optional. The entry disappears when the process finishes.
 */
export function registerProcess({ kind, label, command, port, session, stop }) {
  if (!KINDS.has(kind)) throw new Error("Unknown process kind");
  const id = randomUUID();
  const entry = {
    id,
    kind,
    label: String(label || kind),
    command: Array.isArray(command) ? command.map(String) : [String(command)],
    pid: session?.pid ?? null,
    port: Number.isInteger(port) ? port : null,
    startedAt: new Date().toISOString(),
    stop: stop || (() => session.stop()),
  };
  entries.set(id, entry);
  const forget = () => {
    if (entries.get(id) === entry) entries.delete(id);
  };
  session?.completion?.then(forget, forget);
  return { id, unregister: forget };
}
export function listProcesses() {
  return [...entries.values()]
    .map(({ stop, ...item }) => item)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export async function stopProcess(id) {
  const entry = entries.get(id);
  if (!entry) throw new Error("Unknown or finished process");
  await entry.stop();
  entries.delete(id);
  return { stopped: true };
}
export function ownedPids() {
  return new Set(
    [...entries.values()].map((entry) => entry.pid).filter(Boolean),
  );
}

const LOOPBACK =
  /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/;
const WILDCARD = /^(0\.0\.0\.0|::|\*|::ffff:0\.0\.0\.0)$/;
/** True when a listener address is reachable on, and only claims, loopback or all interfaces. */
export function isLoopbackListener(address) {
  return LOOPBACK.test(address) || WILDCARD.test(address);
}

/** Parse `lsof -nP -iTCP:<port> -sTCP:LISTEN -F pcn` output. */
export function parseLsof(text, port) {
  const owners = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      current = { pid: Number(line.slice(1)), command: "", addresses: [] };
      owners.push(current);
    } else if (current && line.startsWith("c")) current.command = line.slice(1);
    else if (current && line.startsWith("n")) {
      const match = line.slice(1).match(/^\[?(.*?)\]?:(\d+)$/);
      if (match && Number(match[2]) === port) current.addresses.push(match[1]);
    }
  }
  return owners.filter((o) => o.pid > 0 && o.addresses.length);
}
/** Parse `netstat -ano -p TCP` (Windows) output. */
export function parseNetstat(text, port) {
  const owners = new Map();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || !/^TCP/i.test(parts[0])) continue;
    if (!/LISTEN/i.test(parts[3])) continue;
    const match = parts[1].match(/^\[?(.*?)\]?:(\d+)$/);
    if (!match || Number(match[2]) !== port) continue;
    const pid = Number(parts[4]);
    if (!owners.has(pid)) owners.set(pid, { pid, command: "", addresses: [] });
    owners.get(pid).addresses.push(match[1]);
  }
  return [...owners.values()].filter((o) => o.pid > 0);
}
/** Parse /proc/net/tcp{,6} rows; returns socket inodes listening on port. */
export function parseProcNet(text, port) {
  const result = [];
  for (const line of text.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10 || parts[3] !== "0A") continue;
    const [hex, portHex] = parts[1].split(":");
    if (parseInt(portHex, 16) !== port) continue;
    let address;
    if (hex.length === 8)
      address = hex
        .match(/../g)
        .reverse()
        .map((b) => parseInt(b, 16))
        .join(".");
    else
      address =
        hex === "00000000000000000000000000000000"
          ? "::"
          : hex === "00000000000000000000000001000000"
            ? "::1"
            : hex === "0000000000000000FFFF00000100007F"
              ? "::ffff:127.0.0.1"
              : "ipv6:" + hex;
    result.push({ inode: parts[9], address });
  }
  return result;
}
function linuxOwners(port) {
  const sockets = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      sockets.push(...parseProcNet(readFileSync(file, "utf8"), port));
    } catch {}
  }
  if (!sockets.length) return [];
  const byInode = new Map(sockets.map((s) => [s.inode, s.address]));
  const owners = new Map();
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    let fds;
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let target;
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const inode = target.match(/^socket:\[(\d+)\]$/)?.[1];
      if (!inode || !byInode.has(inode)) continue;
      if (!owners.has(pid)) {
        let command = "";
        try {
          command = readFileSync(`/proc/${pid}/cmdline`, "utf8")
            .split("\0")
            .filter(Boolean)
            .join(" ");
        } catch {}
        owners.set(pid, { pid: Number(pid), command, addresses: [] });
      }
      owners.get(pid).addresses.push(byInode.get(inode));
    }
  }
  return [...owners.values()];
}
/** Find processes listening on a TCP port. Never uses a shell. */
export function findPortOwners(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  if (process.platform === "win32") {
    const result = spawnSync("netstat", ["-ano", "-p", "TCP"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const owners = parseNetstat(result.stdout || "", port);
    for (const owner of owners) {
      const info = spawnSync(
        "tasklist",
        ["/FI", "PID eq " + owner.pid, "/FO", "CSV", "/NH"],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      );
      owner.command =
        (info.stdout || "").split(",")[0]?.replaceAll('"', "") || "";
    }
    return owners;
  }
  const lsof = spawnSync(
    "lsof",
    ["-nP", "-iTCP:" + port, "-sTCP:LISTEN", "-F", "pcn"],
    { encoding: "utf8", timeout: 5000 },
  );
  if (!lsof.error && lsof.stdout) return parseLsof(lsof.stdout, port);
  if (process.platform === "linux") return linuxOwners(port);
  return [];
}
export function terminatePid(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 5000,
    });
    if (result.status !== 0) throw new Error("Could not stop process " + pid);
    return;
  }
  process.kill(pid, "SIGTERM");
  setTimeout(() => {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {}
  }, 1500).unref();
}

/**
 * Describe who holds a port, or free it. `allowedPorts` are the ports the
 * course configures for previews; any other port is refused. With `confirmPid`
 * the matching holder is terminated, provided it is still the holder, it is not
 * the engine or one of its processes, and it listens on loopback/wildcard only.
 */
export async function portHolder(port, allowedPorts, { confirmPid } = {}) {
  if (!allowedPorts.includes(port))
    throw new Error("Only configured preview ports can be freed");
  const owners = findPortOwners(port);
  const owned = ownedPids();
  const holders = owners.map((owner) => ({
    pid: owner.pid,
    command: owner.command,
    addresses: owner.addresses,
    loopback: owner.addresses.every(isLoopbackListener),
    engineOwned: owned.has(owner.pid),
    self: owner.pid === process.pid || owner.pid === process.ppid,
  }));
  if (confirmPid === undefined) return { port, holders };
  const holder = holders.find((h) => h.pid === confirmPid);
  if (!holder) throw new Error("That process no longer holds the port");
  if (holder.self) throw new Error("Refusing to stop the workshop itself");
  if (holder.engineOwned)
    throw new Error("Use the Processes view to stop workshop processes");
  if (!holder.loopback)
    throw new Error(
      "Refusing to stop a process listening on a non-loopback address",
    );
  terminatePid(holder.pid);
  return { port, stopped: holder.pid };
}
