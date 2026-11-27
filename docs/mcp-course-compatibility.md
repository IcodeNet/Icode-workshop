# MCP Fundamentals host compatibility

Icode can opt into a nested Epic-style course layout without importing the Epic workshop engine. This capability is being accepted against the pinned `IcodeNet/mcp-fundamentals` course in its `feat/icode-workshop-host` branch. See that branch's CI for completed acceptance, rather than interpreting platform unit tests as course acceptance.

## Course contract

An explicit `workshop.json` selects the format and trusted commands:

```json
{
  "schemaVersion": 1,
  "format": "epic",
  "title": "MCP Fundamentals",
  "testScript": "test",
  "testArgs": ["--run"],
  "seed": "src/db/seed.ts",
  "inspector": true
}
```

The compatibility layout maps ordered `exercises/NN.name/NN.problem.name` and corresponding solution directories to stable ordered two-digit UI IDs for this pinned course. It does not rename authored sources. Do not insert/reorder steps in an existing course without migrating progress and saved work; a general course-version migration facility is not claimed. Empty/unsupported courses are rejected rather than reported as valid zero-step courses.

The host reads all course/exercise introductions, problem/solution lessons and wrap-ups. It adapts a declarative MDX subset without executing arbitrary JSX: original video links remain external, file links open the playground file, and diff links open comparison. Code fences are retained. This is not a general MDX runtime or paid-video entitlement integration.

## Setup and run

From the engine checkout:

```sh
node packages/cli/bin.mjs setup --content /path/to/mcp-fundamentals
node packages/cli/bin.mjs doctor --content /path/to/mcp-fundamentals
node packages/cli/bin.mjs start --content /path/to/mcp-fundamentals
```

The course branch supplies `npm run setup`, `npm run doctor`, and `npm start` wrappers. Setup clones a pinned engine source commit if required. Node, npm, Git and Corepack/pnpm are prerequisites; no public npm release is implied.

Setup installs the course lockfile with npm ci, with install lifecycle scripts disabled. A declared seed script is run explicitly in a newly created playground or disposable reference copy; repeated setup preserves existing learner files and databases. Reset stages and seeds the replacement before swapping it in. Restoring a backup preserves its database. Scripts and lessons are trusted local code, not sandboxed execution.

The test adapter runs the declared package script with finite arguments under the existing cancellation/deadline helper. MCP Fundamentals retains its original Vitest test scripts and assertions. Seeds use the installed tsx loader; course test subprocesses use the original tsx command. Dependencies resolve from the course installation. Missing assessment files cannot count as a pass.

## Inspector and external clients

Preview launches the official MCP Inspector installed by the course. Icode owns its launcher, UI/proxy processes and selected server, uses a fresh session token, and avoids copying Inspector token logs into the workshop console. Lesson IDs reserve preview ports 4401–4499; Inspector proxy/client ports use offsets 1000/2000. These ports must be available. The client is directed to the selected disposable solution/problem or persistent playground's `dev:mcp` script.

The course's `node icode/run.mjs mcp 01` command launches the learner server over stdio. This is different from Icode's own read-only assistant MCP. A failing starter is expected to fail its handshake until the learner implements it. Use a completed persistent playground for external-client testing.

## Acceptance contract

The course CI checks original source integrity, records the original 26 assessment outcomes, runs all 26 variants through Icode, accounts for 38 lesson documents, demonstrates a failing-to-passing learner edit, preserves authored reference files, and verifies reset/restore/progress. Browser acceptance navigates all 13 lessons and connects a real Inspector to a solution, then verifies restart/shutdown port cleanup.

Authenticated videos, commercial account features, all 44 audit gaps, and every Epic application type are outside this particular course-host gate. They must not be inferred from a successful MCP Fundamentals run.
