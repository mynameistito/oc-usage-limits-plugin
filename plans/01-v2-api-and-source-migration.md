# V2 API And Source Migration

## Worktree

Create a dedicated worktree from the stable baseline:

```powershell
git worktree add ..\oc-usage-limits-plugin-v2 -b opencode-v2 main
```

Pin the worktree to the selected upstream OpenCode v2 commit or published plugin package before implementation starts.

## Ownership

This worktree owns the v2 source adapter and v2-specific tests. It must not alter stable-only release workflow behavior until the migration is integrated and reviewed.

## Source changes

### Entrypoint

Change `src/index.ts` and `src/plugin.tsx` together:

- Replace the legacy `TuiPluginModule`/`TuiPlugin` contract with the v2 `Plugin.define` contract.
- Keep the public `./tui` package export and plugin ID `mynameistito.usage-limits`.
- Move production dependency construction into `setup(ctx)`.
- Preserve test injection by keeping the coordinator dependencies separable from the host context.

### UI slots

Replace `api.slots.register` with individual v2 claims:

- `append: "sidebar.content"` for `UsageLimitsPanel`.
- `append: "prompt.footer"` or the selected status sub-slot for `BottomUsage`.

Use v2 render inputs:

- `sessionID` instead of `session_id`.
- Return `null` for the footer when there is no session.
- Return `null` for shell mode unless v2 behavior proves shell mode should show usage.

Do not assume the old numeric `order: 101` has a v2 equivalent. Validate placement using the v2 slot tree.

### Session data

Replace `api.state.session.messages(sessionID)` with `ctx.data.session.message.list(sessionID)`. Update `currentProviderID` only enough to support the actual v2 message info shape, including provider/model data under `message.info` where applicable. Preserve newest-message-first selection and provider aliases.

Add tests for:

- v2 top-level and nested provider/model shapes.
- Empty message lists.
- Missing session IDs.
- Shell footer suppression.
- Unknown provider IDs and the existing fallback policy.

### Theme

Replace legacy `TuiThemeCurrent` usage in `src/components.tsx` with the v2 resolved theme type. Map every color access deliberately, for example:

- `text` to `theme.text.default`.
- Muted text to `theme.text.subdued`.
- Warning/error/success to `theme.text.feedback.<kind>.default`.

Avoid casting the entire v2 theme to the legacy shape. A small adapter is preferable so UI components keep semantic color names and the mapping is testable.

### Cleanup

The v2 `setup` function must return cleanup that:

- Calls both synchronous disposer functions returned by `ctx.ui.slot`.
- Interrupts the Effect coordinator fiber.
- Does not leave timers, HTTP requests, command processes, or subscriptions alive after hot reload.
- Is safe if called more than once or after partial setup.

Prefer a single cleanup function that owns all resources and preserve the existing coordinator interruption semantics.

## Dependency and build checks

- Pin the exact v2-compatible `@opencode-ai/plugin` package or workspace snapshot used for compilation.
- Add `@opencode-ai/theme` only if the source imports its type/value directly and the v2 host requires it.
- Confirm externalization in `tsdown.config.ts` for every host-supplied v2 package.
- Confirm the built package does not bundle OpenTUI, Solid, or OpenCode host runtime packages.
- Reassess exact peer versions against the v2 host rather than widening blindly.

## Tests and acceptance

Add a v2-specific host contract test or fixture that verifies the real exported shape. The existing package smoke test expects `{ id, tui }` and must be made lane-aware rather than weakening the stable assertion.

Run:

```powershell
bun run typecheck
bun test
bun run check
bun run build
bun run test:package
bun run knip
```

Then load the packed artifact in the selected OpenCode v2 build and verify:

- Plugin activation.
- Sidebar rendering in a session.
- Footer rendering in normal mode.
- Footer omission on home/shell screens as intended.
- Dynamic refresh and cached/error states.
- Hot reload or plugin replacement cleanup.
