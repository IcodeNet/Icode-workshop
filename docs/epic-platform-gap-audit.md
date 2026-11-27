# Epic Workshop and MCP course compatibility audit

Date: 27 November 2026. Status: source-level audit with one targeted compatibility probe. **Icode is not at full Epic feature parity and cannot currently run the supplied MCP Fundamentals course unchanged.** Earlier “platform complete” language covered a selected implementation checklist and was too broad. The passing implementation tests remain valid; they do not establish reference-platform completeness.

## Scope and reproducibility

| Reference | Pinned commit | What was inspected |
|---|---|---|
| IcodeNet/Icode-workshop | `26e11477c7d2568948e09f27abd1364afc646487` | Merged main; CLI, manifests, API/UI, files/workspaces, adapters, previews, integrations, tutor, MCP, tests and CI |
| epicweb-dev/epicshop | `12089440399689c914f3e0f69b3ec52c07b9a3a8` | Documentation inventory, CLI dispatch/setup, workshop structure, authoring, diff/testing/media, configuration/sidecars, local MCP registrations |
| IcodeNet/mcp-fundamentals | `9a5336cc825ae7f502bad57dcd3c89eb362bfe9b` | User-supplied course: root/workspace manifests, all step directory names, MDX inventory, setup/reset scripts, Inspector launcher and representative real protocol tests |
| epicweb-dev/epic-agent | `09edf35ac9041b56f9b9d1023855c0372dbba7a6` | Separate hosted retrieval service; MCP retrieval architecture and tool inventory |

The supplied URL identifies a course repository, not a named branch of the Epic platform. Its default checkout is the concrete compatibility reference. Epic main and this course use different dependency snapshots; the course declares Epic packages `^6.90.34`. This audit does not assume those packages equal today's Epic main.

