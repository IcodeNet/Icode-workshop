# Icode Workshop web

React interface with local filesystem-backed playground and test execution. Visual palette and typography follow the user's own `IcodeNet/homer-ai/docs/neural-network-building.html`.

From the repository root, open two terminal windows:

```sh
pnpm install
node packages/web/server.mjs
```

In the second terminal:

```sh
pnpm --dir packages/web dev
```

Open http://127.0.0.1:5173 and select exercise 01. Changes are saved to `examples/.workshop/playgrounds/<id>/index.mjs`; the test button invokes Node's built-in test runner from that exercise workspace. Successful test discovery and execution are not yet verified. Each exercise retains its own playground in `examples/.workshop/playgrounds/<id>/` when you switch away and return.

Security: the API binds only to loopback and checks browser Origin. It runs user-authored exercise code, so **only use locally with trusted exercises**. Do not expose this service on a public network. This is an MVP: single-file line diffs are implemented, but multi-file diff rendering and build verification remain future work. Build and test execution have not yet been independently verified.

See [feature parity audit](../../docs/feature-parity-audit.md) for gaps, priorities and release gates.
