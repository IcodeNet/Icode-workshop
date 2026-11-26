# Icode Workshop

**Learn by building.** A local-first, extensible learning workbench for programming and AI engineering.

> **Development preview — not yet released.** The React interface exists on the `feat/react-workshop-ui` branch. The screenshots below are *design direction*, not captures of a verified running application. Builds, browser interactions and end-to-end tests are still awaiting verification.

[Explore the React app](packages/web) · [Feature parity audit](docs/feature-parity-audit.md) · [Multi-language architecture](docs/multi-language-architecture.md) · [Adapter API](packages/adapter-api) · [Development PR #2](https://github.com/IcodeNet/Icode-workshop/pull/2)

## What the learner sees

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Icode Workshop                       Local learning environment             │
├──────────────────┬──────────────────────────────────────────────────────────┤
│ LABS             │ Approved documents only                                  │
│                  │ Implement a retrieval filter for approved documents      │
│ 01  Approved     │                                                          │
│     documents    │ [Lab description] [Playground] [Solution] [Compare]       │
│                  │ ┌──────────────────────────────────────────────────────┐ │
│                  │ │ index.mjs                                            │ │
│                  │ │ // Edit your solution here                           │ │
│                  │ └──────────────────────────────────────────────────────┘ │
│                  │ [Save] [Run tests]                                       │
│                  │ [Preview] [Console] [Test results]                       │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

*Illustrative layout only.* The implemented UI uses a deep-navy, peach-accented theme. Preview is currently a placeholder for this Node.js exercise. The editor supports one file, not full project trees yet.

## Local development

**Prerequisites:** Node.js 22+ and pnpm 10. Do not expose the local API to a public network: exercises execute local code.

```bash
# Clone and check out the development branch
git clone https://github.com/IcodeNet/Icode-workshop.git
cd Icode-workshop
git checkout feat/react-workshop-ui
pnpm install

# Terminal 1: local API
node packages/web/server.mjs

# Terminal 2: React/Vite frontend
pnpm --dir packages/web dev
```

Open **http://127.0.0.1:5173** and select lab **01**. The API listens on loopback port **4317**. Edit the playground, save, run tests and compare your work against the solution. Playground edits are stored per exercise under `examples/.workshop/playgrounds/<id>/`.

**Current limitation:** The test button invokes Node's built-in test runner, but actual test discovery and an end-to-end passing exercise have not been confirmed. Do not treat a displayed PASS as verified coverage until that is fixed.

## CLI workflow

The earlier CLI uses a *different* single-playground workflow from the React app:

```bash
pnpm workshop list --content ./examples
pnpm workshop set 01 --content ./examples
pnpm workshop test --content ./examples
pnpm workshop diff 01 --content ./examples
```

The CLI's `set` operation replaces `examples/playground` after backing it up. The React UI instead retains a separate workspace for every lab. Unifying these paths is an outstanding integration task.

## Designed learning pathways

| Track | Example exercises | Runtime direction |
| --- | --- | --- |
| TypeScript & APIs | TypeScript, Fastify, streaming AI responses | Node.js |
| Python | Fundamentals, pytest, FastAPI, machine learning | Python |
| Rust | Ownership, borrowing, Cargo, async services | Rust |
| C# & .NET | ASP.NET Core, xUnit, Azure AI | .NET |
| Notebooks | Data analysis, model experiments | Jupyter |
| AI engineering | RAG, MCP, agents, evaluation, observability | Multiple runtimes |

These are **planned tracks**, not a claim that the corresponding runtime adapters or lessons are already implemented.

## Architecture

```text
                     Icode Workshop
            ┌───────────────────────────┐
            │ React UI / CLI            │
            │ Lessons · Files · Results │
            └─────────────┬─────────────┘
                          │
            ┌─────────────▼─────────────┐
            │ Workshop core             │
            │ Workspaces · Lab metadata │
            └─────────────┬─────────────┘
                          │
            ┌─────────────▼─────────────┐
            │ Runtime adapter registry  │
            │ Versioned contract (v1)   │
            └─────────────┬─────────────┘
                          │
       Node · Python · Rust · .NET · Jupyter · Custom
```

The diagram describes the **target architecture**. Today, the Node-oriented core, React prototype and explicit adapter registry are present, but runtime adapters are not yet wired into the execution engine.

## Build and tests

```bash
pnpm test
node --test packages/web/workspaces.test.mjs
node --test packages/adapter-api/index.test.mjs
pnpm --dir packages/web build
```

These commands have **not yet been confirmed passing** on this branch. The root `pnpm test` script currently covers core tests only; web and adapter tests must be included in CI.

## Packages

| Package | Purpose | Current status |
| --- | --- | --- |
| `packages/core` | Exercise discovery and CLI workspace operations | Implemented scaffold |
| `packages/cli` | Terminal exercise commands | Implemented scaffold |
| `packages/web` | React learning interface and local API | Prototype |
| `packages/adapter-api` | Explicit third-party adapter registration and contract checks | Experimental, unpublished |

## Roadmap and release gates

1. Make complete multi-file projects editable, testable and comparable.
2. Add language/runtime adapters, beginning with Node, Python, Rust and .NET.
3. Support managed preview processes and Jupyter integration.
4. Add structured Markdown lessons, modules, steps and progress tracking.
5. Integrate external learning content from `senior-ai-engineer-labs`.
6. Run automated builds, regression tests, security review and real browser acceptance tests.
7. Review licensing, package versioning and publishing before merging or releasing.

**Status:** No npm release, no verified production build and no completed EpicShop feature parity yet. Contributions are welcome through issues and pull requests; the third-party adapter API is experimental and may change.