“Complete scan” here means coverage across the documented capability areas and their relevant source surfaces, not a line-by-line security review or execution of every upstream feature. Upstream dependencies, setup hooks, servers, authenticated video and cloud services were not run. No new full Icode test run was needed for a documentation audit. Prior CI evidence: [32 tests, zero skips, 12 browser journeys, typecheck/build and three-OS process checks](https://github.com/IcodeNet/Icode-workshop/actions/runs/45964613802).

### Evidence keys

All upstream links are pinned to the inspected commit. Icode paths below refer to the pinned main above.

- **E-CLI:** [CLI documentation](https://github.com/epicweb-dev/epicshop/blob/12089440399689c914f3e0f69b3ec52c07b9a3a8/docs/cli.md), `packages/workshop-cli/src/cli.ts`, `commands/setup.ts`, `commands/workshops.ts`.
- **E-COURSE:** [structure](https://github.com/epicweb-dev/epicshop/blob/12089440399689c914f3e0f69b3ec52c07b9a3a8/docs/workshop-structure.md), `docs/configuration.md`, `docs/mdx.md`, `docs/other.md`.
- **E-UX:** [diff](https://github.com/epicweb-dev/epicshop/blob/12089440399689c914f3e0f69b3ec52c07b9a3a8/docs/diff.md), `docs/testing.md`, `docs/video-player.md`, `docs/onboarding-indicators.md`, `docs/styling-and-theming.md`.
- **E-MCP:** [local MCP tools](https://github.com/epicweb-dev/epicshop/blob/12089440399689c914f3e0f69b3ec52c07b9a3a8/packages/workshop-mcp/src/tools.ts), adjacent `resources.ts`, `prompts.ts`, `index.ts`, `server-metadata.ts`.
- **F:** [supplied course](https://github.com/IcodeNet/mcp-fundamentals/tree/9a5336cc825ae7f502bad57dcd3c89eb362bfe9b), especially `package.json`, `epicshop/setup-custom.js`, `epicshop/post-set-playground.js`, `epicshop/run.js`, `epicshop/mcp-dev/dev.js` and `exercises/05.prompts/02.solution.optimized-prompt/package.json`.
- **A:** [Epic Agent retrieval design](https://github.com/epicweb-dev/epic-agent/blob/09edf35ac9041b56f9b9d1023855c0372dbba7a6/docs/architecture/mcp-retrieval-tools.md).
- **I-CLI:** `packages/cli/bin.mjs`, `packages/cli/package.json`, root `package.json`.
- **I-COURSE:** `packages/core/index.mjs`, `packages/web/course.mjs`, `workspaces.mjs`, `files.mjs`, `variants.mjs`, `migration.mjs`.
- **I-RUN:** `packages/web/runtime.mjs`, `previews.mjs`, `packages/adapter-api/node-adapter.mjs`, `extra-adapters.mjs`, `node.mjs`.
- **I-UI:** `packages/web/src/main.jsx`, `styles.css`, `server.mjs`, `vite.config.mjs`.
- **I-MCP:** `packages/mcp/server.mjs`, `server.test.mjs`; `packages/web/tutor.mjs`.

## Confirmed course incompatibility

The supplied course contains **5 exercises, 13 problem steps, 13 corresponding solutions, 38 MDX files and 18 database seed files**. Every step package uses a `vitest` test script. This is an MCP teaching course in which the learner builds a server; that is distinct from the platform's assistant-facing MCP.

Only this read-only probe was executed against it:

```sh
node packages/cli/bin.mjs validate --content /tmp/mcp-fundamentals-audit
```

Observed exit: **0**. Observed output: **`Valid course: AI Engineering Labs (0 steps)`**.

Root cause: `listExercises` accepts only immediate `exercises/NN` directories. The supplied course has `exercises/01.ping/01.problem.connect` and similar nested paths. The fallback manifest accepts the empty list, and `validate` never rejects zero discovered steps. This is a confirmed false-success defect, not merely an absent convenience command.

| Blocker | Concrete mismatch | Required acceptance |
|---|---|---|
| Discovery/validation | Nested Epic paths versus flat two-digit Icode IDs; empty import reports success | Reject unsupported/empty courses with actionable errors; an importer or native compatibility layer must enumerate all 13 pairs |
| Lessons | Separate problem/solution MDX, module introductions and FINISHED pages versus one step README.md | Preserve all 38 instructional documents or explicitly report each conversion/omission; support file/diff links and video fallback |
| Dependencies | Root workspaces include exercises and local `@epic-web/mcp-dev`; Icode Node prepare does not install them | Install reproducibly; ensure dependencies and executable PATH resolve from persistent and disposable workspaces |
| Test command | Course uses Vitest/TypeScript; Icode invokes `node --test` | Execute an explicit finite script (e.g. Vitest run), preserve timeout/cancellation, reject no-test success, report assessment results |
| Setup/reset | Setup warms caches, seeds databases and sets the first problem; post-set hook seeds the destination | Explicit trusted lifecycle hooks; idempotent setup; learner-safe reset and seed failures surfaced |
| MCP inspection | Course dev script starts `mcp-dev`: Inspector, auth token, ports, HTTP/WebSocket proxy and selected stdio server | Start real Inspector and selected learner server; connect/ping, discover/call tools and read resources/prompts; clean up owned children |
| External client launch | `epicshop/run.js` locates a selected app and invokes `dev:mcp` with inherited stdio | Stable learner-server launch command and client configuration; protocol stdout stays clean; actual client handshake |
| Hosted lesson media | MDX references EpicAI videos, not raw public video URLs | Retain authorised external links/fallback; do not claim local playback or entitlement compatibility |

Generic Tools links and a generic preview argv offer building blocks for an adapted Inspector workflow. They do not supply or verify the complete lifecycle above. The shared process helper ignores stdin; it is not by itself a transparent stdio MCP relay.

## Platform gap matrix

Status: **Covered** = implemented for Icode's native format, not necessarily identical UX; **Partial** = useful subset; **Missing** = no equivalent found in the inspected implementation; **Optional** = a deliberate product decision, not automatically a prerequisite. Priorities are recommendations: **P0** before realistic course acceptance; **P1** before a polished senior course launch; **P2** later/product choice.

| ID | Capability | Icode status and gap | Priority | Evidence |
|---|---|---|---|---|
| G01 | Course discovery and validation | Partial; confirmed zero-step false success and incompatible nested format | P0 | E-COURSE, F; I-CLI/I-COURSE |
| G02 | Setup command and custom setup | Missing; manual engine install, no course setup orchestration or custom setup contract | P0 | E-CLI setup source, F; I-CLI |
| G03 | Runtime/version/configuration preflight | Partial; runtime detection at execution, no consolidated course preflight | P0 | F engines/README; I-RUN |
| G04 | Workspace dependency preparation | Missing for real Node workspace courses; Node prepare is effectively a no-op | P0 | F workspaces; I-RUN |
| G05 | Package-script and TS assessment | Partial; Node native runner does not honour Vitest/package test scripts | P0 | E-UX testing, F; I-RUN |
| G06 | Setup/set/reset/update hooks | Missing; no author hook contract for seeding or migrations | P0 | E-COURSE other, F; I-COURSE |
| G07 | Managed MCP Inspector workflow | Missing as an integrated workflow; links/previews are only primitives | P0 | F mcp-dev; I-RUN/I-UI |
| G08 | `init` first-run tutorial | Missing; examples exist but no guided install/tutorial flow | P1 | E-CLI; I-CLI |
| G09 | `add` course clone and ref selection | Missing; manual checkout and content path | P1 | E-CLI; I-CLI |
| G10 | Multi-course registry/list/config/remove | Missing; Icode `list` lists steps, not installed courses | P1 | E-CLI; I-CLI |
| G11 | Course/app updates and migrations | Missing; three-way lesson migration is not software/course update management | P1 | E-CLI; I-CLI/I-COURSE |
| G12 | Production CLI distribution | Partial; private monorepo dev launcher, no standalone published install | P1 | E-CLI; I-CLI |
| G13 | Dynamic port selection and launcher controls | Partial; fixed strict UI 5173 and configurable API; no update/restart hotkeys or port discovery | P1 | E-CLI; I-UI/I-RUN |
| G14 | Editor selection and launch | Partial; VS Code file URI, no configurable editor command/discovery | P1 | E-CLI open/config; I-UI |
| G15 | CLI feature parity with UI | Partial; no backup restore, mark progress, arbitrary variant diff or full context export command | P1 | E-CLI; I-CLI |
| G16 | CLI help/JSON/programmatic API | Partial; usage error and mixed text/JSON, no consistent command schemas or exported typed CLI API | P1 | E-CLI; I-CLI |
| G17 | Module/exercise/step navigation | Covered natively; still globally limited to 00–99 step IDs | P1 scale | E-COURSE; I-COURSE |
| G18 | Intro/outro/extra/example content types | Missing first-class course/module finished pages and extras | P1 | E-COURSE; I-COURSE/I-UI |
| G19 | MDX, callouts, diagram and lesson components | Partial; Markdown only, no executable MDX or InlineFile/DiffLink equivalent | P1 | E-COURSE MDX; I-UI |
| G20 | Course metadata/branding/configuration | Partial; title/module metadata and fixed branding; limited instructor, notification and per-course asset support | P2 | E-COURSE config; I-COURSE/I-UI |
| G21 | Persistent workspaces and backup restore | Covered; native per-step workspaces, restore preserves current saved work | — | E-COURSE; I-COURSE, tests |
| G22 | Independent runnable references | Covered for native courses; dependency isolation for imported workspaces unverified | P0 imported | E-COURSE; I-RUN/variants |
| G23 | Diff quality, ignore rules and file sync | Partial; line comparison/full file values, no git-style configurable ignore stack or per-file sync controls | P1 | E-UX diff; I-UI/server/files |
| G24 | External file watching | Partial; Vite can reload the frontend/preview, but no course-wide editor/diff/progress watcher protocol | P1 | E-COURSE other; I-UI |
| G25 | Simple/TSX/export app types | Missing built-in on-demand TSX/static app and named-export value viewer | P2 | E-COURSE app types; I-RUN |
| G26 | Project dev server lifecycle | Partial; explicit preview command works, no automatic package dev script discovery | P1 | E-COURSE; I-RUN |
| G27 | Course sidecars and service readiness | Missing general course-owned service graph; Docker assessment is not a persistent service manager | P0 service labs | E-COURSE config; I-RUN |
| G28 | Browser-native exercise assessments | Missing; Icode Playwright tests test the platform, not a learner-facing browser test adapter | P1 UI labs | E-UX testing; I-RUN/tests |
| G29 | Streaming tests/cancel/status | Covered for implemented adapters; bounded logs and process cleanup | — | E-UX testing; I-RUN and prior CI |
| G30 | Structured diagnostics | Partial; status/duration/readiness, no general file/line compiler navigation | P1 | I-RUN/I-UI; senior-course need |
| G31 | Progress persistence/export/sync | Partial; local self-report and export, no import, account identity or cloud sync | P1 import/P2 cloud | E-CLI progress; I-COURSE |
| G32 | Video/captions/transcript | Partial; native video/VTT and Markdown transcript, no timestamp transcript navigation or equivalent custom shortcuts | P2 | E-UX video; I-UI |
| G33 | Offline lesson video management | Missing download/cache/cleanup workflow | P2 | E-UX video/E-CLI cleanup; I-UI |
| G34 | Preferences/theme/shortcuts/onboarding | Partial; dark responsive UI and save/run shortcuts, no equivalent preference centre, theme modes or guided discovery | P2 | E-UX; I-UI |
| G35 | Deep links and initial route | Partial; external editor links, no equivalent exercise/variant URL router | P1 | E-COURSE other, F README; I-UI |
| G36 | Feedback/elaboration/interleaved practice | Missing dedicated workflow | P1 learning | E-COURSE other; I-UI |
| G37 | Presence/community/Discord | Optional; absent, unnecessary for single-user local learning | P2 | Epic presence package/launch docs; I-UI |
| G38 | Accounts/entitlements/platform login | Optional; absent; local tutor credentials are not a learner identity system | P2 | E-CLI auth/E-MCP; I-MCP |
| G39 | Hosted/read-only and StackBlitz modes | Optional; no equivalent deployment mode; public exposure is outside current design | P2 | Epic deployment/E-COURSE; I-UI |
| G40 | Cache warming/cleanup/support diagnostics | Missing comparable lifecycle; manual backup retention and limited log control | P1 cleanup/P2 cache | E-CLI/debug docs; I-CLI |
| G41 | Author launch checks | Partial; schema/entry checks, no all-step assessment/media/link/prerequisite launch audit | P1 | Epic admin/launch; I-CLI |
| G42 | MCP context/resources/prompts/diffs | Partial; five read-only tools only; see exact comparison below | P1 | E-MCP; I-MCP |
| G43 | MCP user actions | Optional; absent by design; adding writes requires an explicit permission model | P2 | E-MCP; I-MCP |
| G44 | Multi-course indexed retrieval | Optional; no equivalent to separate Epic Agent index/search | P2 | A; I-MCP |

A `doctor` command is a recommended Icode solution to G03, not a claim that Epic has a command with that name. The supplied course uses real setup scripts; reproducing their intent does not require silently executing every imported hook.

## MCP: three different concerns

### 1. Platform assistant MCP

Epic's inspected local server registers **18 tools, 8 resource registrations and 1 prompt (`quiz_me`)**. Icode registers **5 read-only tools and no resources/prompts**. Counts describe the inspected registrations, not universal runtime capability guarantees.

| Epic local surface | Icode equivalent | Assessment |
|---|---|---|
| `get_workshop_context`, `get_exercise_context`, `get_exercise_step_context` | `list_course`, `read_lesson`, file list/read tools | Partial; lacks bundled exercise context, intro/outro and richer context metadata |
| `get_diff_between_apps`, `get_exercise_step_progress_diff` | No MCP diff tool | Missing; the UI diff does not make this available to assistants |
| `get_what_is_next` | UI next-incomplete, read_progress | Missing MCP recommendation/context tool |
| `get_quiz_instructions`, `quiz_me` prompt | Opt-in general tutor | Missing structured teaching/quiz protocol and prompt discovery |
| Eight resource registrations for context, diffs and user data | None | Missing resources/templates surface |
| `view_video`, `open_exercise_step_files` | Browser video and VS Code URI | No equivalent MCP actions |
| `list_saved_playgrounds`, `set_saved_playground`, `set_playground` | UI workspaces/backups | No MCP actions; read-only inventory could be added separately |
| `update_progress`, `get_user_progress` | `read_progress` | Read subset; no mutation or user identity |
| `login`, `logout`, `get_user_info`, `get_user_access` | None | Optional Epic account-specific behaviour |

Recommended next MCP increment: bounded exercise context, saved-project diff, next lesson, quiz instructions and read-only resources. Keep solution access opt-in and report truncation/provenance. Do not enable execution, reset or progress writes merely to match a tool count. External-client configuration and acceptance should be tested in at least one real client; existing SDK protocol coverage is not that evidence.

### 2. MCP servers built inside the course

The supplied course teaches ping, tools (simple/arguments/errors), resources (simple/templates/list/completion), resource tools (embedded/linked), and prompts (basic/optimised/completion). It launches learner TypeScript servers and uses real SDK clients in Vitest tests. Supporting this requires G01–G07 regardless of how rich the platform's own MCP becomes. Icode's own read-only server cannot substitute for these learner servers.

### 3. Separate Epic Agent service

Epic Agent is not the same package or a required branch of the local workshop. Its documented five retrieval tools are `list_workshops`, `retrieve_learning_context`, `retrieve_diff_context`, `search_topic_context`, and `retrieve_quiz_instructions`. It indexes course content in D1, optionally uses Vectorize/AI, and exposes bounded context with cursors/provenance. Keyword fallback is documented when vector bindings are absent. This is an optional future cross-course retrieval reference, not a blocker for the local senior course. No hosted account, authentication or endpoint was exercised.

## Recommended delivery sequence and exit gates

1. **Correct compatibility reporting.** Reject zero steps and unsupported layouts; distinguish native-valid, import-required and runnable. Add the exact supplied layout as a regression fixture without copying paid lesson content.
2. **Finish setup and execution contracts.** Course-specific prerequisites, repeatable dependency install, trusted setup/reset hooks, package-script execution and finite TypeScript/Vitest assessment. Run on Linux/macOS/Windows. Preserve existing work and secrets.
3. **Prove one real MCP vertical slice.** Native or explicitly adapted course: failing ping starter → edited passing solution → actual Inspector connection; seeds ready; dependencies available in reference copies; selected learner stdio server usable by a client; shutdown leaves no owned descendants. Then cover tools/resources/prompts and assess all 13 pairs. Preserve each step's intended starter outcome rather than assuming every pedagogical starter must fail.
4. **Close authoring and learner gaps needed by the senior course.** Intro/outro pages, stable deep links, expressive lesson components, improved diff, editor sync, progress import and author acceptance command. Either implement an Epic importer or state that only original Icode-native courses are supported; do not imply unchanged Epic compatibility.
5. **Add learning-focused MCP.** Read-only context/diff/resources/quiz workflow, explicit solution policy and a real external assistant acceptance journey.
6. **Author the senior AI engineer course.** Build original content on the accepted platform contracts. Persistent infrastructure and real authenticated Langfuse/Cosmos/tutor acceptance remain separate checks. Presence, Epic accounts, paid video integration, offline downloads and hosted search require explicit product decisions, not automatic scope expansion.

No implementation changes or package publication are part of this audit. No upstream source was imported into Icode. The course and Epic packages declare GPL-3.0-only; this report records that metadata, and proposes compatibility requirements rather than a relicensing conclusion. Media access is separate from repository access.

## Primary acceptance test: replace the host in the supplied course

Use an isolated branch of `IcodeNet/mcp-fundamentals`, keeping its main branch intact. Replace Epic host dependencies, launch/setup integration and host-specific lesson components with Icode equivalents. Preserve original lesson objectives, starter implementations, reference solutions and assessment assertions. Maintain an explicit mapping for any path or MDX conversion. Do not rewrite course logic or weaken tests to conceal host incompatibilities.

Pin the original Epic-hosted commit as the baseline. Establish its actual results in the same environment rather than assuming every starter fails or every solution passes. Record legitimate environment or upstream failures separately. Then run the Icode-hosted branch through the same course scenarios:

1. Fresh clone and documented setup: declared versions, dependency installation, seeds and useful failures.
2. Discover all 13 problem/solution pairs; retain the 38 instructional documents and course navigation.
3. Run original assessments against all starters and solutions; compare outcomes with baseline. Demonstrate a real learner edit from failing to passing where the exercise expects it.
4. Start Inspector against selected learner servers; validate ping, tool calls, resources/templates/completion and prompts against course expectations.
5. Verify switching steps, dependency resolution, seed lifecycle, reference isolation and external-editor changes.
6. Verify save/restart persistence, progress, comparisons, reset and backup restore.
7. Stop/cancel/restart; verify owned Inspector/server descendants and ports are released.
8. Separate authenticated video/client checks from local core acceptance; report blocked checks explicitly.

A pass establishes **MCP Fundamentals course-host compatibility**, a strong release gate for the planned senior course. It does not establish all Epic capabilities (offline media, hosted accounts, other app types and multi-course lifecycle still require their own checks). The course branch must be able to start without Epic workshop engine packages; retaining Epic's engine behind an Icode wrapper would not satisfy the swap. Course content/SDK dependencies are a different concern from the engine and should be accounted for explicitly.

## What remains unverified

- Behaviour of upstream features beyond inspected source/docs; no full Epic UI walkthrough in this audit.
- Actual installation, seed execution and runtime behaviour of the supplied course under either host.
- Authenticated Epic video, account/entitlement and hosted Epic Agent behaviour.
- External assistant operation against Icode, beyond its existing SDK client tests.
- Accessibility, performance at large course sizes, cross-process locking and production hosting suitability.

The correct completion claim today is: **the implemented Icode native workflows pass their existing tests; broad Epic parity and the supplied MCP course compatibility remain incomplete.**
