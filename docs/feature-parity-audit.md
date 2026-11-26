# Icode Workshop — parity review

Date: 2026-11-26. Reference: the official Epic Workshop tutorial was installed separately and run locally; home and `/01/01/problem` were inspected in Chromium. No Epic implementation source was imported into Icode. This is a learner-experience comparison, not a declaration of full parity.

The original Icode UI was substantially narrower: a single editor, short description and test output. The revised workbench keeps Markdown lesson material beside code and tools. Screenshots in the root README are genuine Icode browser captures.

| Capability | Icode evidence/status | Remaining gap |
|---|---|---|
| Lesson next to working area | Markdown lesson panel and responsive split layout | MDX components, richer course content |
| Course navigation | Manifest titles, previous/next, local completion | Module → exercise → step hierarchy, next-incomplete navigation |
| Playground selection | Per-lab persistent workspace, dirty-change confirmation | Set from arbitrary problem/solution/step, cross-step migration |
| Multi-file editing | Nested file selector, create/read/write/rename/delete | Full tree UI, editor deep links, binary/large-file workflows |
| Reset | Confirmed reset preserves backup directory | In-app backup restore and retention controls |
| Reference solution | Read-only matching file and project comparison | Independent problem/solution file trees and runnable variants |
| Diff | Saved whole-project changes including solution-only/playground-only files | Rename inference, arbitrary variants/steps, automatic refresh |
| Test execution | Real Node/Python failing-to-passing integration and browser journeys | Streaming output, structured diagnostics, independent assessment tests |
| Preview | Owned process, start/stop, loopback readiness, live Node example | Restart UX, address/history controls, per-variant sessions |
| Local tools | Explicit embedded/external modes with external fallback | Verified Langfuse/Cosmos services, native summaries, service ownership |
| Runtime extensibility | API v1 types, explicit loader, conformance helper, cancellation/session helper | Actual Rust/.NET/Jupyter adapters and cross-platform process validation |
| Video/transcripts | Not implemented | Author-supplied accessible media, captions, transcripts |
| Progress | Browser-local manual completion, separate from tests | Durable course-scoped progress, practice/review, export |
| Configuration | External content directory, manifests and explicit plugins | Course schema/hierarchy, complete manifest validation tooling |
| CLI | Existing CLI retained | Unify workspace paths and start/update/progress commands |
| Browser tests | Platform Playwright acceptance suite | Course-authored browser exercise runner |
| MCP, chat, presence | Not implemented | Optional later capabilities; not needed for local MVP |

## Observed Epic tutorial experience

Home includes a workshop overview, tutorial video/transcript controls, exercise navigation and keyboard shortcut guidance. The exercise screen keeps the lesson on the left and Playground, Problem, Solution, Tests, Diff and Chat affordances on the right. Its tutorial describes explicit playground selection, app start/stop/restart, iframe navigation, external editor links, comparisons between apps and progress/MCP workflows. Account-dependent transcript/chat features were not authenticated or tested. Not all described features were exercised end-to-end.

Reference sources:
- https://github.com/epicweb-dev/epicshop-tutorial
- https://github.com/epicweb-dev/epicshop
- https://www.epicweb.dev/tips/epic-workshop-diff-tab-demo

## Verification scope

The root test suite covers workspace persistence, nested file CRUD, traversal/symlink rejection, backup reset, runtime integration, plugin registration and managed cancellation. The browser suite covers Node/Python editing to passing tests, file operations, refresh persistence, comparison, reset, a live preview and self-reported progress persistence. Screenshots are generated during those tests. CI repeats the suite and build on the committed branch.

## Merge/release gates still open

1. Complete module/step navigation and runnable reference variants.
2. Validate real external course content, not just bundled examples.
3. Add richer authoring and video/transcript support where needed.
4. Validate optional service integrations against pinned actual services.
5. Review platform-specific process cleanup, concurrent workspace operations, and local execution threat model. This is not isolation for untrusted code.
6. Review package publishing/version policy and dependency licences.
7. Obtain explicit approval before merging into main.
