# Icode Workshop — feature parity audit

Audit date: 2026-11-26. Scope: current `feat/react-workshop-ui` branch compared with the documented EpicShop learner experience. This is a **source review**, not a successful end-to-end runtime test. "Implemented" means code exists, not that it has passed acceptance testing.

Sources: https://github.com/epicweb-dev/epicshop ; https://www.epicweb.dev/get-started ; https://foundations.epicweb.dev/guide ; https://get-started.epicreact.dev/guide

| Feature | Current Icode Workshop | Gap / acceptance criterion | Priority |
|---|---|---|---|
| Lab discovery and navigation | Basic exercise IDs and sidebar | Module > exercise > step hierarchy; metadata-driven titles | P0 |
| Problem and solution | Read-only single index.mjs | Arbitrary project trees and runnable variants | P0 |
| Playground selection | Separate persistent workspace per ID | Explicit selection, reset/restore, cross-step migration, clear state | P0 |
| Playground editing | Single textarea | File explorer, multiple files, create/delete, external editor links | P0 |
| Tests | Node --test button and output | Validate tests are actually copied and discovered; streaming, failure diagnostics, exit handling | P0 |
| Diff | Line-level LCS for one file | Multi-file diffs, additions/deletions/renames, diff against other steps | P0 |
| Lesson material | Short hard-coded description | Markdown/MDX, code examples, objectives, prerequisites | P0 |
| Preview / run app | Placeholder panel only | Per-variant process lifecycle and iframe/new-tab preview | P0 for web labs |
| Progress | None | Completion tracking and next-incomplete navigation | P1 |
| CLI | Basic core commands | Reliable init/start/update/list/progress workflow | P1 |
| Video lessons | None | Video and transcripts/captions where applicable | P1 |
| Editor file links | None | Configurable editor integration | P1 |
| Browser test runner | None | Support browser-oriented exercises where needed | P1 |
| Workshop configuration | Hard-coded paths/ports/labels | Typed config, external content repo, per-lab scripts | P0 |
| MCP assistant context | None | Read-only exercise context, opt-in progress tools | P2 |
| Authentication / cloud sync | None | Not needed for local-first MVP | Later |
| Practice/review mode | None | Revisit completed steps | P2 |
| Updates and presence | None | Optional; not required for first release | Later |

## Verified source-level findings

- `packages/web/server.mjs` runs Node's `--test` in the selected workspace. It does **not** stream output to the UI, and has no verified end-to-end test execution result.
- `packages/web/workspaces.mjs` copies the starter directory once and preserves separate per-ID directories.
- `packages/web/src/main.jsx` supports selection, saving, code comparison and output tabs; Preview is explicitly a placeholder.
- `packages/web/workspaces.test.mjs` provides a persistence regression test, but its execution has not been confirmed.
- The current single-file editor is insufficient for real RAG/MCP/agent projects.

## Release gates

1. Build the web app and run all unit tests in CI; fix failures.
2. Run an actual exercise from problem to passing solution, confirming test discovery and output.
3. Verify switching between two labs, refreshing browser, preserving work, and rejecting unsaved navigation.
4. Implement and test multi-file workspace CRUD and per-file diffs.
5. Implement runnable web previews with bounded processes and no public network exposure.
6. Load a lab from `senior-ai-engineer-labs` using external configuration rather than a copied sample.
7. Security review: local command execution, loopback API origin/host checks, symlinks, path validation, child process timeouts and resource limits.
8. Only after all P0 gates pass, consider merging PR #2 and publishing a package.

## Architecture decision

Keep `icode-workshop` separate from `senior-ai-engineer-labs`. Reuse general-purpose permissively licensed packages where appropriate, but implement Icode's original UI and orchestration. Do not import GPL-only workshop code without a deliberate licensing decision.
