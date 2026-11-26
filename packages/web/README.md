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

Open http://127.0.0.1:5173 and select exercise 01. Changes are saved to `examples/playground/index.mjs`; tests run using Node's built-in test runner. Each exercise retains its own playground in `examples/.workshop/playgrounds/<id>/` when you switch away and return.

Security: the API binds only to loopback and checks browser Origin. It runs user-authored exercise code, so **only use locally with trusted exercises**. Do not expose this service on a public network. This is an MVP: full diff rendering and build verification remain future work. Build and test execution have not yet been independently verified.
