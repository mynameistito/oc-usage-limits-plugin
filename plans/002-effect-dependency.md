# Plan 002: Declare and validate Effect

> Drift check: `git diff --stat 1a5214f..HEAD -- package.json bun.lock tsdown.config.ts src/index.ts __tests__`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: `plans/001-runtime-characterization.md`
- **Category**: migration
- **Planned at**: `1a5214f`, 2026-08-14

## Why

Effect is currently only a transitive dependency of `@opencode-ai/plugin` at `4.0.0-beta.83` (`bun.lock:163,439`). Importing it undeclared is unsafe. Before migrating logic, prove that one directly declared version builds, loads, and has an acceptable bundle impact.

## Scope

In scope: `package.json`, `bun.lock`, `tsdown.config.ts` only if packaging requires it, a focused smoke test, one tiny non-production-effect proof module if necessary, and one Changeset. Out of scope: provider/config/orchestration migration.

## Steps

1. Record the current `dist/index.mjs` byte size after `bun run build` using a cross-platform Bun command.
2. Add Effect as a direct runtime dependency with Bun. Align with the version resolved by the pinned OpenCode plugin unless current package constraints prove that impossible. Do not depend on flattening and do not add a second major version.
3. Keep Effect bundled unless an import smoke test proves OpenCode consumers always provide the exact runtime dependency. Document the packaging choice in a short comment only if it is non-obvious.
4. Add a smoke test that imports the built entrypoint and verifies its ID and callable `tui` property. Measure the new bundle size and include the before/after numbers in the Changeset or PR notes, not source comments.
5. Add a patch Changeset describing the explicit runtime dependency and package smoke coverage.

## Verification

- `bun install --frozen-lockfile` -> exit 0 after lock update is complete.
- `bun run build` -> exit 0.
- `bun -e "const m = await import('./dist/index.mjs'); if (!m.default?.tui) process.exit(1)"` -> exit 0.
- `bun run typecheck && bun test && bun run check && bun run knip` -> all pass.

## STOP Conditions

- The direct version conflicts with `@opencode-ai/plugin` or produces two Effect major versions.
- The entrypoint cannot load in a clean package-style import.
- The minified entry bundle grows by more than 250 KiB. Report measured sizes instead of changing the threshold.

## Maintenance

Effect is beta in the current dependency graph. Keep API usage localized so a future beta upgrade does not spread across UI and pure domain modules.
