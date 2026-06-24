# oc-usage-limits-plugin

## 1.0.8

### Patch Changes

- 6df9a1a: Declare @opentui/core, @opentui/solid, and solid-js as required peer dependencies so OpenCode installs them alongside the plugin at runtime.

## 1.0.7

### Patch Changes

- 79fe78f: Stop publishing OpenCode runtime packages as peer dependencies and keep them as dev-only build dependencies. Bump the OpenTUI/Solid build packages to current releases and pin patched Seroval resolution to avoid install conflicts and audit failures.

## 1.0.6

### Patch Changes

- b9c1707: Validate the Codex base URL so credentials are only sent to https (or loopback http) endpoints, falling back to the default backend for anything else.

## 1.0.5

### Patch Changes

- 626e0e3: Add OpenCode-aligned dependency bump script and aligned packages with opencode.

## 1.0.4

### Patch Changes

- e6b40a7: Enforce usage config minimum values at runtime
- ea4b2cb: Add dependency overrides so Bun audit resolves transitive vulnerabilities.
- 65fbcfd: Keep cached usage visible when provider refresh errors are hidden

## 1.0.3

### Patch Changes

- 4d0fc9c: - no changes, rebuilt as imuutibility was on.

## 1.0.2

### Patch Changes

- 3d152aa: Stop showing ZAI MCP usage in the sidebar and footer and relabel the ZAI token quota window from tokens to 5h to match the rolling-window convention used by the Codex provider. The ZAI TIME_LIMIT entry is no longer surfaced as a usage window, but its prompt total is still used to infer the ZAI tier. Updates the session window lookup to prefer the 5h window and adjusts the provider and session tests accordingly.

## 1.0.1

### Patch Changes

- c8dafe8: Fix OpenCode TUI package peer dependency resolution

## 1.0.0

### Major Changes

- ed71015: Implement the OpenCode usage-limits TUI plugin as a full package entrypoint.

  - Added the package TUI module export with plugin id `mynameistito.usage-limits` and split the old monolithic TUI implementation into focused modules for rendering, config loading, provider fetching, session provider detection, formatting, shared types, and utilities.
  - Added a sidebar `Usage Limits` panel that displays enabled providers, loading and error states, stale data markers, color-coded usage windows, reset timing, and cached previous data when a refresh fails.
  - Added prompt-footer usage that detects the active OpenCode session provider and shows compact

  5h usage for OpenAI sessions or ZAI token usage for ZAI Coding Plan sessions.

  - Added Codex usage fetching from the ChatGPT backend usage endpoint with OpenCode auth lookup first, fallback Codex auth-file support, custom base URL support, account headers, usage-window parsing, limit label normalization, reset credit metadata, and percent clamping.
  - Added ZAI Coding Plan quota fetching with auth lookup from configured auth files, OpenCode auth, provider aliases, and `{env:...}` config references, plus raw or bearer authorization modes, token and MCP window parsing, reset calculation, and Lite/Pro/Max tier inference.
  - Added JSONC config loading from `~/.config/opencode/usage-limits.jsonc` with defaults for enablement, refresh interval, request timeout, error visibility, and per-provider configuration.
  - Added shared utility handling for JSONC comments and trailing commas, home-directory expansion, environment-variable references, HTTP timeout signals, JSON parsing, and concise HTTP error mapping.
  - Added a JSON schema and example config covering global options, provider enablement, labels, auth paths, API keys, authorization schemes, and custom Codex base URLs.
  - Added README documentation for installation through `tui.json`, config examples, provider credential lookup order, display output, provider mapping, development commands, and runtime notes.
  - Added build and package tooling with `tsdown`, explicit package exports and files, OpenCode/OpenTUI peer dependencies, typecheck/test/check/build/knip scripts, and generated lockfile updates.
  - Added quality automation with pinned GitHub Actions CI tasks, Changesets release automation, npm OIDC trusted publishing staging, GitHub release creation, Lefthook setup, Ultracite/Oxlint/Oxfmt configuration, and the non-interactive `changeset-add` helper for future agent-authored changesets.
  - Added Bun tests for configuration loading, provider dispatch and parsing, Codex and ZAI error handling, environment key resolution, JSONC parsing, fetch timeout/error behavior, session provider mapping, usage-window selection, and display formatting.
