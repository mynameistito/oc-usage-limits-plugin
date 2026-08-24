# Contributing

Thanks for helping with `oc-usage-limits-plugin`.

AI-assisted contributions are welcome. Keep generated issue and PR text concise, accurate, and human-readable.

## Report Bugs Or Features

- Search existing issues first.
- For bug reports, include the OpenCode version, platform, relevant config, and clear reproduction steps.
- For feature requests, describe the problem and the behavior you want.
- Do not include secrets, tokens, or response bodies.
- For security issues, follow `SECURITY.md`.

## Setup

```bash
bun install
bun run typecheck
```

Useful commands:

```bash
bun run check
bun run fix
bun test
bun run build
bun run knip
```

## Make Changes

- Work on a branch.
- Keep changes small and focused.
- Put standard OpenCode changes on `main`; put OpenCode v2 host/API changes on `opencode-v2` and keep their release work in the v2 `next` lane.
- Do not mix stable and v2 changesets casually. If a change belongs in both lanes, create or port changesets deliberately.
- Use TypeScript-first code with no default exports.
- Add or update tests under `__tests__/` for non-trivial behavior.
- Run the relevant checks before opening a PR.

## Architecture

- Pure domain modules define usage values, typed errors, config decoding, and formatting without owning lifecycle state.
- Provider adapters use Effect runtime services for HTTP, filesystem, environment, command, and clock boundaries. Credentials stay provider-owned and errors remain redacted.
- The scoped coordinator owns refresh policy, cancellation, concurrent provider work, the last-success cache, and immutable snapshots.
- `src/plugin.tsx` is the composition root and UI bridge: it registers slots, provides production services, and forwards snapshots to Solid signals.
- Solid components own presentation control flow and must not fetch providers or schedule refreshes.
- To add a provider, extend the typed provider manifest and adapter, then add fixtures and lifecycle/error coverage under `__tests__/`.
- Do not include credentials, response bodies, stderr, or raw boundary causes in user-facing errors or tests.

## Code Style

- Use Bun only for package and script commands.
- Follow Ultracite/Biome via `bun run check` and `bun run fix`.
- Prefer `const`, explicit types, and clear small functions.
- Keep comments brief and only when needed.

## Changesets

Use a changeset for user-facing changes:

```bash
bun run changeset-add patch "short summary"
```

Use `minor` for new features and `major` for breaking changes.

Stable releases use normal Changesets mode on `main`. The v2 branch uses Changesets prerelease mode and publishes the resulting versions with the npm `next` dist-tag automatically when changes land on `opencode-v2`:

```bash
bunx changeset pre enter next
bun run version
```

Commit the generated `.changeset/pre.json` and version/changelog changes on `opencode-v2`. Exit prerelease mode only for an intentional promotion:

```bash
bunx changeset pre exit
```

Do not manually edit package versions or consume the same pending changeset independently from both release lanes.

## Pull Requests

- Use conventional commits.
- Keep PR descriptions concise.
- Link related issues when relevant.
- Mention any config or migration impact.
- Make sure `bun run check`, `bun run typecheck`, and `bun test` pass when applicable.
