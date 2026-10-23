---
name: review-typescript
description: Review checklist for TypeScript and JavaScript changes (.ts, .tsx, .js, .jsx, .mjs, .cjs), including Node.js servers, async code, and package.json changes.
---

# TypeScript / JavaScript Review Checklist

## Correctness
- Promises not awaited: `async` calls whose result or rejection is dropped, `forEach(async ...)` expecting sequential completion, missing `await` before `try` blocks end.
- `||` used for defaults where `0`, `""` or `false` are valid values (use `??`).
- Equality with `==` across types; `NaN` comparisons; `typeof null === "object"`.
- Mutation of shared objects or function arguments, especially default parameter objects and module-level state.
- Array methods on possibly `undefined` values; optional chaining that silently turns a required value into `undefined`.
- Number precision: money in floating point, IDs beyond `Number.MAX_SAFE_INTEGER` parsed from JSON.
- Date handling: `new Date(string)` with non-ISO formats, month offset (0-based), timezone assumptions.

## Types
- `any`, `as` casts and non-null assertions (`!`) that hide a real `undefined` path visible in the diff.
- Exhaustiveness: a new union member not handled in a `switch` without a `never` check.
- Runtime input (request bodies, JSON, env) trusted as a typed value without validation.

## Node.js
- Blocking calls (`readFileSync`, `execSync`, CPU-heavy loops) on request paths.
- Streams without error handlers; event listeners added per request and never removed.
- `child_process.exec` with interpolated strings (prefer `execFile`/`spawn` with arguments).
- Unhandled promise rejections in background tasks; timers not cleared on shutdown.

## Packages
- New runtime dependencies for trivial functionality; packages added to `dependencies` that belong in `devDependencies` or vice versa.
- Version ranges loosened (`*`, `latest`) or lockfile not updated with `package.json`.

## Do not report
- Style handled by the project's formatter or linter configuration.
- Missing types on locals that TypeScript infers correctly.
