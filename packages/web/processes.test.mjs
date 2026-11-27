import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import {
  registerProcess,
  listProcesses,
  stopProcess,
  parseLsof,
  parseNetstat,
  parseProcNet,
  isLoopbackListener,
  findPortOwners,
  portHolder,
} from "./processes.mjs";
import { startProcess } from "../adapter-api/node.mjs";
import { tmpdir } from "node:os";

async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

test("registry lists engine processes and stops them", async () => {
  const session = startProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    {
      workspaceRoot: tmpdir(),
    },
  );
  const { id } = registerProcess({
    kind: "preview",
    label: "Preview 03",
    command: ["node", "server.mjs"],
    port: 4403,
    session,
  });
  const item = listProcesses().find((p) => p.id === id);
  assert.equal(item.kind, "preview");
  assert.equal(item.pid, session.pid);
  assert.equal(item.port, 4403);
  assert.ok(Date.parse(item.startedAt));
  assert.equal(item.stop, undefined, "stop function is not serialised");
  await stopProcess(id);
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

test("port owner parsers handle lsof, netstat and /proc formats", () => {
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
});

test(
  "a foreign process on a configured port is identified and freed only with its pid",
  { timeout: 20000 },
  async (t) => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `require("node:net").createServer().listen(${port},"127.0.0.1",()=>console.log("up"))`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const closed = once(child, "close");
    try {
      await once(child.stdout, "data");
      const owners = findPortOwners(port);
      if (!owners.length) {
        t.skip("No port-owner lookup available on this host (lsof or /proc)");
        return;
      }
      assert.equal(owners[0].pid, child.pid);
      await assert.rejects(
        portHolder(port, []),
        /Only configured preview ports/,
      );
      const { holders } = await portHolder(port, [port]);
      assert.equal(holders[0].pid, child.pid);
      assert.equal(holders[0].loopback, true);
      assert.equal(holders[0].engineOwned, false);
      await assert.rejects(
        portHolder(port, [port], { confirmPid: child.pid + 100000 }),
        /no longer holds/,
      );
      const result = await portHolder(port, [port], { confirmPid: child.pid });
      assert.equal(result.stopped, child.pid);
      await closed;
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);

test(
  "engine-owned port holders must be stopped from the Processes view",
  { timeout: 20000 },
  async (t) => {
    const port = await freePort();
    const session = startProcess(
      process.execPath,
      [
        "-e",
        `require("node:net").createServer().listen(${port},"127.0.0.1",()=>console.log("up"))`,
      ],
      { workspaceRoot: tmpdir(), emit: () => {} },
    );
    const { id } = registerProcess({
      kind: "preview",
      label: "p",
      command: "node",
      port,
      session,
    });
    try {
      let owners = [];
      for (let i = 0; i < 50 && !owners.length; i++) {
        owners = findPortOwners(port);
        if (!owners.length) await new Promise((r) => setTimeout(r, 100));
      }
      if (!owners.length) {
        t.skip("No port-owner lookup available on this host");
        return;
      }
      await assert.rejects(
        portHolder(port, [port], { confirmPid: session.pid }),
        /Processes view/,
      );
    } finally {
      await stopProcess(id);
    }
  },
);
