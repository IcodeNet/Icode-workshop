# Icode Workshop adapter API v1

Experimental, unpublished package. JavaScript exports include TypeScript declarations. Runtime IDs are explicit and language-independent; API versions other than `1`, invalid IDs, duplicate registrations and invalid methods are rejected.

```js
import {createAdapterRegistry, loadAdapters} from '@icodenet/workshop-adapter-api'
const registry = createAdapterRegistry()
await loadAdapters(registry, ['@community/icode-ruby-adapter'])
```

Install packages yourself and list them in host configuration. The web API accepts a JSON module list in `WORKSHOP_ADAPTERS`, e.g. `["@community/icode-ruby-adapter"]`. Resolution is from the host package. An absolute `file:` URL can select a local adapter. A lab names a registered runtime; it cannot download or select a module. Adapter imports are trusted code with local user permissions, not sandboxed plugins.

## Author contract

Export a default object implementing `WorkshopAdapter` from `index.d.ts`:

- `id`: stable lowercase runtime identifier, e.g. `rust`, `dotnet`, `jupyter`.
- `apiVersion: 1`.
- `detect(context)`: diagnostics with `info`, `warning`, or `error` level.
- `prepare(context)`: initialise explicitly allowed prerequisites; do not silently install packages.
- `run('test' | 'build' | 'run', context)`: finite operation returning `{exitCode, aborted?}`. Reject unsupported commands. Report no-tests discovery as failure, never a fabricated success.
- Optional `start(context)`: returns a `RuntimeSession` promptly, with `id`, `completion`, `stop()` and optional `previewUrl`.
- Optional `stop(context)`: adapter-specific cleanup.

`context` supplies workspaceRoot, cancellation signal, optional environment and bounded-output event sink. Use argv arrays rather than shell interpolation. An adapter must own and stop its child processes, honour cancellation and report missing dependencies with setup guidance. Notebook state and outputs remain the responsibility of a Jupyter adapter.

## Process helper

`@icodenet/workshop-adapter-api/process` exports `execute` for finite operations and `startProcess` for sessions. Output is bounded to 50,000 characters. `stop()` waits for exit; cancellation sends SIGTERM and escalates to SIGKILL after 500 ms. On POSIX it targets the process group. Windows child-tree cleanup remains a platform limitation and needs dedicated validation.

The web host's optional preview manifest uses this helper to own an explicitly configured local command. It polls a loopback URL, rejects an occupied HTTP port, and exposes start/stop controls. This is not isolation or a container manager.

## Author testing

```js
import {checkAdapter} from '@icodenet/workshop-adapter-api'
const report = await checkAdapter(adapter, {
  workspaceRoot: '/absolute/path/to/disposable-fixture',
  signal: AbortSignal.timeout(15000),
  emit: event => process.stdout.write(event.text)
})
```

The conformance helper validates shape, detection and execution result. Also test a failing starter, corrected solution, missing executable, no tests, cancellation and process cleanup. The repository runs those integration cases for the built-in adapters and registry; a new runtime needs its own real toolchain evidence.

Bundled runtimes: Node.js (`node --test`) and Python (`python3 -m pytest -q`). Rust/.NET/Jupyter are extension targets, not implemented adapters. Build/start are optional capabilities: the web test route invokes detect, prepare and run(test); it does not imply support for every optional method.
