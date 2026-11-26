# Multi-language learning architecture

## Product scope

Icode Workshop teaches languages from beginner through advanced, as well as applied AI engineering. A course is composed of modules, lessons and steps. Each step owns instructions, a starter project, a reference solution, tests, and an optional preview. The engine must not assume JavaScript, a single file, or a running web app.

## Runtime contract (proposed, not yet implemented)

A runtime adapter provides: validate environment, prepare workspace, build, test, start/stop processes, collect bounded output, and report preview URL. Runtime commands execute only in locally trusted projects; adapters must use argument arrays rather than shell interpolation. Runtime selection is explicit in the lab manifest.

| Runtime | Build/check | Test | Interactive execution |
|---|---|---|---|
| TypeScript / Node | pnpm exec tsc --noEmit | pnpm test | Node process, optional HTTP preview |
| Python | python -m compileall | python -m pytest | Python process, optional FastAPI preview |
| Rust | cargo check | cargo test | cargo run, optional HTTP preview |
| C# / .NET | dotnet build | dotnet test | dotnet run, optional HTTP preview |
| Jupyter | Validate notebook structure | nbclient or pytest-notebook where appropriate | JupyterLab launched locally; notebook outputs remain notebook-native |
| Docker Compose | docker compose config | project-specific tests | Explicitly approved services, ports and teardown |

## Suggested manifest

```yaml
schemaVersion: 1
id: python-foundations/variables
runtime: python
level: beginner
starter: ./problem
solution: ./solution
instructions: ./README.md
commands:
  test: [python, -m, pytest, -q]
  run: [python, main.py]
preview:
  type: console
```

## Curriculum examples

- Python: syntax, functions, classes, typing, virtual environments, pytest, FastAPI, notebooks, ML, AI agents.
- Rust: ownership, borrowing, lifetimes, traits, error handling, Cargo tests, async Tokio, Axum, systems integrations.
- TypeScript: types, async, Fastify, Vercel AI SDK, tools, streaming, MCP.
- C#: language fundamentals, ASP.NET Core, xUnit, dependency injection, Azure AI and production services.

## Implementation order

1. Introduce versioned manifest schema and validate every lab before running it.
2. Replace single-file API with safe multi-file listing/read/write within a per-lab workspace.
3. Add adapter interface and Node, Python, Rust and .NET adapters, each with environment checks.
4. Add real tests and sample beginner labs for Python and Rust; test the problem fails and the solution passes.
5. Add per-runtime process management, output streaming and HTTP previews.
6. Add notebook adapter by integrating an existing Jupyter runtime rather than rebuilding notebook execution.
7. Add course/module/lesson navigation, Markdown instructions, completion and reset.
8. Integrate external `senior-ai-engineer-labs` content, run builds and acceptance tests before release.

## Acceptance criteria

- A Python learner edits multiple files, runs pytest, and sees actionable failures.
- A Rust learner edits a crate, runs cargo test, and sees compiler diagnostics.
- A .NET learner runs build and xUnit tests in a solution.
- A TypeScript learner starts a Fastify server and accesses its local preview.
- Switching between labs never overwrites work, and reset requires confirmation.
- Unavailable runtimes show setup instructions rather than claiming a test passed.

**Status:** This is an architecture specification and implementation backlog. The current app does not yet implement these adapters.

## Third-party adapter extension contract

External developers should be able to publish an adapter as an independent npm package, for example `@community/icode-ruby-adapter`. Adapters are installed explicitly and declared in a trusted workshop configuration; **never download or execute a package merely because a lab manifest names it**.

The public `@icodenet/workshop-adapter-api` package should expose a versioned TypeScript contract. Proposed shape:

```ts
export interface WorkshopAdapter {
  id: string
  apiVersion: 1
  detect(context: RuntimeContext): Promise<Diagnostic[]>
  prepare(context: RuntimeContext): Promise<void>
  run(command: 'build' | 'test' | 'start', context: RuntimeContext): Promise<RunResult>
  stop?(context: RuntimeContext): Promise<void>
}
export interface RuntimeContext {
  workspaceRoot: string
  signal: AbortSignal
  emit(event: { type: 'stdout' | 'stderr' | 'diagnostic'; text: string }): void
}
export interface RunResult {
  exitCode: number | null
  previewUrl?: string
}
```

This is a **design proposal**, not a currently published API. Define runtime lifecycle and subprocess ownership carefully: long-running `start` should return a managed process/session handle rather than block indefinitely, and `stop` must clean up processes. Validate adapter identifiers, API compatibility, capabilities and configuration at load time. Document plugin authoring, provide a test harness and a sample community adapter. Treat adapters as trusted executable code with the user's local permissions; use explicit opt-in and recommend containers for untrusted labs. Maintain a stable core that can register adapters without importing any language-specific code.
