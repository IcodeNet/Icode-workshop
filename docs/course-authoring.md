# Authoring a course

Icode Workshop runs trusted local course content. Keep the engine repository separate from your lab repository. Point `WORKSHOP_CONTENT` (web/API) or `--content` (CLI) at the course root.

## Course manifest

An optional `course.json` controls the title and module → exercise → step order:

```json
{
  "schemaVersion": 1,
  "title": "Senior AI Engineering",
  "modules": [{
    "id": "retrieval",
    "title": "Trusted retrieval",
    "exercises": [{
      "id": "approval",
      "title": "Approval filtering",
      "steps": ["01", "02"]
    }]
  }]
}
```

Each step resolves to `exercises/01/`, `exercises/02/`, etc. IDs remain globally unique two-digit IDs (00–99). Every discovered step must occur exactly once. A simple module can use `steps` directly instead of `exercises`. Missing course manifests fall back to a flat sorted list.

Each step contains `lab.json`, `README.md`, and complete `problem/` and `solution/` projects. The entry file must exist in both variants. Example:

```json
{
  "schemaVersion": 1,
  "title": "Approved documents only",
  "description": "Filter records using their authoritative approval state.",
  "runtime": "node",
  "entry": "index.mjs",
  "media": {
    "src": "https://your-media-host.example/lesson.mp4",
    "captions": "https://your-media-host.example/lesson.en.vtt",
    "transcript": "## Transcript\nAuthor-supplied Markdown transcript."
  }
}
```

Media is optional. The video element uses native playback controls; captions need an appropriate WebVTT asset and host CORS policy. Transcripts are supplied by the author, not generated automatically. No demonstration video is bundled.

Use `runtime: "python"` with `entry: "main.py"` for pytest. Tests are part of the learning project and can be edited; this is practice feedback, not tamper-resistant grading. Third-party runtimes must be installed and explicitly loaded by the host; naming a runtime in a manifest does not install it.

## Validate and run

From the engine checkout:

```sh
node packages/cli/bin.mjs validate --content /absolute/path/to/course
node packages/cli/bin.mjs start --content /absolute/path/to/course
node packages/cli/bin.mjs set 01 --content /absolute/path/to/course
node packages/cli/bin.mjs test 01 --content /absolute/path/to/course
node packages/cli/bin.mjs diff 01 --content /absolute/path/to/course
node packages/cli/bin.mjs progress --content /absolute/path/to/course
```

`validate` also checks actions, indicators and sidecars against `package.json` scripts. `doctor` reports whether course dependencies are installed and match `package-lock.json`, with the command to fix them. `start` starts the development API (and the course sidecars) and Vite UI. The UI stays on port 5173 and fails clearly if occupied. `WORKSHOP_API_PORT` is honoured by both the API and Vite proxy. CLI tests and the UI use the same per-step workspace. The CLI `reset <id>` creates a backup before replacing work.

## Persistence and reference execution

Playgrounds live at `.workshop/playgrounds/<id>/`; progress lives at `.workshop/progress.json` beneath the course root. Progress is self-reported, shared by browsers accessing that course, and exportable from the sidebar or CLI.

Problem and Solution views have independent file lists. Test and preview execution uses disposable `.workshop/runs/` copies, protecting authored source trees. Execution output streams to the Tests panel; cancellation closes the request and aborts its process group. Timeouts still apply. Use only one engine process per course: API mutations are serialised within one process, not across multiple engine/CLI processes.

Replacing a playground from a reference or the previous step stages the source first and backs up existing files. Restore Backup selects an earlier saved directory; the current state is backed up before restoration. Unsaved editor text is not included in filesystem backups. Backup retention is manual. Copy Previous replaces the whole project. Migrate Previous Edits instead performs a conservative three-way comparison of the source starter, saved source edits and target starter. Independent file changes carry forward; conflicting files stop migration without overwriting the target. It does not merge conflicting hunks automatically. Matching runtimes are required.

The Diff tab compares saved files of any two lesson versions (problem, solution, playground or a saved playground of any lesson), side by side or unified, and detects renames of identical files. Lessons can link to a diff with `[see the diff](#diff=step)`, `#diff=next`, `#diff=prev` or `#diff=01.solution..02.problem`; course `diff.ignore` patterns hide files. See [workspace and diffs](course-operations.md#workspace-and-diffs) for hooks, saved playgrounds, touched files and updates. File editing still excludes hidden/generated content and binary/large files.

## Actions, indicators and sidecars

`course.json` can also declare learner-runnable **actions** (course `package.json` scripts with optional typed confirmation), **indicators** (a persistent banner, such as a running-cost warning, while a file exists) and **sidecars** (long-lived scripts started with the workshop). Only scripts already present in the course root `package.json` can run; learners never enter commands.

```json
{
  "schemaVersion": 1,
  "title": "Senior AI Engineering",
  "modules": [{ "id": "labs", "title": "Labs", "steps": ["01"] }],
  "actions": [
    { "id": "deploy", "label": "Deploy to Azure", "script": "azure:deploy", "group": "Cloud", "destructive": true },
    { "id": "teardown", "label": "Tear down", "script": "azure:teardown", "group": "Cloud" }
  ],
  "indicators": [
    { "path": ".workshop/azure-deployed.json", "message": "Azure resources are running and cost money.", "level": "danger" }
  ],
  "sidecars": { "mock-api": { "script": "mock-api" } }
}
```

A script asks for confirmation by printing `::icode-confirm:<ICODE_CONFIRM_TOKEN>::{"expected":"deploy-prod","message":"…"}`, using the per-run token from its environment; the UI requires the learner to type `expected` and sends it to the script's stdin (Cancel sends an empty line), and the script re-checks it. Runs are detached from the browser: reloading or closing the tab never cancels them, the UI re-attaches, and only an explicit Cancel stops a run (SIGINT first, SIGKILL after `cancelGraceSeconds`, default 30). See [running and operating a course](course-operations.md) for the full protocol, validation rules, the Processes view, port freeing, live reload, editor launch and the install check.

## Embedded services

See `local-tools-and-ai-courses.md` for `tools` configuration. An embed/external link is not a managed Langfuse or Cosmos deployment, authentication integration or verified live connection. Those services must be supplied and independently tested.

## Lessons, apps and pages

Lessons can use GFM, callout elements (`<callout-warning>`) and GFM alerts (`> [!TIP]`), `<InlineFile>`, `<LinkToApp>`, the diff links, highlighted code (a `js filename=app.js {2}` fence) and Mermaid. A step can declare a workshop-served app with `lab.json#app` (`{"type": "simple" | "export", "browserTests": [...]}`). The course can add `subtitle`, `instructor`, `repository`, `forms`, `notifications`, `support`, `community` and `pages` to `course.json`. Every field is optional. See [Stage 3: content](content.md) for the schema and the security model (sanitiser, URL policy, sandbox origin).

Check questions are fenced `question` blocks with YAML (`prompt`, optional `options`, `answer`, `explanation`, optional `source` and `id`). `workshop validate` reports invalid blocks with file and line. See [Check questions](check-questions.md).
