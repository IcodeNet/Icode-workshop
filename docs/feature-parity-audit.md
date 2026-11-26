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
| Video/captions | Native video controls and optional WebVTT track; URL validation | Real authored media/caption playback and hosting/CORS check; no video supplied |
| File-tree UI | Expandable folder/file navigation using current project lists | Detailed keyboard/screen-reader audit |
| Export progress | Same-origin JSON download and CLI JSON export | Browser download assertion not included |
| CLI start | Starts API + Vite with shared content directory; strict UI port | Dedicated cross-platform launcher/process cleanup test |

## Missing or blocked: required before full-scope completion

| Requirement | Status | Concrete next dependency/work |
|---|---|---|
| Rust, C#/.NET, Jupyter, Docker runtime adapters | Missing; real execution validation blocked here | `cargo`, `dotnet`, `jupyter`, `docker` are unavailable in this execution environment. Implement and test with actual toolchains, including no-tests/failure/cancellation cases. Registry extensibility is not adapter completion. |
| Real Langfuse/evaluation tools | Integration missing; live verification blocked | Provide a reachable service/deployment, test data and authorised access. Current generic iframe/link support does not provide tracing or evaluation APIs. |
| Cosmos live views | Integration missing; live verification blocked | Provide emulator/account endpoint and authorised credentials or a local authenticated service. No authenticated service connection has been configured or verified. |
| AI tutor/MCP | Missing | Establish the model/provider and authorised endpoint; implement tutor policy/context and MCP capabilities with protocol/behaviour tests. No fake assistant response is presented. |
| Full senior AI engineer course | Not integrated | Workshop has three foundation examples; the full lab syllabus/content is a separate next deliverable after the platform gate. |
| Editor deep links, structured diagnostics, three-way migration | Missing | Further implementation and acceptance tests; ordinary diff/copy/output are not equivalent. |
| Windows/macOS process cleanup | Unverified | Dedicated platform runners; POSIX process-group tests are insufficient. |
| Package distribution/licence review | Missing | Dependency licence and version/publishing policy review before publication. |

## Verification run

- Local unit/integration suite: 20 passing tests, including new external-course/CLI coverage.
- TypeScript adapter contract check and React production build: pass.
- Browser suite: 9 passing journeys, including nested file-tree navigation, reference execution, backup restore, streaming/cancellation and concurrent-mutation rejection.
- Browser evidence is genuine Chromium output. This host's system Chromium launcher is broken and the current browser download is denied; the installed Playwright headless-shell binary runs the suite successfully.
- CI must be checked on the final pushed commit. No merge or package publication is authorised by a passing test run alone.

Reference sources previously reviewed:
- https://github.com/epicweb-dev/epicshop-tutorial
- https://github.com/epicweb-dev/epicshop
- https://www.epicweb.dev/tips/epic-workshop-diff-tab-demo
