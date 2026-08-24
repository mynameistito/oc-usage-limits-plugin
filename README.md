# oc-usage-limits-plugin

OpenCode TUI plugin that shows Codex, OpenCode GO, ZAI, Synthetic, MiniMax Token Plan, and Qwen usage limits in the sidebar and prompt footer.

## Features

- Adds a `Usage Limits` block under the sidebar `Context` section.
- Shows current Codex usage windows from OpenAI/Codex auth.
- Shows current ZAI quota windows from ZAI Coding Plan auth.
- Shows current Synthetic rolling 5-hour and weekly windows.
- Shows current MiniMax Token Plan rolling 5-hour and weekly windows.
- Shows current Qwen Token Plan windows from the local `qwencloud` CLI.
- Shows current OpenCode GO rolling, weekly, and monthly windows.
- Adds compact prompt-footer usage when the current session uses an OpenAI, OpenCode GO, ZAI Coding Plan, Synthetic, or MiniMax Token Plan model.
- Providers are toggled from `~/.config/opencode/usage-limits.jsonc`.
- Reads OpenCode-connected credentials first, then falls back to explicit config/env credentials.

## Install

Standard OpenCode uses the stable package from npm's `latest` dist-tag. Install it globally with:

```bash
opencode plugin oc-usage-limits-plugin -g
```

- `-g` / `--global` installs to `~/.config/opencode/tui.json`.
- Without `-g`, installs locally to `<project>/.opencode/tui.json` (requires a git worktree).
- `--force` replaces an existing pinned version.

The CLI installs the `latest` package and updates the TUI plugin config for you. The package entrypoint is `oc-usage-limits-plugin/tui`.

OpenCode v2 uses the preview package from npm's `next` dist-tag. Install it globally with OpenCode v2 only:

```bash
opencode plugin oc-usage-limits-plugin@next -g
```

The v2 package is built and released from the `opencode-v2` branch. It is preview/beta software until validation against the v2 host is complete. Do not use `@next` with standard OpenCode, and do not use the stable package with OpenCode v2.

To configure it manually instead, add the plugin to `~/.config/opencode/tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["oc-usage-limits-plugin"],
}
```

OpenCode TUI plugins are configured in `tui.json`, not `opencode.jsonc`.

Restart OpenCode after changing TUI plugin config.

### Troubleshooting

#### Reinstall or refresh the cached plugin

If the plugin is stale, broken, or needs a clean reinstall, quit OpenCode and remove the cache for the lane you installed. OpenCode caches immutable package versions, so clearing the cache is required when a `tui.json` entry still resolves to an older version.

For standard OpenCode (`@latest`):

PowerShell:

```powershell
Remove-Item -LiteralPath "$HOME\.cache\opencode\packages\oc-usage-limits-plugin@latest" -Recurse -Force
```

macOS/Linux:

```bash
rm -rf ~/.cache/opencode/packages/oc-usage-limits-plugin@latest
```

For OpenCode v2 (`@next`):

PowerShell:

```powershell
Remove-Item -LiteralPath "$HOME\.cache\opencode\packages\oc-usage-limits-plugin@next" -Recurse -Force
```

macOS/Linux:

```bash
rm -rf ~/.cache/opencode/packages/oc-usage-limits-plugin@next
```

Start OpenCode again and it will reinstall the plugin from the existing `tui.json` entry. If the plugin is no longer configured, run the install command again:

```bash
opencode plugin oc-usage-limits-plugin -g
```

- **Dependency conflicts involving `@opencode-ai/plugin`** usually mean OpenCode's package cache contains an older plugin API package. Update OpenCode, clear the cached plugin as above, then retry the install. This package does not publish OpenCode runtime packages as peer dependencies.
- **`No versions available`** right after a release means a supply-chain cooldown policy (e.g. `min-release-age`) is blocking the fresh version. Wait for the cooldown window to pass, or install a previously vetted version instead.

## Release Lanes

- Stable releases come from `main`, use the `latest` npm dist-tag, and are intended for standard OpenCode.
- OpenCode v2 previews come from `opencode-v2`, use the `next` npm dist-tag, and are intended only for OpenCode v2.
- Both lanes use the same package name and `oc-usage-limits-plugin/tui` entrypoint.
- Releases are staged on npm for manual approval before publication. Stable releases create normal GitHub releases; v2 previews create GitHub prerelease tags/releases.
- The v2 lane remains preview/beta until the package has been validated against the v2 host.

## Usage Config

Create `~/.config/opencode/usage-limits.jsonc`. The same file lives at [`examples/usage-limits.jsonc`](examples/usage-limits.jsonc) and can be copied verbatim:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/mynameistito/oc-usage-limits-plugin/main/usage-limits.schema.json",
  "enabled": true,
  "refreshIntervalSeconds": 60,
  "requestTimeoutMs": 10000,
  "showErrors": true,
  "providers": {
    "codex": {
      "enabled": true,
      "label": "Codex",
      "showSidebarBar": true,
      "showFooterBar": true,
      "sidebarWindow": "all",
      "footerWindow": "auto",
    },
    "zai": {
      "enabled": true,
      "label": "ZAI",
      "apiKey": "{env:OC_ZAI_API_KEY}", // Optional fallback when OpenCode auth has no ZAI key
      "authorizationScheme": "raw",
    },
    "synthetic": {
      "enabled": true,
      "label": "Synthetic",
      "apiKey": "{env:OC_SYNTHETIC_API_KEY}", // Optional fallback when OpenCode auth has no Synthetic key
    },
    "minimax": {
      "enabled": true,
      "label": "MiniMax",
      "apiKey": "{env:OC_MINIMAX_TOKEN_PLAN_KEY}", // Optional fallback when OpenCode auth has no MiniMax key
    },
  },
}
```

### Minimal config

If you only need Codex and ZAI with auto-discovered credentials:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/mynameistito/oc-usage-limits-plugin/main/usage-limits.schema.json",
  "providers": {
    "codex": { "enabled": true },
    "zai": { "enabled": true, "authorizationScheme": "raw" },
  },
}
```

