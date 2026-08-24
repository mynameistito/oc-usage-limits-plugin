# oc-usage-limits-plugin

## 2.0.0-next.3

### Patch Changes

- e183031: Harden provider parsing and complete the opencode-v2 next release checks
- c9103c9: Keep provider usage text visible when sidebar or footer usage bars are disabled.

## 2.0.0-next.2

### Patch Changes

- 0b91654: Publish the typed provider display settings already included in the OpenCode v2 preview source.

## 2.0.0-next.1

### Minor Changes

- d5e6bed: Add typed master display, sidebar window filtering, and per-provider footer window selection configuration.
- af75e02: Move display visibility and window selection to typed provider-level configuration fields.
- e9d4e4b: Add separate `showSidebar` and `showFooter` configuration toggles for the v2 TUI displays.

### Patch Changes

- 41ea91f: Align the OpenCode v2 preview package with the current beta TUI API and host OpenTUI dependencies.
- a686f72: Remove the unused OpenTUI keymap development dependency from the OpenCode v2 preview package.

## 2.0.0-next.0

### Major Changes

- 5b2920b: Add an OpenCode v2 TUI plugin entrypoint with hierarchical UI slots, v2 session data access, and v2 lifecycle cleanup.

## 1.4.0

### Minor Changes

- b48a34e: Add OpenCode GO usage limits as a provider.

### Patch Changes

- 42bc8b9: Fix partial provider auth reads and cancel oversized HTTP responses
- f010871: Support Bun 1.4 and refresh all compatible dependencies. Effect remains on 4.0.0-beta.83 because the current OpenCode plugin requires that Effect v4 beta API.

## 1.3.1

### Patch Changes

- cf69cae: Update dependencies to the latest compatible releases and align OpenTUI development peers.
- 51bd775: Prepare the package for the Effect runtime migration with a direct runtime dependency and add a built-entrypoint smoke test.
- 36de774: Parse plugin configuration strictly with redacted credentials and typed boundary errors.
- e2fc561: Migrate provider runtime boundaries to interruptible, typed Effect services with bounded HTTP, filesystem, and command execution. Tighten provider payload validation and credential host handling, and expose Synthetic sessions in the footer.
- 65026ca: Add internal runtime seams and characterization coverage while preserving plugin and Qwen provider behavior.
- 7990812: Scope refresh orchestration under an interruptible Effect coordinator, register TUI slots before provider work starts, preserve cached usage on refresh errors, and keep sidebar/footer updates reactive through Solid.

## 1.3.0

### Minor Changes

- b08342c: Add Qwen Token Plan usage limits through the QwenCloud CLI. Install `@qwencloud/qwencloud-cli`, then authenticate with `qwencloud auth login` to show remaining credits and the reset date in the sidebar and prompt footer for OpenCode's `bailian-token-plan-personal` provider.

## 1.2.0

### Minor Changes

- eae9915: Collapsible sidebar with ▼/▶ toggle and provider count badge. Absolute reset timestamp display. Compact status line at home bottom. Count-based display (current/total) for ZAI and Synthetic providers.
- 72463da: Visual polish: Unicode block progress bars, tier badges, rich reset countdowns, token count formatting, and improved stale/error indicators.

  - **Progress bars**: Replaced plain `•` bullet with Unicode block bars (`████░░░░`) in both sidebar (width 12) and footer (width 8), colored by usage threshold
  - **Tier/plan badges**: Provider tier names (e.g. `Pro`, `Max`, `Lite`) now render as `[Pro]` next to the provider label in muted color
  - **Rich reset countdowns**: Half-hour remainders now show as `1.5h`, `0.5h` instead of `1h 30m`
  - **Token count formatting**: Count-based quotas display as `(1.5K/15K)` with K/M suffixes when `current`/`total` are available
  - **Stale/error UX**: "stale" and "cached" indicators now render in warning color; error-with-previous shows "cached" instead of "stale"
  - **Updated timestamp**: Panel footer shows `Updated HH:MM` after each successful refresh

### Patch Changes

- 4303ec5: Hide providers with missing credentials from the sidebar until usage data is available.

## 1.1.0

### Minor Changes

- beaf841: Add MiniMax Token Plan provider. Surfaces rolling 5-hour and weekly quota windows in the sidebar and activates the prompt footer for `minimax-coding-plan` and `minimax` sessions. Credentials are looked up in this order: (1) the configured `authPath` JSON file, (2) OpenCode's shared `auth.json`, then (3) the provider's `apiKey` config (with `{env:...}` references).
- 8173f0e: Add Synthetic provider. Surfaces rolling 5-hour and weekly quota windows in the sidebar. Credentials are looked up in this order: (1) the configured `authPath` JSON file, (2) OpenCode's shared `auth.json`, then (3) the provider's `apiKey` config (with `{env:...}` references).

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
