# Contributing

Thanks for helping with `oc-usage-limits-plugin`.

## Report Bugs Or Features

- Search existing issues first.
- For bug reports, include the OpenCode version, platform, relevant config, and clear reproduction steps.
- For feature requests, describe the problem and the behavior you want.
- Do not include secrets, tokens, or response bodies.
- For security issues, follow `SECURITY.md`.

## Setup

```powershell
bun install
bun run typecheck
```

Useful commands:

```powershell
bun run check
bun run fix
bun test
bun run build
bun run knip
```

## Make Changes

- Work on a branch.
- Keep changes small and focused.
- Use TypeScript-first code with no default exports.
- Add or update tests under `__tests__/` for non-trivial behavior.
- Run the relevant checks before opening a PR.

## Code Style

- Use Bun only for package and script commands.
- Follow Ultracite/Biome via `bun run check` and `bun run fix`.
- Prefer `const`, explicit types, and clear small functions.
- Keep comments brief and only when needed.

## Changesets

Use a changeset for user-facing changes:

```powershell
bun run changeset-add patch "short summary"
```

Use `minor` for new features and `major` for breaking changes.

## Pull Requests

- Use conventional commits.
- Keep PR descriptions concise.
- Link related issues when relevant.
- Mention any config or migration impact.
- Make sure `bun run check`, `bun run typecheck`, and `bun test` pass when applicable.
