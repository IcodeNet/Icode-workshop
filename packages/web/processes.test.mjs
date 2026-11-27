import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import {
  registerProcess,
  listProcesses,
  stopProcess,
  parseLsof,
  parseNetstat,
  parseProcNet,
  parsePs,
  classifyHolder,
  isLoopbackListener,
  isMultiplexer,
  findPortOwners,
  portHolder,
  processTable,
  terminatePid,
  windowsOwner,
  parseTasklistUser,
} from "./processes.mjs";
import { startProcess } from "../adapter-api/node.mjs";
import { startScript } from "./operations.mjs";
import { operationsCourse } from "./test-support/operations-course.mjs";

// In these tests the test runner plays the engine; a fake engine PID keeps
// the runner's own children "foreign" unless a test says otherwise.
const FOREIGN = { enginePid: -1 };
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}
function squatter(port, host = "127.0.0.1") {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require("node:net").createServer().listen(${port},${JSON.stringify(host)},()=>console.log("up"))`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  return {
    child,
    ready: once(child.stdout, "data"),
    closed: once(child, "close"),
  };
}
async function ownersOf(port) {
  for (let i = 0; i < 50; i++) {
    const owners = findPortOwners(port);
    if (owners.length) return owners;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

test("registry lists engine processes and stops them; concurrent stops share one operation", async () => {
  const session = startProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    {
      workspaceRoot: tmpdir(),
    },
  );
  let stops = 0;
  const { id } = registerProcess({
    kind: "preview",
    label: "Preview 03",
    command: ["node", "server.mjs"],
    port: 4403,
    session,
    stop: () => {
      stops++;
      return session.stop();
    },
  });
  const item = listProcesses().find((p) => p.id === id);
  assert.equal(item.kind, "preview");
  assert.equal(item.pid, session.pid);
  assert.equal(item.port, 4403);
  assert.ok(Date.parse(item.startedAt));
  assert.equal(item.stop, undefined, "stop function is not serialised");
  assert.equal(item.session, undefined, "session is not serialised");
  await Promise.all([stopProcess(id), stopProcess(id)]);
  assert.equal(stops, 1);
  assert.equal(
    listProcesses().some((p) => p.id === id),
    false,
  );
  await assert.rejects(stopProcess(id), /Unknown or finished/);
  assert.throws(
    () => registerProcess({ kind: "shell", session }),
    /Unknown process kind/,
  );
});

test("finished processes disappear from the registry", async () => {
  const session = startProcess(process.execPath, ["-e", ""], {
    workspaceRoot: tmpdir(),
  });
  const { id } = registerProcess({
    kind: "test",
    label: "t",
    command: "node",
    session,
  });
  await session.completion;
  await new Promise((r) => setImmediate(r));
  assert.equal(
    listProcesses().some((p) => p.id === id),
    false,
  );
});

test("parsers: lsof, netstat, /proc/net, ps; tree classification; multiplexers", () => {
  assert.deepEqual(
    parseLsof(
      "p123\ncnode\nn127.0.0.1:4403\nn[::1]:4403\np9\ncother\nn*:80\n",
      4403,
    ),
    [{ pid: 123, command: "node", addresses: ["127.0.0.1", "::1"] }],
  );
  assert.deepEqual(
    parseNetstat(
      "  Proto  Local Address  Foreign Address  State  PID\r\n  TCP    0.0.0.0:4403  0.0.0.0:0  LISTENING  4321\r\n  TCP    [::1]:4403  [::]:0  LISTENING  4321\r\n  TCP    127.0.0.1:5000  0.0.0.0:0  LISTENING  1\r\n",
      4403,
    ),
    [{ pid: 4321, command: "", addresses: ["0.0.0.0", "::1"] }],
  );
  const proc =
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n" +
    "   0: 0100007F:1133 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55555 1 0\n" +
    "   1: 0100007F:1133 0100007F:9999 01 00000000:00000000 00:00000000 00000000  1000        0 66666 1 0\n";
  assert.deepEqual(parseProcNet(proc, 0x1133), [
    { inode: "55555", address: "127.0.0.1" },
  ]);
  for (const address of [
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "::",
    "*",
    "::ffff:127.0.0.1",
  ])
    assert.ok(isLoopbackListener(address), address);
  for (const address of ["192.168.1.4", "10.0.0.1", "fe80::1"])
    assert.equal(isLoopbackListener(address), false, address);

  const table = parsePs(
    [
      "  1     0     1     0 Mon Jan  1 00:00:00 2026",
      " 10     1    10  1000 Mon Jan  1 00:00:01 2026", // terminal
      " 20    10    20  1000 Mon Jan  1 00:00:02 2026", // workshop CLI
      " 30    20    30  1000 Mon Jan  1 00:00:03 2026", // engine (group leader)
      " 40    30    40  1000 Mon Jan  1 00:00:04 2026", // registered sidecar npm
      " 41    40    40  1000 Mon Jan  1 00:00:05 2026", // sh
      " 42    41    40  1000 Mon Jan  1 00:00:06 2026", // node listener (grandchild)
      " 50    30    50  1000 Mon Jan  1 00:00:07 2026", // editor launched by the engine
      " 60    10    60  1000 Mon Jan  1 00:00:08 2026", // foreign dev server
      " 70    40    70  1000 Mon Jan  1 00:00:09 2026", // re-grouped descendant of a registered process
    ].join("\n"),
  );
  assert.equal(table.get(42).started, "Mon Jan  1 00:00:06 2026");
  const owned = new Set([40]);
  assert.deepEqual(
    Object.fromEntries(
      [42, 70, 50, 60, 30, 20, 10].map((pid) => {
        const { self, engineOwned } = classifyHolder(table, pid, owned, 30);
        return [pid, self ? "self" : engineOwned ? "owned" : "foreign"];
      }),
    ),
    {
      42: "owned",
      70: "owned",
      50: "owned",
      60: "foreign",
      30: "self",
      20: "self",
      10: "self",
    },
  );
  assert.ok(
    isMultiplexer(
      "/Applications/Docker.app/Contents/MacOS/com.docker.backend",
      900,
    ),
  );
  assert.ok(isMultiplexer("docker-proxy -proto tcp", 900));
  assert.ok(isMultiplexer("svchost.exe", 900));
  assert.equal(isMultiplexer("node /home/me/code/server.mjs", 900), false);
});

test(
  "a foreign process on a configured port is identified and freed only with its pid",
  { timeout: 20000 },
  async (t) => {
    const port = await freePort();
    const { child, ready, closed } = squatter(port);
    try {
      await ready;
      const owners = await ownersOf(port);
      if (!owners.length)
        return t.skip("No port-owner lookup available on this host");
      assert.equal(owners[0].pid, child.pid);
      await assert.rejects(
        portHolder(port, [], FOREIGN),
        /Only configured preview ports/,
      );
      const { holders } = await portHolder(port, [port], FOREIGN);
      assert.equal(holders[0].pid, child.pid);
      assert.equal(holders[0].loopback, true);
      assert.equal(holders[0].wildcard, false);
      assert.equal(holders[0].refusal, null);
      await assert.rejects(
        portHolder(port, [port], {
          ...FOREIGN,
          confirmPid: child.pid + 100000,
        }),
        /no longer holds/,
      );
      const result = await portHolder(port, [port], {
        ...FOREIGN,
        confirmPid: child.pid,
      });
      assert.equal(result.stopped, child.pid);
      await closed;
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);

test(
  "wildcard listeners require typing the process name",
  { timeout: 20000 },
  async (t) => {
    const port = await freePort();
    const { child, ready, closed } = squatter(port, "0.0.0.0");
    try {
      await ready;
      if (!(await ownersOf(port)).length)
        return t.skip("No port-owner lookup available");
      const { holders } = await portHolder(port, [port], FOREIGN);
      assert.equal(holders[0].wildcard, true);
      const name = holders[0].name;
      assert.ok(name);
      await assert.rejects(
        portHolder(port, [port], { ...FOREIGN, confirmPid: child.pid }),
        /type its name/,
      );
      await assert.rejects(
        portHolder(port, [port], {
          ...FOREIGN,
          confirmPid: child.pid,
          confirmName: "other",
        }),
        /type its name/,
      );
      await portHolder(port, [port], {
        ...FOREIGN,
        confirmPid: child.pid,
        confirmName: name,
      });
      await closed;
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);

test(
  "a listener on a non-loopback address is refused end to end",
  { timeout: 20000 },
  async (t) => {
    const address = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!address) return t.skip("No non-loopback IPv4 interface");
    const port = await freePort();
    const { child, ready } = squatter(port, address);
    try {
      await ready;
      if (!(await ownersOf(port)).length)
        return t.skip("No port-owner lookup available");
      const { holders } = await portHolder(port, [port], FOREIGN);
      assert.equal(holders[0].loopback, false);
      assert.match(holders[0].refusal, /non-loopback/);
      await assert.rejects(
        portHolder(port, [port], {
          ...FOREIGN,
          confirmPid: child.pid,
          confirmName: holders[0].name,
        }),
        /Refused: .*non-loopback/,
      );
      assert.ok(alive(child.pid));
    } finally {
      child.kill("SIGKILL");
    }
  },
);

test("the engine itself is refused", { timeout: 20000 }, async (t) => {
  // Here the test runner is the engine and listens on the port itself.
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    if (!(await ownersOf(port)).length)
      return t.skip("No port-owner lookup available");
    const { holders } = await portHolder(port, [port]);
    assert.equal(holders[0].self, true);
    await assert.rejects(
      portHolder(port, [port], { confirmPid: process.pid }),
      /Refused: .*workshop itself/,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test(
  "engine-owned descendants (npm → sh → node) are refused",
  { timeout: 30000 },
  async (t) => {
    const root = await operationsCourse();
    const port = await freePort();
    let output = "";
    const session = startScript(root, "listen", {
      env: { PORT: String(port) },
      emit: (e) => (output += e.text),
    });
    const { id } = registerProcess({
      kind: "sidecar",
      label: "listener",
      command: "npm run listen",
      session,
    });
    try {
      const owners = await ownersOf(port);
      if (!owners.length)
        return t.skip("No port-owner lookup available: " + output);
      assert.notEqual(
        owners[0].pid,
        session.pid,
        "the listener is a descendant, not the npm process",
      );
      const { holders } = await portHolder(port, [port], FOREIGN);
      assert.equal(holders[0].engineOwned, true);
      await assert.rejects(
        portHolder(port, [port], { ...FOREIGN, confirmPid: owners[0].pid }),
        /Processes tab/,
      );
      assert.ok(alive(owners[0].pid));
    } finally {
      await stopProcess(id).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "escalation to SIGKILL re-checks process identity (PID reuse)",
  { skip: process.platform === "win32", timeout: 20000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.on("SIGTERM",()=>{});console.log("up");setInterval(()=>{},1000)',
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    await once(child.stdout, "data");
    try {
      if (!processTable().get(child.pid))
        return t.skip("No process table available");
      // Recorded start time differs: the process must survive escalation.
      terminatePid(child.pid, {
        started: "not the same process",
        graceMs: 200,
      });
      await new Promise((r) => setTimeout(r, 800));
      assert.ok(alive(child.pid));
      // Matching identity: escalation proceeds.
      terminatePid(child.pid, {
        started: processTable().get(child.pid).started,
        graceMs: 200,
      });
      await once(child, "close");
    } finally {
      child.kill("SIGKILL");
    }
  },
);

// ---- Fail-closed ownership (N1) and refusals inside portHolder (N6) ----
const ok = (stdout) => ({ status: 0, stdout });
const failures = {
  missing: () => ({
    error: Object.assign(new Error("spawn ps ENOENT"), { code: "ENOENT" }),
  }),
  failing: () => ({ status: 1, stdout: "" }),
  timeout: () => ({
    error: Object.assign(new Error("spawnSync ETIMEDOUT"), {
      code: "ETIMEDOUT",
    }),
    status: null,
  }),
  empty: () => ok("   \n"),
  garbage: () => ok("<html>not a process list</html>\nERROR: access denied\n"),
};

test("processTable throws (never returns an empty list) when the process list is unavailable", () => {
  for (const [name, run] of Object.entries(failures)) {
    for (const platform of ["darwin", "win32"])
      assert.throws(
        () => processTable({ platform, run }),
        /Could not read the process list/,
        platform + " " + name,
      );
    // Linux falls back to /proc, and still fails closed when that is unavailable too.
    assert.throws(
      () => processTable({ platform: "linux", run, readProc: () => new Map() }),
      /Could not read the process list/,
      "linux " + name,
    );
    assert.throws(
      () =>
        processTable({
          platform: "linux",
          run,
          readProc: () => {
            throw new Error("EACCES");
          },
        }),
      /Could not read the process list/,
    );
  }
  assert.equal(
    processTable({
      platform: "darwin",
      run: () => ok(" 7 1 7 501 Mon Jan  1 00:00:00 2026\n"),
    }).get(7).uid,
    501,
  );
  assert.equal(
    processTable({
      platform: "win32",
      run: () => ok("7 1 133000000000000000\r\n"),
    }).get(7).ppid,
    1,
  );
});

const holderAt =
  (pid, command = "node server.mjs", addresses = ["127.0.0.1"]) =>
  () => [{ pid, command, addresses }];
const row = (pid, extra = {}) => [
  pid,
  { pid, ppid: 1, pgid: pid, uid: 1000, started: "s" + pid, ...extra },
];
const base = { enginePid: 5, uid: 1000, platform: "linux" };
const tableWith = (...rows) => new Map([row(1, { ppid: 0 }), row(5), ...rows]);

test("portHolder refuses and kills nothing when ownership cannot be verified", async () => {
  const killed = [];
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    if (pid >= 900000) {
      killed.push([pid, signal]);
      return true;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const pid = 900001;
    const cases = {
      "process list unavailable (POSIX)": {
        loadTable: () =>
          processTable({ platform: "darwin", run: failures.timeout }),
      },
      "process list unavailable (win32)": {
        platform: "win32",
        loadTable: () =>
          processTable({ platform: "win32", run: failures.garbage }),
      },
      "holder missing from the list": { table: tableWith() },
      "unknown uid (POSIX)": { table: tableWith(row(pid, { uid: null })) },
      "negative uid from /proc fallback": {
        table: tableWith(row(pid, { uid: -1 })),
      },
      "owner query fails (win32)": {
        platform: "win32",
        table: tableWith(row(pid, { uid: null, pgid: null })),
        ownerOf: () => {
          throw new Error("could not query the process owner");
        },
      },
      "owner not visible (win32, tasklist N/A)": {
        platform: "win32",
        table: tableWith(row(pid, { uid: null, pgid: null })),
        ownerOf: (p) =>
          windowsOwner(p, {
            run: () =>
              ok(
                '"node.exe","900001","Services","0","20,000 K","Unknown","N/A","0:00:01","N/A"\r\n',
              ),
          }),
      },
    };
    for (const [name, options] of Object.entries(cases)) {
      const opts = { ...base, findOwners: holderAt(pid), ...options };
      const { holders } = await portHolder(4403, [4403], opts);
      assert.match(
        holders[0].refusal,
        /Could not verify who owns this process/,
        name,
      );
      await assert.rejects(
        portHolder(4403, [4403], { ...opts, confirmPid: pid }),
        /Refused: Could not verify/,
        name,
      );
    }
    assert.deepEqual(killed, [], "nothing was signalled");
  } finally {
    process.kill = originalKill;
  }
});

test("portHolder refuses shared services and other users' processes", async () => {
  const pid = 900002;
  const refusalOf = async (options) =>
    (
      await portHolder(4403, [4403], {
        ...base,
        findOwners: holderAt(pid),
        ...options,
      })
    ).holders[0].refusal;
  assert.match(
    await refusalOf({
      table: tableWith(row(pid)),
      findOwners: holderAt(
        pid,
        "/Applications/Docker.app/Contents/MacOS/com.docker.backend",
      ),
    }),
    /shared system or container service/,
  );
  assert.match(
    await refusalOf({
      table: tableWith(row(pid)),
      findOwners: holderAt(pid, "sshd: me@pts/0"),
    }),
    /shared/,
  );
  assert.match(
    await refusalOf({ table: tableWith(row(pid, { uid: 0 })) }),
    /another user/,
  );
  assert.match(
    await refusalOf({
      platform: "win32",
      table: tableWith(row(pid, { uid: null, pgid: null })),
      ownerOf: () => "OTHERPC\\someone",
      currentUser: "MYPC\\me",
    }),
    /another user/,
  );
  // Same user, same check passes on both platforms.
  assert.equal(await refusalOf({ table: tableWith(row(pid)) }), null);
  assert.equal(
    await refusalOf({
      platform: "win32",
      table: tableWith(row(pid, { uid: null, pgid: null })),
      ownerOf: () => "MYPC\\Me",
      currentUser: "mypc\\me",
    }),
    null,
  );
  await assert.rejects(
    portHolder(4403, [4403], {
      ...base,
      table: tableWith(row(pid, { uid: 0 })),
      findOwners: holderAt(pid),
      confirmPid: pid,
    }),
    /Refused: It belongs to another user/,
  );
});

test("tasklist owner parsing", () => {
  assert.equal(
    parseTasklistUser(
      '"node.exe","42","Console","1","30,000 K","Running","MYPC\\me","0:00:02","N/A"\r\n',
    ),
    "MYPC\\me",
  );
  assert.equal(
    parseTasklistUser('"x","1","S","0","1 K","Unknown","N/A","0:00:00","N/A"'),
    null,
  );
  assert.equal(
    parseTasklistUser(
      "INFO: No tasks are running which match the specified criteria.",
    ),
    null,
  );
  assert.throws(
    () => windowsOwner(1, { run: () => ({ status: 1, stdout: "" }) }),
    /could not query/,
  );
});
