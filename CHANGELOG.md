# oc-usage-limits-plugin

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
