# Icode Workshop

An independent, local-first learning platform for engineering exercises.

## Current state
Initial TypeScript-friendly Node ESM core and CLI scaffold. React UI, package publishing, cross-repository content integration, and CI execution are pending. No cloud services required.

## Quick start
Requires Node.js 22+ and pnpm.

```sh
pnpm install
pnpm workshop list --content ./examples
pnpm workshop set 01 --content ./examples
pnpm workshop test --content ./examples
pnpm workshop diff 01 --content ./examples
pnpm test
```

`set` backs up an existing playground before replacing it. `test` runs Node's built-in test runner against the playground. `diff` uses the installed system diff executable (macOS/Linux).

## Packages
- `packages/core`: exercise discovery, path validation and filesystem playground operations
- `packages/cli`: terminal interface
- `packages/web`: reserved for future React UI

## Future integration
The learning-content repository will provide `exercises/<id>/problem` and `exercises/<id>/solution`, with the workshop invoked against that directory. Do not publish the package until API, licence, security, test and versioning review is complete.
