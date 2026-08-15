# Plan 005: Scope refresh orchestration

> Drift check: `git diff --stat 1a5214f..HEAD -- src/plugin.tsx src/components.tsx src/session.ts src/format.ts __tests__ README.md CONTRIBUTING.md`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/004-provider-runtime.md`
- **Category**: migration
- **Planned at**: `1a5214f`, 2026-08-14

## Why

The plugin entrypoint currently owns refresh policy, mutable cache, timer recursion, stale calculation, and lifecycle cleanup. It also waits for the slowest provider before registering slots. A scoped Effect coordinator can make cancellation and concurrency explicit while Solid remains the sole presentation state owner.

## Scope

In scope: `src/plugin.tsx`, a cohesive coordinator module, `src/components.tsx`, `src/session.ts`, related tests, architecture/contributor docs, README provider corrections, and one Changeset. Out of scope: new product features, persistent history, and visual redesign.

## Steps

1. Implement one scoped coordinator Effect that loads config/auth, publishes loading and terminal snapshots, fetches enabled providers concurrently, retains the last successful usage per provider, calculates staleness from the Clock, and repeats using the latest validated interval. Keep policy separate from Solid.
2. Start the runtime in a scope owned by plugin initialization and interrupt/close it from `api.lifecycle.onDispose`. Ensure active HTTP and Qwen work stops, no state publishes after disposal, and cancellation is not rendered as a provider error.
3. Register UI slots before starting initial provider work. Bridge coordinator snapshots into Solid signals through one callback; do not duplicate reactive state in Effect subscriptions/Refs beyond coordinator-owned cache.
4. Make the sidebar empty/non-empty branch reactive with Solid control flow. Use stable window kinds for footer selection. Unknown/unavailable session providers must not display unrelated provider usage unless the documented fallback is deliberately retained and tested.
5. Update lifecycle tests for immediate slot registration, initial loading, concurrent completion, cached errors, config changes, interval changes, disposal during work, and no post-disposal publication.
6. Document the architecture boundaries in `CONTRIBUTING.md`: pure domain, Effect adapters/services/coordinator, Solid UI/composition root, provider extension procedure, typed-error/redaction rules. Update README and examples for Qwen and corrected provider mappings.
7. Add a patch Changeset describing scoped cancellation, faster initialization, reactive sidebar behavior, and architecture completion.

## Verification

- `bun test` -> all lifecycle, UI, session, and provider tests pass.
- `bun run typecheck`, `bun run check`, `bun run build`, `bun run knip` -> exit 0.
- `rg "setTimeout|Promise\.all|new Map<ProviderID" src/plugin.tsx` -> no manual coordinator implementation remains in the entrypoint.
- Build entrypoint smoke test from Plan 002 -> exit 0.

## STOP Conditions

- OpenCode disposal cannot safely await scope closure; report the API limitation and use documented synchronous interruption only if verified.
- Solid signals require writes from a thread/runtime context that Effect does not preserve.
- Existing characterization tests reveal intentionally different fallback behavior not documented here.

## Maintenance

Keep `plugin.tsx` as composition root and UI bridge. Retry/backoff and future snapshot history belong in the coordinator, but are explicitly deferred until typed provider errors and the basic scoped loop are stable.
