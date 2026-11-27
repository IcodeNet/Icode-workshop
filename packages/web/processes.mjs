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
/**
 * Snapshot of processes: pid → { ppid, pgid, uid, started }. Never uses a
 * shell. Throws when the list cannot be read or parsed (command missing,
 * failing, timing out or printing nothing usable): callers that destroy
 * processes must fail closed. `run` and `readProc` are injectable for tests.
 */
export function processTable({
  platform = process.platform,
  run = spawnSync,
  readProc = linuxProcTable,
} = {}) {
  const fail = (why) => {
    throw new Error("Could not read the process list (" + why + ")");
  };
  const check = (result, what) => {
    if (result?.error) fail(what + ": " + result.error.message);
    if (result?.status !== 0)
      fail(what + " exited with status " + result?.status);
    if (!result.stdout || !String(result.stdout).trim())
      fail(what + " printed nothing");
  };
  if (platform === "win32") {
    const result = run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId,$_.ParentProcessId,$_.CreationDate.ToFileTimeUtc() }",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
    check(result, "PowerShell");
    const table = new Map();
    for (const line of String(result.stdout).split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+) (\d+) (\d+)$/);
      if (match)
        table.set(Number(match[1]), {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          pgid: null,
          uid: null,
          started: match[3],
        });
    }
    if (!table.size) fail("PowerShell output could not be parsed");
    return table;
  }
  const ps = run("ps", ["-A", "-o", "pid=,ppid=,pgid=,uid=,lstart="], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, LC_ALL: "C" },
  });
  try {
    check(ps, "ps");
    const table = parsePs(String(ps.stdout));
    if (!table.size) fail("ps output could not be parsed");
    return table;
  } catch (error) {
    if (platform !== "linux") throw error;
    let table;
    try {
      table = readProc();
    } catch {}
    if (!table?.size) throw error;
    return table;
  }
}
/** Parse `tasklist /V /FO CSV /NH` output: the "User Name" column. */
export function parseTasklistUser(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('"'));
  if (!line) return null;
  const fields = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]);
  const user = fields[6];
  return user && user !== "N/A" ? user : null;
}
/** Windows owner of a process ("DOMAIN\\user"); throws when unknown. */
export function windowsOwner(pid, { run = spawnSync } = {}) {
  const result = run(
    "tasklist",
    ["/V", "/FO", "CSV", "/NH", "/FI", "PID eq " + pid],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    },
  );
  if (result?.error || result?.status !== 0)
    throw new Error("could not query the process owner");
  const user = parseTasklistUser(result.stdout);
  if (!user) throw new Error("the process owner is not visible");
  return user;
}
export function currentWindowsUser(env = process.env) {
  return (env.USERDOMAIN ? env.USERDOMAIN + "\\" : "") + (env.USERNAME || "");
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
  /(^|[\\/\s])(com\.docker[\w.-]*|docker-proxy|dockerd|containerd[\w-]*|vpnkit[\w-]*|wslrelay|wslhost|svchost|system|launchd|systemd[\w-]*|sshd?|kubectl|code helper|code|cursor)(\.exe)?($|[\s:])/i;
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
  // Escalate only when the same process provably still exists; if the
  // process list cannot be read, do nothing more.
  const sameProcess = () => {
    try {
      const info = processTable().get(pid);
      return Boolean(info) && started !== undefined && info.started === started;
    } catch {
      return false;
    }
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
  {
    confirmPid,
    confirmName,
    table: givenTable,
    enginePid = process.pid,
    platform = process.platform,
    findOwners = findPortOwners,
    loadTable = () => processTable(),
    ownerOf = (pid) => windowsOwner(pid),
    currentUser = currentWindowsUser(),
    uid = process.getuid?.(),
  } = {},
) {
  if (!allowedPorts.includes(port))
    throw new Error("Only configured preview ports can be freed");
  const owners = findOwners(port);
  const owned = ownedPids();
  // Fail closed: without a readable process list nobody can be verified.
  let table = givenTable,
    tableError = null;
  if (!table && owners.length) {
    try {
      table = loadTable();
    } catch (error) {
      tableError = error.message;
    }
  }
  table ??= new Map();
  const holders = owners.map((owner) => {
    const { self, engineOwned, info } = classifyHolder(
      table,
      owner.pid,
      owned,
      enginePid,
    );
    const wildcard = owner.addresses.some((a) => WILDCARD.test(a));
    const name = processName(owner.command);
    let userRefusal = null;
    if (!tableError && info) {
      if (platform === "win32") {
        try {
          const user = ownerOf(owner.pid);
          if (user.toLowerCase() !== currentUser.toLowerCase())
            userRefusal = "It belongs to another user.";
        } catch (error) {
          userRefusal =
            "Could not verify who owns this process (" +
            error.message +
            "); nothing was stopped.";
        }
      } else if (!Number.isInteger(info.uid) || info.uid < 0)
        userRefusal =
          "Could not verify who owns this process; nothing was stopped.";
      else if (uid !== undefined && info.uid !== uid)
        userRefusal = "It belongs to another user.";
    }
    const refusal =
      owner.pid === enginePid || self
        ? "This is the workshop itself (or the program that started it)."
        : tableError
          ? "Could not verify who owns this process: " +
            tableError +
            ". Nothing was stopped."
          : !info
            ? "Could not verify who owns this process: it is not in the process list. Nothing was stopped."
            : engineOwned
              ? "This is a workshop process; stop it from the Processes tab."
              : !owner.addresses.every(isLoopbackListener)
                ? "It listens on a non-loopback address and will not be stopped from here."
                : isMultiplexer(owner.command, owner.pid)
                  ? "It is a shared system or container service that serves many ports; stop it with its own tools."
                  : userRefusal;
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
