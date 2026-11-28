# Multi-language learning architecture

## Implemented execution path

React → loopback HTTP API → per-lab workspace → explicit adapter registry → detect → prepare → run(test). The CLI shares the same per-step workspaces, runtime and course/progress APIs.

The core registry contains no language-specific imports. The web composition root registers Node, Python, Rust, .NET, Jupyter and Docker and explicitly loads operator-selected third-party modules. Lab metadata can select an already registered runtime but cannot install a package. API v1 is described by the [TypeScript declarations](../packages/adapter-api/index.d.ts) and [author guide](../packages/adapter-api/README.md). The custom-node example demonstrates loading a third-party-shaped module through the actual web execution path.

## Current manifest

```json
{
  "schemaVersion": 1,
  "runtime": "node",
  "entry": "message.mjs",
  "title": "Your first live preview",
  "description": "Build and inspect a local application.",
  "preview": {"command": ["node", "server.mjs"], "port": 4403},
  "tools": [{"id":"explorer","title":"Local Explorer","url":"http://localhost:1234","mode":"embed"}]
}
```

Manifests without `schemaVersion` are read as v1. README.md is rendered as lesson content; raw HTML is not enabled. The lab owns `problem/` and `solution/`; playground copies are per ID. Runtime and entry names, preview configuration and tool URLs are validated. The course manifest supplies module → exercise → step hierarchy; underlying step IDs remain globally unique two-digit IDs.

A manifest is trusted local course configuration. Preview commands use argv arrays and run only after a learner clicks Start app. HOST/PORT environment variables request loopback binding, but the platform cannot force an arbitrary program to honour them; isolation requires a separate container/process policy. Local Tools metadata does not start or install external services.

## Process lifecycle

Finite test runs have a deadline, cancellation and bounded output. The shared process helper supports owned sessions, completion promises and stop with termination escalation. The web preview host checks readiness and uses the same helper. Preview shutdown occurs on explicit stop, lab switch, reset or normal API termination. Browser reload retains the backend process until stopped/restarted; crash recovery and multi-client ownership require further work. POSIX groups and Windows taskkill tree cleanup passed the Linux/macOS/Windows CI matrix. The CLI launcher uses this same helper for API and Vite, waits for cleanup on signals or service exit, and launches Vite directly through Node to avoid platform-specific package-manager shell wrappers.

## Runtime status

| Runtime | Current status | Next evidence required |
|---|---|---|
| Node.js | Real tests, failing-to-passing integration/browser flow, multi-file HTTP preview | TypeScript package-script variants and broader process tests |
| Python | Real pytest failing-to-passing integration/browser flow | Virtual-environment selection, FastAPI preview course |
| Custom Node example | Explicit plugin load and real test execution verified | Independent packaging/publishing |
| Rust | Real cargo assessment CI passed | Broader course fixtures |
| C#/.NET | Real VSTest assessment CI passed | Broader course fixtures and HTTPS preview |
| Jupyter | Real nbclient assessment CI passed | Notebook-native interactive outputs |
| Docker | Real Compose assessment CI passed | Course-specific infrastructure acceptance |

The public optional start contract is an extension point; built-in adapters implement finite test/run operations. The web preview path is a host-managed manifest command, not a claim that every adapter implements interactive execution.

## Course services and assessment

Separate runtime, service ownership, tool presentation and assessment contracts. A Langfuse course should attach to a learner-owned instance or explicitly provision a course-owned stack; preserve volumes and keep credentials server-side. Cosmos readiness and explorer endpoints are distinct. See [local tools and AI courses](local-tools-and-ai-courses.md) for researched constraints and a phased design.

## Remaining dependencies

Live tutor, Langfuse and Cosmos acceptance needs operator-configured endpoints and credentials; current coverage is fixture/contract based. MCP has a real stdio client test, but no external assistant is connected. Public distribution and licence approval are owner decisions.
