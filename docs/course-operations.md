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
      "destructive": true,
      "cancelGraceSeconds": 120
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

Validation (`workshop validate`, every API call): IDs and sidecar names match `[A-Za-z0-9][A-Za-z0-9_-]{0,39}`; every `script` must be a key of `package.json#scripts` and start with a letter or digit (names only, never a command line or an npm flag); `cancelGraceSeconds` is an integer from 1 to 3600 (default 30); labels ≤ 80 characters, descriptions ≤ 500; `destructive` is a boolean; indicator `level` is `info`, `warning` (default) or `danger`; indicator `path` is relative to the course root, uses `/`, and has no empty, `.` or `..` segment and no drive letter. Symlinks on an indicator path are rejected.

## Actions

The **Actions** output tab lists actions by `group`. Running one executes `npm run <script>` in the course root (npm is located the same way as `workshop setup`, so it works on Windows without a shell) with:

- `ICODE_ACTION=1`, `ICODE_ACTION_ID=<id>` and `ICODE_CONFIRM_TOKEN=<random per-run token>`, plus the course `node_modules/.bin` on `PATH` and `WORKSHOP_CONTENT`;
- stdin piped to the engine; stdout/stderr streamed to the UI with ANSI colours.

### Runs are detached from the browser

Starting an action returns immediately; the run lives in the engine, not in the HTTP request. Reloading or closing the tab, a crashed tab or a sleeping laptop **never** cancels it. The engine keeps a run record (status, the last 200,000 characters of output with an `[earlier output truncated]` marker, and any pending confirmation); when the page loads again the UI re-attaches to the running (or last) run, shows its output and restores a pending confirmation dialog. While a run is in progress the banner shows that the action is running, alongside any cost indicators.

Only one action runs at a time. While it runs, other course-level operations (another action, sidecar restart/stop, freeing a port, stopping other processes) wait; lessons, files, tests and previews stay available. Answering the confirmation and cancelling are always allowed.

### Cancelling

Only an explicit **Cancel action** (confirmed in a dialog) or **Stop** in the Processes tab stops a run. The engine sends SIGINT to the action's process group (a graceful Ctrl+C; `taskkill` without `/F` on Windows), waits `cancelGraceSeconds` (default 30) and only then force-kills it. **Cancelling a deployment part-way can leave cloud resources running and billing**; the UI says so. Write scripts that handle SIGINT by cleaning up or recording what exists, and **write the indicator marker before you start provisioning** (remove it after a successful tear-down) so the cost banner appears even if a run is interrupted. Stopping the workshop itself (Ctrl+C, closed terminal, crash) stops running actions quickly (SIGTERM, then SIGKILL).

### Typed confirmation protocol

To ask the learner to confirm, print one line that carries the run's token from `ICODE_CONFIRM_TOKEN`:

```
::icode-confirm:<ICODE_CONFIRM_TOKEN>::{"expected":"deploy-prod","message":"This creates billable resources in your subscription."}
```

The UI hides that line, opens a dialog that requires typing `expected` exactly (the button stays disabled until it matches), and writes the typed text plus a newline to the script's stdin. **Cancel** writes an empty line. The server accepts only the exact `expected` text or an empty line, and only while a confirmation is pending. The script must still re-check the input itself; it is authoritative.

The token is random per run and only exists in the action's environment, so output the script merely relays (a CLI error message, a downloaded file, a dependency's install log) cannot forge or pre-answer a prompt: lines starting with `::icode-confirm` without the right token are shown as `[ignored confirmation request without this run's token]`. Child processes inherit the environment, so a helper the script runs can prompt too; do not pass the token to anything untrusted. `expected` is 1–200 characters and, like `message` (≤ 1000), may not contain control, formatting (for example bidirectional overrides) or line-separator characters. Protocol lines are detected on the complete output stream; no output limit can drop them.

```js
// scripts/deploy.mjs
import { createInterface } from "node:readline";
import { writeFileSync, rmSync } from "node:fs";
const expected = "deploy-prod";
const token = process.env.ICODE_CONFIRM_TOKEN;
if (token)
  console.log(`::icode-confirm:${token}::` + JSON.stringify({ expected, message: "Creates billable resources." }));
else
  console.log(`Type ${expected} to continue:`); // running outside Icode
const rl = createInterface({ input: process.stdin });
const answer = await new Promise((resolve) => rl.once("line", resolve));
rl.close();
process.stdin.destroy(); // let the process exit while the engine keeps stdin open
if (answer !== expected) {
  console.log("Cancelled.");
  process.exit(1);
}
writeFileSync(".workshop/azure-deployed.json", "{}"); // marker first: the banner shows even if interrupted
process.on("SIGINT", () => {
  console.log("Interrupted: some resources may exist. Run the tear-down action.");
  process.exit(130);
});
// … deploy
```

## Indicators (cost banner)

While the file at `path` exists, every lesson shows a banner with `message`, styled by `level`. The UI checks when an action starts and finishes and every 30 seconds. Have the deploy script create the marker before provisioning and the teardown script delete it.

Indicators fail closed: they are validated separately from actions and sidecars (a broken action does not hide them), and if `course.json`, an indicator entry or an indicator path cannot be checked (invalid, symlinked, unreadable, or the API is unreachable) the banner shows **Cost status unknown** with the reason instead of nothing.

## Sidecars

