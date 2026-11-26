# Local tools and AI engineering courses

Research date: 2026-11-26. This is an integration design, not a claim that Langfuse or Cosmos has been installed or verified here.

## Course experience

Keep lesson, editable project, tests and tools in the same workbench. The Tools panel supports explicit per-lab loopback links and sandboxed embedded views. Authors choose `embed` only for a service that permits framing. External fallback stays visible. This is an embedded web view, not a general browser: it cannot override the target's CSP, frame headers, login policy, certificates or mixed-content rules.

Example lab.json extension (supported by this branch):

```json
{
  "schemaVersion": 1,
  "runtime": "python",
  "entry": "main.py",
  "tools": [
    {"id":"langfuse","title":"Langfuse","url":"http://localhost:3000","mode":"external"},
    {"id":"cosmos","title":"Cosmos Data Explorer","url":"http://localhost:1234","mode":"embed"}
  ]
}
```

Cosmos embedding in this example is a candidate configuration; verify headers and authentication for the pinned emulator version before distributing a course. No service is installed or started by adding a link.

## Langfuse course proposal

Use the official self-hosted Docker Compose deployment, pinned to a course-tested release/commit and image versions. Do not silently download latest infrastructure during a lab. Offer an existing local instance first, an explicitly started course-owned Compose stack second, and optionally Langfuse Cloud for learners with constrained machines.

1. Setup: explain services and keys, check reachability and authenticated project access.
2. Instrument a deterministic Python or TypeScript task; flush telemetry before asserting that a trace arrived.
3. Create a small versioned dataset with expected outputs and stable IDs.
4. Implement deterministic evaluators (exact match, schema, retrieval relevance fixtures).
5. Run two experiments against the same dataset; show scores and compare regressions.
6. Introduce an optional paid LLM judge with an explicit cost budget, fixed rubric and repeat runs.
7. Gate a change on deterministic checks and a documented evaluation threshold; export the run evidence.

SDK execution runs in the learner's Node/Python workspace and points to the configured Langfuse base URL. The Workshop backend should retain secrets outside browser responses, redact output, and associate dataset/run/trace IDs with the lab. Langfuse ingestion is asynchronous: use bounded polling, not an arbitrary sleep or immediate missing-trace failure. A mocked task can teach tracing/evals without a paid model, but must be visibly labelled; it cannot stand in for a real integration acceptance test.

The official Langfuse offline evaluation guide describes SDK tasks running outside Langfuse and submitting results to it. That fits this platform without replacing the runtime adapters.

## Embedding limitation

The reviewed Langfuse main-branch Next configuration contains `frame-ancestors 'none'` and frame protection. Therefore a plain iframe is not a reliable default for its dashboard. Do not strip security headers with a generic proxy. The preferred first release is native Workshop trace/evaluation summary panels backed by the API, plus a dashboard deep link. A separately reviewed desktop host with isolated browser contents is a future option if full arbitrary-tool browsing inside one application becomes essential; it needs navigation permissions, download handling, process isolation and an update policy.

## Cosmos emulator

Microsoft documents the vNext gateway on 8081, Data Explorer on 1234 and health probes on 8080 (`/alive`, `/ready`, `/status`). Use separate health and UI URLs. For .NET/Java courses check HTTPS requirements. The emulator is a development dependency; do not teach it as a complete production Azure substitute. Pin versions and test feature/API coverage required by the lesson.

## Architecture beyond Epic-style workshop basics

Keep these contracts separate:

- Runtime adapter: Node, Python, future Rust/.NET/Jupyter; build/test/run and owned processes.
- Service provider: attach/check/start/stop a named dependency; preserve data volumes and never stop a learner-owned instance.
- Tool view: embedded UI, external link or native Workshop panel; no credentials in URLs.
- Assessment provider: deterministic tests and versioned evaluation evidence; record thresholds, dataset and evaluator versions.

Remaining implementation: service readiness API, secret storage/redaction, Compose ownership, dataset fixtures, native trace/score panels, real Langfuse acceptance tests, Cosmos embedding acceptance, cross-platform Docker setup checks. The current Tools panel alone is not this complete integration.

## Primary sources

- https://langfuse.com/self-hosting/deployment/docker-compose
- https://langfuse.com/docs/evaluation/get-started/offline
- https://github.com/langfuse/langfuse/blob/main/web/next.config.mjs
- https://langfuse.com/self-hosting/configuration
- https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux
- https://github.com/epicweb-dev/epicshop
- https://github.com/epicweb-dev/epicshop-tutorial
