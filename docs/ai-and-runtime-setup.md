# AI, services and additional runtimes

All integrations are optional. A local workshop needs no model/API credentials. Configure endpoints on the server; never put keys into lesson manifests or browser code.

## Tutor

The Tutor tab uses an OpenAI-compatible **chat completions** HTTP endpoint. Set:

- `WORKSHOP_TUTOR_URL`: complete endpoint URL, such as `http://127.0.0.1:11434/v1/chat/completions` for a separately running compatible local server.
- `WORKSHOP_TUTOR_MODEL`: model identifier available on that server.
- `WORKSHOP_TUTOR_API_KEY`: optional bearer credential for providers requiring one.

HTTPS is required for remote endpoints. Azure endpoints requiring different authentication/response formats need a compatible gateway; this implementation does not claim universal provider support. Clicking Ask sends the lesson, the saved selected file and up to 12 recent conversation messages. It does not send reference solutions automatically or unsaved editor text. The tutor cannot edit files or run code. Prompt instructions encourage incremental hints but are not a security boundary. Real model quality requires live evaluation with the chosen model.

## Local MCP server

Use a client's stdio MCP configuration to run:

```json
{
  "mcpServers": {
    "icode-workshop": {
      "command": "node",
      "args": ["/absolute/path/to/Icode-workshop/packages/mcp/server.mjs", "/absolute/path/to/course"]
    }
  }
}
```

Five read-only tools expose course structure, lessons, project file lists/text and progress. They do not create workspaces, execute code, write files or change progress. `WORKSHOP_MCP_SOLUTIONS=1` explicitly allows reading solutions; it is disabled by default. Connecting an AI client may cause that client to send retrieved course/code content to its model provider. No client is connected automatically.

The pinned MCP SDK v1.32.2 implements the 2025-11-25 protocol specification; v2/current-protocol migration is separate. The acceptance test performs a genuine stdio handshake, discovery, calls and denied-path/solution checks using the official SDK client.

## Read-only service snapshots

The Tools tab can load bounded snapshots from configured services. It does not deploy them, modify their data, or claim that an unconfigured integration is connected.

Langfuse Cloud/self-hosted v4:

- `WORKSHOP_LANGFUSE_URL`: base URL.
- `WORKSHOP_LANGFUSE_PUBLIC_KEY`, `WORKSHOP_LANGFUSE_SECRET_KEY`: project keys.
- The view reads up to 20 observations from the last 24 hours using `/api/public/v2/observations`. It returns selected identifiers/timing/status fields, not prompt inputs/outputs. Self-hosted v3 requires its older API and is not supported by this view.

Cosmos DB for NoSQL:

- `WORKSHOP_COSMOS_ENDPOINT`, `WORKSHOP_COSMOS_KEY`.
- `WORKSHOP_COSMOS_DATABASE`, `WORKSHOP_COSMOS_CONTAINER`.
- The Azure SDK issues a fixed `SELECT TOP 20 c.id, c.status, c.category FROM c`. No arbitrary SQL, writes or container creation are exposed. Use an account/resource intended for the course. Reads consume the configured account's request units. TLS certificate validation is retained, including for emulators.

Transport/projection tests use explicit fixtures. A live service acceptance check requires supplied endpoints and authorised credentials; fixture tests are not live-service evidence.

## Runtime contracts

| Runtime ID | Prerequisites | Project contract | Passing condition |
|---|---|---|---|
| `node` | Node 22+ | Node test files | Test runner succeeds; files discovered |
| `python` | Python + pytest | pytest test files | pytest succeeds |
| `rust` | Cargo/Rust | Cargo.toml | Offline cargo test succeeds and reports at least one passing test |
| `dotnet` | .NET SDK + VSTest-compatible test project | Root .csproj/.sln; entry explicitly configured | dotnet test produces fresh TRX with executed tests and no failures |
| `jupyter` | Python, nbclient, nbformat, ipykernel; usable kernel sockets | notebook.ipynb, non-empty code cell tagged workshop-test | Real kernel executes all tagged assessments without error; writes notebook.executed.ipynb |
| `docker` | Docker daemon + Compose | compose.yaml with test service | Service exits successfully and writes .workshop-results.json containing integer passed > 0 and failed = 0 |

Additional runtimes require an explicit `entry` in lab.json. Rust dependency preparation is explicit: run `cargo fetch` locally before offline execution when dependencies are required. .NET may restore declared project packages. The .NET adapter targets VSTest/TRX; it does not silently treat unsupported MTP reports as success.

Docker uses a unique Compose project name per run and calls down during cleanup, including after cancellation. Compose content is trusted local code with daemon privileges; it is not a sandbox. Images may be pulled by Compose. Do not declare shared fixed container names or reuse non-external volume names if you require strict ownership isolation.

`WORKSHOP_JUPYTER_PYTHON` chooses a Python executable with the notebook dependencies. Readiness includes a loopback ZeroMQ bind; the kernel cannot run in hosts that prohibit these sockets. Local tests explicitly skip unavailable runtimes. CI sets `WORKSHOP_REQUIRE_ALL_RUNTIMES=1` and must execute all four real runtime journeys; a skip or missing toolchain does not satisfy that gate.

Windows process cancellation uses taskkill /T /F to terminate the owned process tree; POSIX uses process groups with escalation. A three-OS CI job validates real subprocess cancellation. Node/Python runs default to 15 seconds; other lab tests default to 120 seconds.

## Reference documentation

- https://doc.rust-lang.org/cargo/commands/cargo-test.html
- https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test-vstest
- https://nbclient.readthedocs.io/en/latest/client.html
- https://langfuse.com/docs/api-and-data-platform/features/public-api
- https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-javascript-query-items