Disabled providers are hidden:

```jsonc
"providers": {
  "codex": { "enabled": true },
  "zai": { "enabled": false }
}
```

`enabled` is the plugin master switch, while each provider's `enabled` field controls fetching. Provider `showSidebarBar` and `showFooterBar` independently control that provider's displays without stopping refreshes. `sidebarWindow` filters that provider's sidebar windows (`all`, `rolling`, `daily`, `weekly`, `monthly`, `credits`, or `other`), and `footerWindow` selects its footer window (`auto` or one of those kinds). Both display flags default to `true`; `sidebarWindow` defaults to `all` and `footerWindow` to `auto`.

## Providers

| Provider ID | Service | Env var | Auth header | Default base URL |
| --- | --- | --- | --- | --- |
| `codex` | ChatGPT Codex usage | — | Bearer | `https://chatgpt.com/backend-api` |
| `zai` | Z.AI Coding Plan quota | `OC_ZAI_API_KEY` | raw / Bearer | `https://api.z.ai` |
| `synthetic` | Synthetic quotas | `OC_SYNTHETIC_API_KEY` | Bearer | `https://api.synthetic.new` |
| `minimax` | MiniMax Token Plan | `OC_MINIMAX_TOKEN_PLAN_KEY` | Bearer | `https://www.minimax.io` |
| `qwen` | Qwen Token Plan | `qwencloud` CLI | CLI | — |
| `opencode-go` | OpenCode GO usage | `OPENCODE_API_KEY` | Bearer | `https://opencode.ai/zen/go/v1` |

Synthetic always uses `Bearer` auth and ignores `authorizationScheme`.

Set `baseUrl` on `minimax` to `https://api.minimaxi.com` when using the mainland-China region. MiniMax always uses `Bearer` auth and ignores `authorizationScheme`.

## Credential Lookup

`authPath` and `apiKey` are optional overrides. Typical OpenCode users only need `enabled: true`; `label` is an optional display override. Credentials are discovered automatically from OpenCode auth and provider defaults. Set `apiKey` (or `authPath` to a standalone key file) only when auto-discovery is not enough.

Codex lookup order:

1. OpenCode auth at `~/.local/share/opencode/auth.json`, provider `openai`.
2. Codex auth file from `authPath`, default `~/.codex/auth.json`.

ZAI lookup order:

1. Config `authPath`, which can point at OpenCode auth JSON or a simple `{ "key": "..." }` / `{ "apiKey": "..." }` JSON file.
2. OpenCode auth at `~/.local/share/opencode/auth.json`, provider `zai-coding-plan`.
3. OpenCode auth provider `zai`.
4. Config `apiKey`, including `{env:OC_ZAI_API_KEY}` references.

Synthetic lookup order:

1. Config `authPath` JSON file (`{ "key": "..." }` / `{ "apiKey": "..." }` / `{ "synthetic": { "key": "..." } }`).
2. OpenCode auth at `~/.local/share/opencode/auth.json`, provider `synthetic`.
3. Config `apiKey`, including `{env:OC_SYNTHETIC_API_KEY}` references.

MiniMax Token Plan lookup order:

1. Config `authPath` JSON file (`{ "key": "..." }` / `{ "apiKey": "..." }` / `{ "minimax-coding-plan": { "key": "..." } }`).
2. OpenCode auth at `~/.local/share/opencode/auth.json`, provider `minimax-coding-plan`, `minimax`, or `minimax-token-plan`.
3. Config `apiKey`, including `{env:OC_MINIMAX_TOKEN_PLAN_KEY}` references.

## Display

Sidebar rows look like:

```txt
Usage Limits
codex
  5h: 42% used resets 1h 2m
  weekly: 12% used resets 3d 4h
ZAI
  tokens: 18% used resets 2h
  MCP: 6% used
Synthetic
  5h: 0% used resets 11m
  weekly: 11% used resets 7m
MiniMax
  5h: 10% used resets 2h 56m
```

Prompt footer shows compact usage when the current session model belongs to a supported provider:

```txt
5h: 42% used resets 1h 2m
```

Provider mapping:

- OpenCode provider `openai` -> Codex usage.
- OpenCode provider `zai-coding-plan` -> ZAI token usage.
- OpenCode provider `synthetic` -> Synthetic usage.
- OpenCode provider `minimax-coding-plan` -> MiniMax Token Plan usage (prompt footer); `minimax` is also accepted as an alias.
- OpenCode provider `qwen` -> Qwen Token Plan usage.
- OpenCode provider `opencode-go` -> OpenCode GO usage.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run check
bun run build
```

The package exposes a TUI entrypoint at `oc-usage-limits-plugin/tui` for OpenCode's package plugin loader.

## Notes

- The refresh interval defaults to 60 seconds.
- The effective minimum refresh interval is 15 seconds.
- Provider work starts in a scoped coordinator after both TUI slots are registered. Disposal interrupts the coordinator and its active provider work.
- Errors are intentionally short and do not include auth tokens or response bodies.
- MiniMax Token Plan returns `{ model_remains, base_resp }`; the per-model `current_interval_status` and `current_weekly_status` are treated as `1` = in plan and `3` = not in plan, and a window is hidden when its status is `3` (the API otherwise reports a meaningless `100%` remaining for a non-existent bucket).
