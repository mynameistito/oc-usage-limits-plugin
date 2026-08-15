# Effect Migration Plans

Generated on 2026-08-14 at commit `1a5214f`. Execute these as stacked PRs in order. Every PR must include a Changeset and pass the full repository verification suite.

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 001 | Characterize runtime boundaries | P1 | M | - | TODO |
| 002 | Declare and validate Effect | P1 | S | 001 | TODO |
| 003 | Parse config and model typed errors | P1 | L | 002 | TODO |
| 004 | Introduce provider runtime services | P1 | L | 003 | TODO |
| 005 | Scope refresh orchestration | P1 | L | 004 | TODO |

Status values: TODO, IN PROGRESS, DONE, BLOCKED, REJECTED.

## Stack

- `advisor/001-runtime-characterization` targets `main`.
- `advisor/002-effect-dependency` targets `advisor/001-runtime-characterization`.
- `advisor/003-domain-schemas-errors` targets `advisor/002-effect-dependency`.
- `advisor/004-provider-runtime` targets `advisor/003-domain-schemas-errors`.
- `advisor/005-scoped-coordinator` targets `advisor/004-provider-runtime`.

## Shared Gates

Run `bun run typecheck`, `bun test`, `bun run check`, `bun run build`, and `bun run knip` on every branch. Do not weaken tests, lint rules, compiler settings, credential redaction, or public behavior to make a gate pass.

## Rejected During Audit

- Blanket conversion of pure formatting and Solid rendering to Effect: it adds ceremony without improving lifecycle, error, or boundary safety.
- The `brace-expansion` audit advisory: the reported path is build-time tooling beneath OpenTUI rather than reachable plugin runtime code; track through dependency updates instead of mixing it into this migration.
