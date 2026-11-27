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
    session,
    stopping: null,
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
    .map(({ stop, session, stopping, ...item }) => ({
      ...item,
      stopping: Boolean(stopping),
    }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
/** Stop one entry. Concurrent stops of the same entry share one operation. */
export async function stopProcess(id) {
  const entry = entries.get(id);
  if (!entry) throw new Error("Unknown or finished process");
  entry.stopping ??= Promise.resolve().then(() => entry.stop());
  await entry.stopping;
  return { stopped: true };
}
export function ownedPids() {
  return new Set(
    [...entries.values()].map((entry) => entry.pid).filter(Boolean),
  );
}
/** Synchronous last-resort cleanup for every registered process (exit handler). */
export function killAllNow() {
  for (const entry of entries.values()) entry.session?.killNow?.();
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
/** Parse `ps -A -o pid=,ppid=,pgid=,uid=,lstart=` output. */
export function parsePs(text) {
  const table = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, ppid, pgid, uid, started] = match;
    table.set(Number(pid), {
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      uid: Number(uid),
      started: started.trim(),
    });
  }
  return table;
}
function linuxProcTable() {
  const table = new Map();
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      table.set(Number(pid), {
        pid: Number(pid),
        ppid: Number(fields[1]),
        pgid: Number(fields[2]),
        uid: Number(status.match(/^Uid:\s+(\d+)/m)?.[1] ?? -1),
        started: fields[19],
      });
    } catch {}
  }
  return table;
}
/** Snapshot of processes: pid → { ppid, pgid, uid, started }. Never uses a shell. */
export function processTable() {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToFileTimeUtc() }",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
    const table = new Map();
    for (const line of (result.stdout || "").split(/\r?\n/)) {
      const [pid, ppid, started] = line.trim().split(/\s+/);
      if (/^\d+$/.test(pid ?? ""))
        table.set(Number(pid), {
          pid: Number(pid),
          ppid: Number(ppid),
          pgid: null,
          uid: null,
          started,
        });
    }
    return table;
  }
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,uid=,lstart="], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (!ps.error && ps.status === 0 && ps.stdout) return parsePs(ps.stdout);
  if (process.platform === "linux") return linuxProcTable();
  return new Map();
}
/** Ancestors of pid (nearest first), from a process table. */
export function ancestors(table, pid) {
  const chain = [];
  const seen = new Set([pid]);
  let current = table.get(pid);
  while (current && current.ppid > 0 && !seen.has(current.ppid)) {
    chain.push(current.ppid);
    seen.add(current.ppid);
    current = table.get(current.ppid);
  }
  return chain;
}
/**
 * Classify a holder against the engine. engineOwned covers the whole tree of
 * every registered process: the holder or one of its ancestors is registered,
 * or (POSIX) it is in a registered process group, or it descends from the engine.
 */
export function classifyHolder(table, pid, owned, enginePid = process.pid) {
  const info = table.get(pid);
  const chain = ancestors(table, pid);
  const engineChain = new Set([enginePid, ...ancestors(table, enginePid)]);
  if (process.ppid) engineChain.add(process.ppid);
  const self = engineChain.has(pid);
  const engineOwned =
    !self &&
    (owned.has(pid) ||
      chain.some((p) => owned.has(p) || p === enginePid) ||
      (info?.pgid != null &&
        (owned.has(info.pgid) || info.pgid === table.get(enginePid)?.pgid)));
  return { self, engineOwned, info };
}

// Shared daemons that multiplex many ports; stopping them breaks far more than one app.
const MULTIPLEXERS =
  /(^|[\\/\s])(com\.docker[\w.-]*|docker-proxy|dockerd|containerd[\w-]*|vpnkit[\w-]*|wslrelay|wslhost|svchost|system|launchd|systemd[\w-]*|sshd?|kubectl|code helper|code|cursor)(\.exe)?($|\s)/i;
export function isMultiplexer(command, pid) {
  return (
    (process.platform === "win32" && pid <= 4) ||
    MULTIPLEXERS.test(command || "")
  );
}
export const processName = (command) =>
  (command || "").trim().split(/\s+/)[0].split(/[\\/]/).pop() || "";

/**
 * Terminate a foreign process (never its tree). Before escalating, re-check
 * that the same process (same start time) still exists, so a reused PID is
 * never killed.
 */
export function terminatePid(pid, { started, graceMs = 1500 } = {}) {
  const sameProcess = () => {
    const info = processTable().get(pid);
    return Boolean(info) && (started === undefined || info.started === started);
  };
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 5000,
    });
    setTimeout(() => {
      if (sameProcess())
        spawnSync("taskkill", ["/PID", String(pid), "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 5000,
        });
    }, graceMs).unref();
    return;
  }
  process.kill(pid, "SIGTERM");
  setTimeout(() => {
    try {
      if (sameProcess()) process.kill(pid, "SIGKILL");
    } catch {}
  }, graceMs).unref();
}

/**
 * Describe who holds a port, or free it. `allowedPorts` are the ports the
 * course configures for previews; any other port is refused before any scan.
 * With `confirmPid` the matching holder is terminated, provided it is still
 * the holder and none of the refusals below apply. A listener on a wildcard
 * address also requires `confirmName`, the process name the learner typed.
 */
export async function portHolder(
  port,
  allowedPorts,
  { confirmPid, confirmName, table: givenTable, enginePid = process.pid } = {},
) {
  if (!allowedPorts.includes(port))
    throw new Error("Only configured preview ports can be freed");
  const owners = findPortOwners(port);
  const owned = ownedPids();
  const table = givenTable ?? (owners.length ? processTable() : new Map());
  const uid = process.getuid?.();
  const holders = owners.map((owner) => {
    const { self, engineOwned, info } = classifyHolder(
      table,
      owner.pid,
      owned,
      enginePid,
    );
    const wildcard = owner.addresses.some((a) => WILDCARD.test(a));
    const name = processName(owner.command);
    const refusal = self
      ? "This is the workshop itself (or the program that started it)."
      : engineOwned
        ? "This is a workshop process; stop it from the Processes tab."
        : !owner.addresses.every(isLoopbackListener)
          ? "It listens on a non-loopback address and will not be stopped from here."
          : isMultiplexer(owner.command, owner.pid)
            ? "It is a shared system or container service that serves many ports; stop it with its own tools."
            : uid !== undefined && info?.uid != null && info.uid !== uid
              ? "It belongs to another user."
              : null;
    return {
      pid: owner.pid,
      command: owner.command,
      name,
      addresses: owner.addresses,
      loopback: owner.addresses.every(isLoopbackListener),
      wildcard,
      engineOwned,
      self,
      refusal,
      started: info?.started,
    };
  });
  if (confirmPid === undefined)
    return {
      port,
      holders: holders.map(({ started, ...holder }) => holder),
    };
  const holder = holders.find((h) => h.pid === confirmPid);
  if (!holder) throw new Error("That process no longer holds the port");
  if (holder.refusal) throw new Error("Refused: " + holder.refusal);
  if (holder.wildcard && confirmName !== holder.name)
    throw new Error(
      "This process listens on all interfaces; type its name (" +
        holder.name +
        ") to confirm",
    );
  terminatePid(holder.pid, { started: holder.started });
  return { port, stopped: holder.pid };
}
