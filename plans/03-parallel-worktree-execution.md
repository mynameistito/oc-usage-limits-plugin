# Parallel Worktree Execution

## Baseline worktree

The current worktree is clean on `main`. Before implementation, record:

```powershell
bun run typecheck
bun test
bun run check
bun run build
bun run test:package
bun run knip
```

Do not modify stable source while v2 work is being developed. Use separate worktrees from the same stable commit.

## Worktree assignments

### Worktree A: v2 host contract

Owns `src/index.ts`, `src/plugin.tsx`, v2 host fixtures, and plugin lifecycle tests. Implements `Plugin.define`, v2 slots, `ctx.data`, theme adapter wiring, and cleanup.

### Worktree B: v2 UI/session adapter

Owns `src/session.ts`, `src/components.tsx`, formatting/theme adapter tests, and v2 message-shape tests. It must coordinate with Worktree A on the exact session and theme types, but must not edit entrypoint/release files.

### Worktree C: dependency/build validation

Owns `package.json`, `bun.lock`, `tsdown.config.ts`, and package smoke scripts on the v2 branch. Verifies exact v2 dependency versions, externalization, peer behavior, and packed artifact loading.

### Worktree D: release automation

Owns `.github/workflows/release-next.yml`, Changesets documentation/config decisions, and release documentation. It must not manually bump versions or consume stable pending changesets.

### Worktree E: stable regression verification

Remains on `main`, owns no source changes unless a concrete stable regression is found. Runs the standard package smoke test against the current legacy export and confirms stable release behavior remains unchanged.

## Integration order

1. Freeze the upstream v2 commit and record its package/API versions.
2. Complete Worktree A's host contract and cleanup shape.
3. Complete Worktree B against A's agreed render props and adapters.
4. Complete Worktree C and update the v2 package smoke test.
5. Complete Worktree D after the package versioning/publish command is proven locally or in a dry-run workflow.
6. Merge or cherry-pick the v2 worktrees into `opencode-v2` in that order.
7. Run real OpenCode v2 installation tests from the final packed artifact.
8. Independently run Worktree E and stable CI from `main`.

## Conflict rules

- A owns host lifecycle and entrypoint files.
- B owns UI/session files.
- C owns package/build files.
- D owns workflow/release docs.
- Existing provider/runtime/config files are out of scope unless a test demonstrates a concrete v2 requirement.
- Cross-boundary edits should be made in a small integration commit by the migration lead, not silently included by multiple agents.

## Agent prompts

Each sub-agent should receive:

- The pinned upstream v2 commit.
- The exact files it owns.
- The instruction not to alter unrelated files or pending stable changesets.
- Required test commands.
- The acceptance criteria for its worktree.

Each agent must report changed files, tests run, unresolved assumptions, and any API mismatch found in the pinned upstream source.
