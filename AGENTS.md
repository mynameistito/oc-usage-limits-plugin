# AGENTS.md

## Project Overview
`oc-usage-limits-plugin` is an OpenCode TUI plugin in TypeScript. It surfaces Codex and ZAI usage limits in the sidebar and prompt footer.

## Repo Layout
- `src/` core plugin code, providers, UI, and utilities
- `__tests__/` automated tests
- `.changeset/` release notes and versioning metadata
- `.github/` CI, release, and PR templates
- `scripts/` helper scripts such as `changeset-add`
- `examples/` sample config and usage files

## Important Commands
- `bun install`
- `bun run typecheck`
- `bun run check`
- `bun test`
- `bun run build`
- `bun run knip`
- `bun run changeset-add`

## Style And Workflow
- TypeScript-first; use Bun only for package and script execution.
- No default exports unless required by the framework.
- Avoid `any` unless there is a clear necessity.
- Keep functions small and single-purpose.
- Use Changesets for user-facing changes.
- Keep PR and issue text concise.
- AI assistance is allowed, but avoid verbose generated prose.

## Testing Guidance
- Put tests under `__tests__/`.
- Prefer colocated `*.test.ts` files.
- Do not mock away meaningful behavior unless the test truly needs isolation.

## Community Standards Files
This repo also includes community-facing docs and automation: Code of Conduct, Contributing, Security, issue and PR templates, and Dependabot config. Keep them aligned with the repo’s actual contributor workflow.
