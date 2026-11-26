# Icode Workshop web

React learning workbench with Markdown lessons, multi-file filesystem playgrounds, Node/Python tests, project comparisons, local completion and managed live previews.

From the root, run `pnpm install --frozen-lockfile`, then `node packages/web/server.mjs` and (in another terminal) `pnpm --dir packages/web dev`. Open http://127.0.0.1:5173.

Each lab owns `examples/.workshop/playgrounds/<id>/`. Tests execute saved code; Run tests first saves the current dirty file. Reset confirms and retains a timestamped backup. The API binds to loopback and validates Host/Origin and file paths. It runs trusted local code, not sandboxed code.

For checks run `pnpm test`, `pnpm --dir packages/web build`, and `pnpm test:browser` after installing Playwright Chromium. See the root README for screenshots and limitations, and the [parity audit](../../docs/feature-parity-audit.md) for outstanding work.
