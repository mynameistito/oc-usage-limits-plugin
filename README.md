# oc-usage-limits-plugin

OpenCode TUI plugin that shows Codex and ZAI usage limits in the sidebar and prompt footer.

## Features

- Adds a `Usage Limits` block under the sidebar `Context` section.
- Shows current Codex usage windows from OpenAI/Codex auth.
- Shows current ZAI quota windows from ZAI Coding Plan auth.
- Adds compact prompt-footer usage when the current session uses an OpenAI or ZAI Coding Plan model.
- Providers are toggled from `~/.config/opencode/usage-limits.jsonc`.
- Reads OpenCode-connected credentials first, then falls back to explicit config/env credentials.

## Install

Add the TUI plugin to `~/.config/opencode/tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["oc-usage-limits-plugin"],
}
```

OpenCode TUI plugins are configured in `tui.json`, not `opencode.jsonc`.

Restart OpenCode after changing TUI plugin config.

## Usage Config

Create `~/.config/opencode/usage-limits.jsonc`:

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
      "authPath": "~/.codex/auth.json",
    },
    "zai": {
      "enabled": true,
      "label": "ZAI",
      "authPath": "~/.local/share/opencode/auth.json",
      "apiKey": "{env:OC_ZAI_API_KEY}",
      "authorizationScheme": "raw",
    },
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

## Credential Lookup

Codex lookup order:

1. OpenCode auth at `~/.local/share/opencode/auth.json`, provider `openai`.
2. Codex auth file from `authPath`, default `~/.codex/auth.json`.

ZAI lookup order:

1. Config `authPath`, which can point at OpenCode auth JSON or a simple `{ "key": "..." }` / `{ "apiKey": "..." }` JSON file.
2. OpenCode auth at `~/.local/share/opencode/auth.json`, provider `zai-coding-plan`.
3. OpenCode auth provider `zai`.
4. Config `apiKey`, including `{env:OC_ZAI_API_KEY}` references.

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
```

Prompt footer shows compact usage when the current session model belongs to a supported provider:

```txt
5h: 42% used resets 1h 2m
```

Provider mapping:

- OpenCode provider `openai` -> Codex usage.
- OpenCode provider `zai-coding-plan` -> ZAI token usage.

## Development

```powershell
bun install
bun run typecheck
```

The package exposes a TUI entrypoint at `oc-usage-limits-plugin/tui` for OpenCode's package plugin loader.

## Notes

- The refresh interval defaults to 60 seconds.
- The effective minimum refresh interval is 15 seconds.
- Errors are intentionally short and do not include auth tokens or response bodies.
