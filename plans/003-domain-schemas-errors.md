# Plan 003: Parse config and model typed errors

> Drift check: `git diff --stat 1a5214f..HEAD -- src/types.ts src/errors.ts src/config.ts src/utils.ts usage-limits.schema.json __tests__`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/002-effect-dependency.md`
- **Category**: tech-debt
- **Planned at**: `1a5214f`, 2026-08-14

## Why

`readJsonFile<T>` casts unknown JSON, `loadConfig` trusts most fields, and all failures become defaults. Provider errors are mostly message-only exceptions. The migration needs parsed values and a stable typed error channel before scheduling or retry policy is introduced.

## Scope

In scope: `src/types.ts`, `src/errors.ts`, `src/config.ts`, JSON parsing portions of `src/utils.ts`, new cohesive domain/config modules, related tests, `usage-limits.schema.json` only to keep the public contract aligned, and one Changeset. Out of scope: provider transport rewrites, retry policy, UI visual changes.

## Steps

1. Define Effect schemas for top-level config and provider config. Parse from `unknown`, apply defaults only to omitted values, reject wrong types, enforce existing numeric minima, and accept the documented `$schema` field. Keep credentials wrapped/redacted after parsing.
2. Replace generic `readJsonFile<T>` with a function returning unknown or text; schemas at owning boundaries perform decoding. Keep JSONC support and add malformed comment/string regression tests.
3. Define precise tagged errors for config read/decode and provider credential, transport, timeout, rate-limit, response-decode, and command failures. Include provider/operation and safe causes; never include credential values or response bodies.
4. Make config absence resolve to defaults, but surface malformed or type-invalid existing config as a typed result that the later coordinator can render safely. Preserve best-effort OpenCode auth absence while decoding recognized fields.
5. Improve usage domain types: tie `ProviderUsage<ID>` to its provider ID, add stable window kinds separate from labels, use one canonical reset instant, and make percentage/count/unknown quota forms explicit. Add smart constructors or schemas for finite percentages, non-negative counts, and valid timestamps.
6. Adapt existing callers temporarily at their nearest boundary so behavior remains buildable. Add tests for every config field, unknown keys, malformed auth, invalid numbers/dates, redaction, and domain invariants.
7. Add a patch Changeset describing stricter config diagnostics and typed boundary parsing.

## Verification

- `bun test` -> all tests pass with new config/domain cases.
- `bun run typecheck` -> no casts from parsed unknown directly to config/auth/domain types.
- `bun run check`, `bun run build`, `bun run knip` -> exit 0.
- `rg "readJsonFile<|throw new Error\(" src/config.ts src/errors.ts` -> no generic JSON assertion or ordinary expected config errors.

## STOP Conditions

- Effect Schema APIs differ from the declared dependency enough to require guessing.
- The schema cannot represent JSONC defaults without silently accepting wrong types.
- Domain changes require a public configuration key rename or removal.

## Maintenance

Keep schema-derived protocol shapes at boundaries. Pure rendering should consume domain values and must not depend on Effect Schema internals.
