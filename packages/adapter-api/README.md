# Icode Workshop adapter API (experimental)

This package defines the first version of the explicit runtime adapter registry. It is not published yet. Adapters are executable, trusted local code; a lab manifest must never automatically install a package.

```js
import { createAdapterRegistry } from '@icodenet/workshop-adapter-api'
const registry = createAdapterRegistry()
registry.register({
  id: 'custom', apiVersion: 1,
  async detect(context) { return [] },
  async prepare(context) {},
  async run(command, context) { return { exitCode: 0 } }
})
```

Contract: `detect(context)` returns diagnostics, `prepare(context)` initialises the workspace, and `run(command,context)` returns a result containing an exit code. Optional `stop(context)` cleans up managed sessions. A future release will define a formal long-running session contract and runtime isolation; do not expose third-party adapters to untrusted projects.

Run contract tests with `node --test packages/adapter-api/index.test.mjs`.
