# The apps layout

Icode runs two course layouts. The **native** layout keeps each step in `exercises/NN/` with `lab.json`, `README.md`, `problem/` and `solution/`. The **apps layout** keeps each step as a pair of runnable apps inside a module folder:

```text
exercises/
  README.mdx                     course introduction
  FINISHED.mdx                   course wrap-up
  01.basics/
    README.mdx                   exercise introduction
    01.problem.start/            problem app (its own package.json, src/, README.mdx)
    01.solution.start/           solution app
    FINISHED.mdx                 exercise wrap-up
```

Icode runs apps-layout courses unchanged. It never installs, imports or runs any other workshop tooling: it reads the course's files and settings as data. The exact names the layout uses for its settings key, hook folder, hook variables, browser-test import path and video component are defined in one place, [`packages/core/apps-layout.mjs`](../packages/core/apps-layout.mjs).

## Opting in

An explicit `workshop.json` selects the layout and the trusted commands:

```json
{
  "schemaVersion": 1,
  "format": "apps",
  "title": "MCP Fundamentals",
  "testScript": "test",
  "testArgs": ["--run"],
  "seed": "src/db/seed.ts",
  "inspector": true
}
```

Without it, nested folders are not treated as steps, and a course with no supported steps is rejected rather than reported as a valid zero-step course.

## Steps and lessons

Ordered `exercises/NN.name/NN.problem.name` folders and their matching `NN.solution.name` folders map to stable, ordered two-digit step IDs (at most 99). Authored sources keep their names. Inserting or reordering steps changes the IDs, so do that only together with migrating saved progress and playgrounds.

Each step shows the course introduction, the exercise introduction, the problem lesson, the solution explanation and the wrap-ups. Lessons go through the same server-side MDX subset as native lessons (see [content](content.md)): JSX is never executed, video components become external link cards, `<InlineFile>` opens the playground file, and diff links open the comparison. Code fences are kept.

## Settings, hooks and tests

- **Course settings** (title, subtitle, instructor, product, repository, forms, notifications, app type) come from the course's settings key in its root `package.json` when `course.json` does not declare them.
- **Per-app settings** (app type, initial route, test tab, cloud-editor configuration) come from each app's own `package.json`. An app without a `dev` script is a simple app; its `*.test.*` files are its in-browser tests when it has no `test` script.
- **Hooks:** per-app and root pre/post set-playground hook files in the layout's hook folder run as `node <file>`, and the settings' `scripts.postupdate` command line is split into words without a shell. Hook files are read only from authored directories, never from playgrounds or saved copies. Hooks receive `ICODE_PLAYGROUND_*` and the layout's own playground variables, with real `true`/`false` values. See [workspace and diffs](workspace-and-diffs.md).
- **Diff ignore:** the hook folder's `.diffignore` at the root and in each side adds ignore patterns.
- **Browser tests** can import the runtime from `@icodenet/workshop-test` or from the layout's own import path; both resolve to the engine's runtime.

## Setup and run

From the engine checkout:

```sh
node packages/cli/bin.mjs setup --content /path/to/course
node packages/cli/bin.mjs doctor --content /path/to/course
node packages/cli/bin.mjs start --content /path/to/course
```

A course can supply `npm run setup`, `npm run doctor` and `npm start` wrappers that clone a pinned engine commit. Node, npm, Git and Corepack/pnpm are prerequisites; no npm package is published.

Setup installs the course lockfile with `npm ci`, with install lifecycle scripts disabled. A declared seed script runs explicitly in a newly created playground or disposable reference copy; repeated setup keeps existing learner files and databases. Reset stages and seeds the replacement before swapping it in. Restoring a backup keeps its database. Scripts and lessons are trusted local code, not sandboxed execution.

The test adapter runs the declared package script with finite arguments under the cancellation and deadline helper. Courses keep their own test scripts and assertions. Seeds use the installed tsx loader. Dependencies resolve from the course installation. Missing assessment files never count as a pass.

## Inspector and external clients

With `"inspector": true`, Preview launches the official MCP Inspector installed by the course. Icode owns its launcher, UI/proxy processes and selected server, uses a fresh session token, and keeps Inspector token logs out of the workshop console. Lesson IDs reserve preview ports 4401–4499; Inspector proxy and client ports use offsets 1000 and 2000, and these ports must be available. The Inspector connects to the selected disposable solution or problem copy, or to the persistent playground's `dev:mcp` script.

A course can launch the learner's server over stdio (for example `node icode/run.mjs mcp 01`). That server is separate from Icode's own read-only assistant MCP. A starter fails its handshake until the learner implements it; use a completed playground for external-client testing.

## Acceptance

`IcodeNet/mcp-fundamentals` (branch `feat/icode-workshop-host`) is the acceptance course for this layout. Its CI checks source integrity, compares every starter and solution outcome with the course's own baseline, runs all variants through Icode, accounts for every lesson document, demonstrates a failing-to-passing learner edit, keeps authored reference files unchanged, and verifies reset, restore and progress. Browser acceptance opens every lesson, connects a real Inspector to a solution, and verifies port cleanup on restart and shutdown. Platform tests cover discovery and lessons (`packages/web/apps-layout.test.mjs`), settings (`content-config.test.mjs`) and hooks (`hooks.test.mjs`).

Authenticated videos and account features are outside this layout's scope.
