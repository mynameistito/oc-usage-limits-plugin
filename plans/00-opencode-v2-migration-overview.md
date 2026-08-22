# OpenCode v2 Migration Overview

## Goal

Keep the current package usable with standard OpenCode while adding an OpenCode v2-compatible implementation published from a separate branch under the npm `next` dist-tag.

## Recommended release model

| Lane | Branch | Host | npm version | npm dist-tag |
| --- | --- | --- | --- | --- |
| Stable | `main` | Standard OpenCode TUI API | Current `1.x` line | `latest` |
| Preview | `opencode-v2` (or the repository's chosen v2 branch name) | OpenCode v2 beta TUI API | `2.0.0-next.N` | `next` |

Use the same npm package name, `oc-usage-limits-plugin`. npm versions are immutable, so the two lanes can safely point at different package versions through dist-tags. Do not publish a v2 build without an explicit `--tag next` equivalent.

## Important discovery

The upstream URL provided is the OpenCode repository, not a PR URL. The relevant upstream target is the protected `v2` branch and its v2 plugin API. The v2 API is beta and is not source-compatible with this plugin's current API.

## Current implementation boundary

The standard implementation currently:

- Exports `{ id, tui }` from `src/index.ts`.
- Uses `TuiPlugin` and `TuiPluginModule` from `@opencode-ai/plugin/tui`.
- Registers `session_prompt_right` and `sidebar_content` through `api.slots.register`.
- Reads session messages through `api.state.session.messages`.
- Uses `TuiThemeCurrent` fields such as `theme.textMuted` and `theme.warning`.
- Starts an Effect coordinator and interrupts it through `api.lifecycle.onDispose`.

These behaviors should remain unchanged on `main`.

## Required v2 API changes

The v2 implementation must instead:

1. Export `Plugin.define({ id, setup })` as the default TUI plugin module.
2. Register UI through `ctx.ui.slot` with hierarchical names:
   - `sidebar.content`
   - `prompt.footer` or `prompt.footer.status`
3. Read messages through `ctx.data.session.message.list(sessionID)`.
4. Read `sessionID` from v2 slot render arguments and handle an absent ID plus shell mode.
5. Use the v2 `ResolvedTheme` shape from `@opencode-ai/theme/tui`.
6. Return cleanup from `setup`, calling the synchronous slot disposer functions and interrupting the coordinator.

## Non-goals for the first migration

- Do not rewrite provider HTTP/CLI adapters unless v2 testing exposes a concrete runtime incompatibility.
- Do not change provider IDs, config keys, auth precedence, normalized usage types, or provider endpoints.
- Do not add a server plugin entrypoint; this package remains a TUI plugin.
- Do not merge v2 source changes into `main` until standard OpenCode compatibility is explicitly tested.

## Completion criteria

- Standard OpenCode continues to install and load the `latest` package.
- OpenCode v2 installs and loads `oc-usage-limits-plugin@next`.
- Sidebar and prompt footer render in v2, with correct session/provider selection.
- Plugin cleanup stops polling, in-flight requests, and old hot-reloaded plugin generations.
- Stable releases publish to `latest`; v2 previews publish only to `next`.
- All release, package smoke, typecheck, test, lint, build, and knip gates pass in both lanes.

## Open decisions to resolve before implementation

- Exact v2 commit/release to target, rather than an unpinned moving branch.
- Whether v2 uses `prompt.footer` or `prompt.footer.status` for the usage indicator.
- Whether v2 should also use `home.footer`; the current plugin's `CompactStatusLine` exists but is not registered.
- Whether preview GitHub releases are created or npm-only previews are preferred.
- Whether v2's OpenTUI/Solid versions should remain exact peers or become compatible ranges.
- Whether final v2 promotion should become `2.0.0` on `latest`, and how long `1.x` receives fixes.
