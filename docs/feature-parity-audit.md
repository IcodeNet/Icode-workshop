# Icode Workshop — final verification checkpoint

Date: 2026-11-26. Scope: the agreed workshop workflow plus the additional branding, extensibility and AI-course requirements. **Full parity is not achieved. This is a verification checkpoint, not a completed-product declaration. PR #2 remains draft/unmerged.**

The reference workshop tutorial was previously run locally and its home/exercise workflows inspected. No reference implementation code was imported. This check compares the recorded workflow requirements against the current Icode implementation and executable tests. It does not claim every reference-product capability was exercised.

## Implemented and verified

| Requirement | Evidence | Boundaries |
|---|---|---|
| Hippo branding | Real browser screenshot; image visibility assertion; header and favicon | Generated raster logo, not a vector identity pack |
| Lesson beside workbench | Browser learner journeys and screenshots | Markdown; no MDX execution |
| Module → exercise → step navigation | Validated course manifest; external-course CLI test; browser navigation | Globally unique two-digit step IDs; max 100 steps |
| Previous/next and next incomplete | UI navigation and ordered course manifest | Progress is self-reported |
| Course-scoped progress | Concurrent update unit test; fresh browser-context persistence journey; export link/CLI | Shared per local course; no accounts/cloud sync; legacy browser progress not migrated |
| Persistent multi-file playground | Node/Python learner journeys; nested CRUD, traversal/symlink tests | Text files under 100 KB; excludes generated/hidden files |
| Reset and backup restore | Transactional replacement unit test; browser restore journey | Unsaved text not backed up; manual retention |
| Cross-step workflow | Previous-playground copy and arbitrary target-lesson comparison; browser comparison journey | Full project replacement, not three-way migration; compatible runtimes expected |
| Independent Problem/Solution views | Separate file lists; browser failing problem/passing solution | References are read-only in editor |
| Runnable reference variants | Disposable execution-copy unit test; reference preview browser journey | Local trusted code, not a security sandbox |
| Real Node/Python tests | Failing starter → passing solution integration/browser tests | Editable practice tests; no tamper-resistant assessment |
| Streaming/cancellation/status | Browser observes output while running, cancels, sees Ready; process cancellation test | Node reporter can buffer one test file; output is text, capped at 50k characters |
| Preview start/stop/restart | Browser checks live page for playground and solution | One owned preview per lab; configured loopback port |
| Local tool views | Browser embeds a fixture service and checks external-only fallback | Fixture evidence is not Langfuse/Cosmos service evidence |
| Transcript | Browser opens author-provided Markdown transcript | No automatic transcription |
| Versioned adapters | API v1 validation, third-party loader, detection/cancellation/conformance tests | Only built-in Node/Python have real toolchain evidence |
| CLI/course integration | External-course validate/set/test/progress test | Development launcher; no published standalone installer |
| Responsive layout | 390px viewport assertion and actual screenshots | Native desktop app not provided |
| Keyboard save/run | Browser keyboard-save test and run shortcut handler | Not a full command palette |
| Concurrent API operations | API mutation gate rejects overlapping operations | One API process per course; CLI/external writers must not race it |

## Implemented but not fully verified

| Requirement | Current implementation | Outstanding evidence |
|---|---|---|
| Video/captions | Native video controls and optional WebVTT track; URL validation | Generated WebM/VTT fixture playback and CORS verified in Chromium; actual course videos still need author-supplied content |
| File-tree UI | Expandable folder/file navigation using current project lists | Nested file selection verified; detailed screen-reader audit remains |
| Export progress | Same-origin JSON download and CLI JSON export | Browser download parses the exported JSON successfully |
| CLI start | Starts API + Vite with shared content directory; strict UI port | Dedicated cross-platform launcher/process cleanup test |

## Missing or blocked: required before full-scope completion

| Requirement | Status | Concrete next dependency/work |
|---|---|---|
| Rust, C#/.NET, Jupyter, Docker runtime adapters | Implemented; mandatory CI runtime gate pending | Real failing/passing/no-assessment tests are mandatory in CI. Locally Cargo/.NET/Docker are absent and Jupyter kernel sockets are prohibited; these are explicit skips, not passes. |
| Real Langfuse/evaluation tools | Read-only observations integration implemented; live verification blocked | Configure a supported v4/Cloud service and authorised project keys. Bounded API projection tests use fixtures; they do not prove a real service connection. Evaluation course content follows the platform work. |
| Cosmos live views | Fixed-query Azure SDK view implemented; live verification blocked | Configure a reachable account/emulator, database, container and authorised key. No account is provisioned and no data is written. |
| Live AI tutor acceptance | Connection layer and UI implemented; live model verification blocked | Configure the endpoint/model. Transport and error handling are tested with explicit fixtures; real model quality is not yet evaluated. MCP stdio is implemented and tested with a real client. |
| Full senior AI engineer course | Not integrated | Workshop has three foundation examples; the full lab syllabus/content is a separate next deliverable after the platform gate. |
| Editor deep links, structured diagnostics, three-way migration | Implemented | Browser verifies VS Code URI; structured execution status/duration/readiness is shown. Migration tests verify independent edits and conflict refusal. File-level reconciliation does not auto-merge conflicting hunks. |
| Windows/macOS process cleanup | Implemented; three-OS CI gate pending | Windows taskkill tree cleanup and POSIX process-group cleanup are exercised by an owned-descendant test. |
| Package distribution/licence review | Inventory complete; publishing intentionally gated | docs/dependency-licenses.json records installed versions/licences. semaphore declares MIT in its README despite missing package metadata. Current release format is the source monorepo; public package licensing/version approval remains an owner decision. |

## Verification run

- Local unit/integration suite: 27 passing tests and 4 explicit environment skips before CI, including real MCP protocol, migration and integration contract coverage.
- TypeScript adapter contract check and React production build: pass.
- Browser suite: 12 browser journeys pass locally, covering tutor UI, real media/captions, export and editor URI in addition to the original flows. Mandatory native-runtime and portability CI results remain pending.
- Browser evidence is genuine Chromium output. This host's system Chromium launcher is broken and the current browser download is denied; the installed Playwright headless-shell binary runs the suite successfully.
- CI must be checked on the final pushed commit. No merge or package publication is authorised by a passing test run alone.

Reference sources previously reviewed:
- https://github.com/epicweb-dev/epicshop-tutorial
- https://github.com/epicweb-dev/epicshop
- https://www.epicweb.dev/tips/epic-workshop-diff-tab-demo
