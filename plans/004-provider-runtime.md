# Plan 004: Introduce provider runtime services

> Drift check: `git diff --stat 1a5214f..HEAD -- src/providers src/providers.ts src/utils.ts src/config.ts __tests__/providers`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/003-domain-schemas-errors.md`
- **Category**: migration
- **Planned at**: `1a5214f`, 2026-08-14

## Why

Provider adapters currently combine credentials, ambient environment/filesystem, global fetch or subprocess execution, payload decoding, normalization, and time. Effect services should make these boundaries interruptible and testable while pure provider normalization remains ordinary TypeScript.

## Scope

In scope: all `src/providers/*.ts`, `src/providers.ts`, provider-facing portions of `src/utils.ts`, narrowly named runtime service modules, provider tests, and one Changeset. Out of scope: Solid components and refresh scheduling.

## Steps

1. Add cohesive Effect services/layers for JSON/text file reads, environment lookup, bounded JSON HTTP requests, command execution, and clock. HTTP must enforce timeout, classify 401/403/429/status/decode failures, limit response bytes, and support interruption. Command execution must cap output, classify timeout/exit failures, and never expose stderr/response bodies.
2. Replace the broad provider fetch signature with a generic provider definition carrying literal ID, provider-specific config schema/capabilities, session aliases, stable footer window kind, and an Effect fetch operation. Derive registry IDs/order from one manifest without unsafe completeness casts.
3. Keep credential precedence provider-owned but share parsing mechanics. Trim and discard empty credentials. Bind auto-discovered credentials to official hosts; custom hosts require explicitly configured credentials. Reject URL userinfo. Preserve loopback HTTP only for explicit local testing.
4. Migrate Codex first and Qwen second. Use tests to prove HTTP and command service layers, interruption, typed errors, decoding, and deterministic clock behavior. Then migrate ZAI, Synthetic, and MiniMax.
5. Require each successful provider to produce at least its semantically required primary window. Reject impossible numbers and HTTP-200 error envelopes. Fix Synthetic session aliases to include `synthetic`.
6. Replace global fetch/command mocks with Effect test layers. Preserve safe user-facing summaries at the adapter boundary.
7. Add a patch Changeset describing the provider runtime migration, stricter payload handling, Synthetic footer fix, and credential-host protection.

## Verification

- `bun test __tests__/providers` -> all provider/service cases pass.
- `bun run typecheck` -> provider effects expose typed errors and no broad `Promise<ProviderUsage>` contract remains.
- `bun run check`, `bun run build`, `bun run knip` -> exit 0.
- `rg "globalThis.fetch|execFileAsync|readJsonFile<" src __tests__/providers` -> no provider-owned global boundary or generic JSON assertion remains.

## STOP Conditions

- Official host restriction would remove a documented region endpoint; add it explicitly rather than bypassing trust checks.
- A provider’s real response contract cannot be inferred from existing fixtures and code.
- Effect interruption cannot terminate the Qwen child process on supported platforms.

## Maintenance

Adding a provider should primarily add one adapter and one manifest entry. Reviewers should reject services that merely rename an Effect API without hiding boundary policy.
