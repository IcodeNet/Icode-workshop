# Icode Workshop web prototype

Visual design based on the user's own `IcodeNet/homer-ai/docs/neural-network-building.html` CSS palette: white/ink, slate blue, red accent, Georgia headings, system sans-serif, responsive layout and optional dark mode.

Run from the repository root:

```sh
pnpm install
pnpm --dir packages/web dev
```

The interface currently provides browser-session editing and read-only problem/solution/diff views. **The Run tests button does not execute code**; it explicitly directs users to the working CLI. Browser storage, filesystem persistence, real diff rendering and test execution require backend integration. No third-party workshop framework or source code is used.