Sidecars are long-lived course scripts (a mock API, a local vector store) started when the workshop API starts (`workshop start`, or `node packages/web/server.mjs`). Set `ICODE_SIDECARS=0` to disable them. Each runs `npm run <script>` in the course root with `ICODE_SIDECAR=<name>`. Their output is never capped in total: the last 500 lines are retained (rolling), each prefixed `[name] ` (a single line longer than 10,000 characters is cut), and viewable (with colours) from the **Processes** tab, where sidecars can also be restarted and stopped. On shutdown (SIGINT, SIGTERM, SIGHUP when the terminal closes, SIGBREAK on Windows) the engine stops every process it owns — previews, tests, actions and sidecars — as whole process trees (process groups on Linux/macOS, `taskkill /T` on Windows), and an exit handler force-kills anything left, including after a crash. CI checks this on all three systems.

## Processes and ports

The **Processes** tab lists every process the engine owns — previews, test runs, actions and sidecars — with kind, command, PID, port and start time, and can stop any of them.

When a preview cannot start because its configured port is held by another process, the Preview tab offers **Free port**. It identifies the listener (`lsof`, `/proc` on Linux or `netstat` on Windows; never a shell), shows its PID, command and listening addresses, and terminates it only after confirmation. Lookups run only for configured preview ports and are rate-limited. It refuses:

- ports that are not a configured preview port;
- the workshop itself and the programs that started it (its ancestors);
- anything in a workshop-owned process tree: a registered process, any descendant of one (for example the `node` behind `npm run`), anything in a registered process group, or anything the engine started — stop those from the Processes tab;
- listeners bound to a specific non-loopback address;
- shared system and container services that multiplex many ports (Docker Desktop's `com.docker.*`, `docker-proxy`, `vpnkit`, `containerd`, `svchost`, `launchd`, `systemd`, `ssh`, VS Code/Cursor port forwarding, PID ≤ 4 on Windows);
- processes owned by another user.

A listener on a wildcard address (`0.0.0.0`, `::`) holds the loopback port too, but because it is reachable from the network the learner must also type the process name. Only that process is stopped, never its children (no `taskkill /T` for foreign processes): SIGTERM (or `taskkill` without `/F`), then — after 1.5 s and only if the same process, identified by PID **and start time**, still exists — SIGKILL (`taskkill /F`). A reused PID is never killed.

## Live reload

While a lesson is open, the UI subscribes to `/api/events?id=<step>` (server-sent events; at most 16 at once) and the engine watches that step's playground. The endpoint is read-only: it never creates or seeds a playground (opening a lesson does that, under the mutation lock) (`fs.watch`, recursive; dotfiles and generated directories ignored). When the open file changes on disk (another editor, an AI assistant, a script), a clean editor reloads it; an editor with unsaved edits shows a “changed on disk” notice with **Load disk version** / **Keep my edits**. The file list refreshes, and a running playground preview frame reloads (toggle in the Preview tab). The preview process itself is not restarted; servers that cache modules still need **Restart app**.

## Opening files in an editor

**Open in editor** launches a detected editor at line/column with an argument array (no shell):

| Editor | Detected as | Arguments |
|---|---|---|
| VS Code / Cursor | `code`, `code-insiders`, `cursor` | `--goto file:line:column` |
| WebStorm / IntelliJ IDEA | `webstorm`, `idea` | `--line N --column N file` |
| Sublime Text | `subl` | `file:line:column` |
| vim / nvim / nano / emacs | `$VISUAL`, `$EDITOR` | `+…` cursor argument; only when the engine runs in a terminal |

Order of preference: `ICODE_EDITOR` (an executable, or a JSON array such as `["/opt/editor/bin/ed","--reuse-window"]`), `$VISUAL`, `$EDITOR`, then the GUI editors on `PATH`. On Windows only `PATHEXT` files are considered (the extensionless `bin\code` next to `code.cmd` is a Git Bash script), and batch-file launchers (`code.cmd`, `cursor.cmd`) are mapped to the editor executable (`Code.exe`, `Cursor.exe`); other batch launchers are reported as unavailable. Line and column are clamped to 1…10,000,000. Only one terminal editor can be open at a time, since it shares the workshop's terminal. **Open in VS Code** (`vscode://` link) remains as a fallback.

## Install check

`workshop doctor`, `workshop setup` and a banner in the UI report whether the course root dependencies are installed and match `package-lock.json` (every locked package's installed version, ignoring optional packages for other platforms and workspace links). The report includes the exact command, for example `cd "/path/to/course" && npm ci`, or `npm install` when `package-lock.json` no longer matches `package.json`.

## API

All endpoints keep the loopback Host/Origin checks and also refuse requests whose `Sec-Fetch-Site` is not `same-origin` or `none`, so another website cannot trigger even side-effecting GETs (for example through `<img src>`). `GET /api/operations`, `POST /api/actions/run` (starts a detached run; returns its snapshot), `GET /api/actions/run?runId=` (snapshot of the running or last run), `GET /api/actions/stream?runId=` (NDJSON: `snapshot`, `stdout`/`stderr`, `confirm`, `answered`, `status`, `result`; disconnecting never cancels), `POST /api/actions/input`, `POST /api/actions/cancel`, `GET /api/indicators`, `GET /api/processes`, `POST /api/processes/stop`, `GET /api/ports/holder?port=`, `POST /api/ports/free` (`{port, pid, confirm: true, confirmName?}`), `GET /api/sidecars`, `GET /api/sidecars/logs?name=`, `POST /api/sidecars/restart|stop`, `GET /api/events?id=` (SSE), `GET /api/editors`, `POST /api/editor/launch`, `GET /api/doctor`.
