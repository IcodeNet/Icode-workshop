import {
  createAdapterRegistry,
  checkAdapter,
  type WorkshopAdapter,
} from "@icodenet/workshop-adapter-api";
import { startProcess } from "@icodenet/workshop-adapter-api/process";
const adapter: WorkshopAdapter = {
  id: "example",
  apiVersion: 1,
  async detect() {
    return [{ level: "info", message: "ready" }];
  },
  async prepare() {},
  async run() {
    return { exitCode: 0 };
  },
  async start(context) {
    return startProcess("node", ["server.mjs"], context);
  },
};
const registry = createAdapterRegistry();
registry.register(adapter);
void checkAdapter(registry.require("example"), {
  workspaceRoot: "/tmp/example",
  signal: AbortSignal.timeout(1000),
});
