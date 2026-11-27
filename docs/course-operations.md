# Running and operating a course

Stage 1 of the Epic gap analysis (C1, C3, C4, C6, C7, C10, B5, B7). Everything here is declared by the course author in `course.json` and runs **trusted** course scripts with the learner's permissions. Learners never type a command: the engine only runs scripts that already exist in the course root `package.json`.

## Manifest

```json
{
  "schemaVersion": 1,
  "title": "Senior AI Engineering",
  "modules": [{ "id": "labs", "title": "Labs", "steps": ["01", "02"] }],
  "actions": [
    {
      "id": "deploy",
      "label": "Deploy to Azure",
      "script": "azure:deploy",
      "group": "Cloud",
      "description": "Creates an Azure AI Search instance (billable).",
      "destructive": true
    },
    { "id": "teardown", "label": "Tear down Azure resources", "script": "azure:teardown", "group": "Cloud" }
  ],
  "indicators": [
    {
      "path": ".workshop/azure-deployed.json",
      "message": "Azure resources are running and cost money. Run “Tear down Azure resources” when you finish.",
      "level": "danger"
    }
  ],
  "sidecars": {
    "mock-api": { "script": "mock-api" }
  }
}
```

with, in the course root `package.json`:

```json
{
  "scripts": {
    "azure:deploy": "node scripts/deploy.mjs",
    "azure:teardown": "node scripts/teardown.mjs",
    "mock-api": "node scripts/mock-api.mjs"
  }
}
```

A course that only needs operations (for example an Epic-layout course) can omit `modules`; step order then falls back to discovery.

Validation (`workshop validate`, every API call): IDs and sidecar names match `[A-Za-z0-9][A-Za-z0-9_-]{0,39}`; every `script` must be a key of `package.json#scripts` (names only, never a command line); labels ≤ 80 characters, descriptions ≤ 500; `destructive` is a boolean; indicator `level` is `info`, `warning` (default) or `danger`; indicator `path` is relative to the course root, uses `/`, and has no empty, `.` or `..` segment and no drive letter. Symlinks on an indicator path are rejected.

## Actions

The **Actions** output tab lists actions by `group`. Running one executes `npm run <script>` in the course root (npm is located the same way as `workshop setup`, so it works on Windows without a shell) with:

- `ICODE_ACTION=1` and `ICODE_ACTION_ID=<id>`, plus the course `node_modules/.bin` on `PATH` and `WORKSHOP_CONTENT`;
- stdin piped to the engine; stdout/stderr streamed to the UI with ANSI colours.

Only one action runs at a time. It holds the API mutation lock (saving, tests and other actions wait), except for answering its confirmation, cancelling it and stopping processes. Closing the browser tab cancels the action. There is no timeout: long deployments are allowed; use **Cancel action** or the Processes tab.

### Typed confirmation protocol

To ask the learner to confirm, print one line:

```
::icode-confirm::{"expected":"deploy-prod","message":"This creates billable resources in your subscription."}
```

The UI hides that line, opens a dialog that requires typing `expected` exactly (the button stays disabled until it matches), and writes the typed text plus a newline to the script's stdin. **Cancel** writes an empty line. The script must re-check the input itself; the UI check is a convenience, the script is authoritative. `expected` is 1–200 characters without newlines. Input is accepted only while a confirmation is pending.

```js
// scripts/deploy.mjs
import { createInterface } from "node:readline";
const expected = "deploy-prod";
console.log("::icode-confirm::" + JSON.stringify({ expected, message: "Creates billable resources." }));
const rl = createInterface({ input: process.stdin });
const answer = await new Promise((resolve) => rl.once("line", resolve));
rl.close();
process.stdin.destroy(); // let the process exit while the engine keeps stdin open
if (answer !== expected) {
  console.log("Cancelled.");
  process.exit(1);
}
// … deploy, then write .workshop/azure-deployed.json for the indicator
```

Outside Icode (`npm run azure:deploy` in a terminal) the same script still works: the learner sees the protocol line and types the answer.

## Indicators (cost banner)

