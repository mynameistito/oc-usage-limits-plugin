# Plan 001: Characterize runtime boundaries

> Follow each step and stop rather than improvising if the current code differs materially. Drift check: `git diff --stat 1a5214f..HEAD -- src/plugin.tsx src/providers/qwen.ts __tests__`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: `1a5214f`, 2026-08-14

## Why

`src/plugin.tsx:36-145` owns initial refresh, caching, parallel provider work, timers, and disposal, but no test initializes the plugin. `src/providers/qwen.ts:30-259` is the only subprocess adapter and has no direct tests. These behaviors must be executable through explicit seams before their implementation changes.

## Scope

In scope: `src/plugin.tsx`, `src/providers/qwen.ts`, new tests under `__tests__/`, one `.changeset/*.md`, and minimal test-support modules under `src/` only if needed. Out of scope: Effect, provider response behavior, config semantics, UI redesign, and dependency changes.

## Steps

1. Extract narrow dependency seams without changing production defaults. The plugin seam must allow tests to supply config/auth loading, provider fetching, scheduling, and current time. The Qwen seam must allow a controlled command runner. Prefer factories with default production dependencies over module mocks. Keep `tui` and the package export unchanged.
2. Add lifecycle tests covering initial success, one provider failure with previous success retained, disabled config, changed interval used by the next schedule, and disposal cancelling future scheduled refreshes. Assert slot registration and observable state passed to both slots.
3. Add Qwen tests for authenticated success, unavailable CLI, unauthenticated output, malformed/partial JSON, no subscription, non-zero exit, timeout classification, reset dates, and count calculation. Do not run a real CLI.
4. Add a patch Changeset describing internal testability and preserved runtime behavior.

## Verification

- `bun test` -> all existing and new tests pass.
- `bun run typecheck` -> exit 0.
- `bun run check` -> exit 0.
- `bun run build` -> exit 0.
- `bun run knip` -> exit 0.
- `git diff --name-only HEAD^` -> only in-scope files.

## STOP Conditions

- A seam requires changing the public `oc-usage-limits-plugin/tui` export.
- Tests require real network, filesystem credentials, wall-clock waits, or an installed Qwen CLI.
- Existing behavior must be guessed rather than observed from code/tests.

## Maintenance

Later plans must reuse these seams or replace them with Effect services while preserving the same behavioral tests. Avoid spy-only assertions when a rendered state or returned result can be asserted.
