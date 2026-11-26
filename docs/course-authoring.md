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

`start` starts the development API and Vite UI. The UI stays on port 5173 and fails clearly if occupied. `WORKSHOP_API_PORT` is honoured by both the API and Vite proxy. CLI tests and the UI use the same per-step workspace. The CLI `reset <id>` creates a backup before replacing work.

## Persistence and reference execution

Playgrounds live at `.workshop/playgrounds/<id>/`; progress lives at `.workshop/progress.json` beneath the course root. Progress is self-reported, shared by browsers accessing that course, and exportable from the sidebar or CLI. Legacy browser-local completion is not migrated automatically because it was not course-scoped.

Problem and Solution views have independent file lists. Test and preview execution uses disposable `.workshop/runs/` copies, protecting authored source trees. Execution output streams to the Tests panel; cancellation closes the request and aborts its process group. Timeouts still apply. Use only one engine process per course: API mutations are serialised within one process, not across multiple engine/CLI processes.

Replacing a playground from a reference or the previous step stages the source first and backs up existing files. Restore Backup selects an earlier saved directory; the current state is backed up before restoration. Unsaved editor text is not included in filesystem backups. Backup retention is manual. Cross-step copying replaces the project, not a three-way merge; the author must keep adjacent projects compatible.

The Compare panel supports source/target variants and a target lesson. It compares saved files, with an explicit refresh after selection changes. Renames appear as removal/addition. File editing still excludes hidden/generated content and binary/large files.

## Embedded services

See `local-tools-and-ai-courses.md` for `tools` configuration. An embed/external link is not a managed Langfuse or Cosmos deployment, authentication integration or verified live connection. Those services must be supplied and independently tested.