While the file at `path` exists, every lesson shows a banner with `message`, styled by `level`. The UI checks after every action and every 30 seconds. Have the deploy script create the marker and the teardown script delete it.

## Sidecars

Sidecars are long-lived course scripts (a mock API, a local vector store) started when the workshop API starts (`workshop start`, or `node packages/web/server.mjs`). Set `ICODE_SIDECARS=0` to disable them. Each runs `npm run <script>` in the course root with `ICODE_SIDECAR=<name>`. The last 500 output lines are retained, each prefixed `[name] `, and viewable (with colours) from the **Processes** tab, where sidecars can also be restarted and stopped. On shutdown the engine stops every sidecar's process tree (process groups on Linux/macOS, `taskkill /T` on Windows); CI checks this on all three systems.

## Processes and ports

The **Processes** tab lists every process the engine owns — previews, test runs, actions and sidecars — with kind, command, PID, port and start time, and can stop any of them.

When a preview cannot start because its configured port is held by another process, the Preview tab offers **Free port**. It identifies the listener (`lsof`, `/proc` on Linux or `netstat` on Windows; never a shell), shows its PID, command and listening addresses, and terminates it only after confirmation. It refuses: ports that are not a configured preview port, the workshop itself, workshop-owned processes (use the Processes tab), and listeners bound to a specific non-loopback address. Listeners on a wildcard address (`0.0.0.0`, `::`) are accepted because they hold the loopback port too.

## Live reload

While a lesson is open, the UI subscribes to `/api/events?id=<step>` (server-sent events) and the engine watches that step's playground (`fs.watch`, recursive; dotfiles and generated directories ignored). When the open file changes on disk (another editor, an AI assistant, a script), a clean editor reloads it; an editor with unsaved edits shows a “changed on disk” notice with **Load disk version** / **Keep my edits**. The file list refreshes, and a running playground preview frame reloads (toggle in the Preview tab). The preview process itself is not restarted; servers that cache modules still need **Restart app**.

## Opening files in an editor

**Open in editor** launches a detected editor at line/column with an argument array (no shell):

| Editor | Detected as | Arguments |
|---|---|---|
| VS Code / Cursor | `code`, `code-insiders`, `cursor` | `--goto file:line:column` |
| WebStorm / IntelliJ IDEA | `webstorm`, `idea` | `--line N --column N file` |
| Sublime Text | `subl` | `file:line:column` |
| vim / nvim / nano / emacs | `$VISUAL`, `$EDITOR` | `+…` cursor argument; only when the engine runs in a terminal |

Order of preference: `ICODE_EDITOR` (an executable, or a JSON array such as `["/opt/editor/bin/ed","--reuse-window"]`), `$VISUAL`, `$EDITOR`, then the GUI editors on `PATH`. On Windows, batch-file launchers (`code.cmd`) are mapped to the editor executable when possible (`Code.exe`); otherwise the editor is reported as unavailable. **Open in VS Code** (`vscode://` link) remains as a fallback.

## Install check

`workshop doctor`, `workshop setup` and a banner in the UI report whether the course root dependencies are installed and match `package-lock.json` (every locked package's installed version, ignoring optional packages for other platforms and workspace links). The report includes the exact command, for example `cd "/path/to/course" && npm ci`, or `npm install` when `package-lock.json` no longer matches `package.json`.

## API

All endpoints keep the loopback Host/Origin checks. `GET /api/operations`, `POST /api/actions/run` (NDJSON: `started`, `stdout`/`stderr`, `confirm`, `result`), `POST /api/actions/input`, `POST /api/actions/cancel`, `GET /api/indicators`, `GET /api/processes`, `POST /api/processes/stop`, `GET /api/ports/holder?port=`, `POST /api/ports/free` (`{port, pid, confirm: true}`), `GET /api/sidecars`, `GET /api/sidecars/logs?name=`, `POST /api/sidecars/restart|stop`, `GET /api/events?id=` (SSE), `GET /api/editors`, `POST /api/editor/launch`, `GET /api/doctor`.
