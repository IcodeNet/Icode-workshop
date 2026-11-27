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
