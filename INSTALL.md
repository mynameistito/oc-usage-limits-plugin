# Local Install Guide

Install this OpenCode TUI plugin from a local clone instead of the npm package, so fixes and features are picked up by rebuilding instead of waiting for a release. Two scenarios are covered: replacing an existing remote (npm) install, and a fresh local-only install. Follow the steps exactly — every command includes its expected result.

## Before you start — read this context

| Fact | Why it matters |
| --- | --- |
| TUI plugins are declared in `~/.config/opencode/tui.json`, inside the `plugin` array | This is NOT `opencode.json`. Server plugins (auto-loaded `*.ts`/`*.js` files in `~/.config/opencode/plugins/`) are a different mechanism. |
| Never clone this repo inside `~/.config/opencode/plugins/` | That directory is scanned for plugin files; a full source tree there will be misinterpreted. Clone next to it instead (e.g. `~/.config/opencode/oc-usage-limits-plugin`). |
| npm TUI plugins are cached at `~/.cache/opencode/packages/<spec>@latest/` | A stale cache keeps serving the old version even after the source changes. |
| The TUI loader accepts local plugin specs: absolute paths, `./relative` paths, and `file://` URLs | This guide uses absolute paths — relative paths resolve against the TUI process cwd, which varies. |
| The TUI loads the BUILT artifact (`dist/index.mjs`), not the source | After every source change you must `bun install && bun run build`, then restart OpenCode. |
| Config is loaded once at startup | Restart OpenCode after any `tui.json` / `usage-limits.jsonc` change. Running sessions keep the old config. |
| OpenCode rejects invalid config at startup | Keep the `$schema` key in `tui.json`, do not remove unrelated plugin entries, and validate JSON after editing. |
| Bun is required | The repo is Bun-first: `bun install`, `bun test`, `bun run build`. Install Bun from <https://bun.sh> if missing. |

Clone URL (SSH): `git@github.com:uriel-loz/oc-usage-limits-plugin.git` Clone URL (HTTPS fallback): `https://github.com/uriel-loz/oc-usage-limits-plugin.git`

---

## Scenario A — Replace the remote (npm) plugin with the local build

Use this when `~/.config/opencode/tui.json` already lists `"oc-usage-limits-plugin"` (npm spec).

### Step 1 — Back up the OpenCode config

```bash
du -sh ~/.config/opencode
cp -a ~/.config/opencode ~/opencode-config-backup-$(date +%F)
du -sh ~/opencode-config-backup-$(date +%F)
```

Expected: both sizes match (e.g. `174M` twice). If they differ, stop and investigate before continuing.

### Step 2 — Clone the repo into the OpenCode config directory

```bash
git clone git@github.com:uriel-loz/oc-usage-limits-plugin.git ~/.config/opencode/oc-usage-limits-plugin
cd ~/.config/opencode/oc-usage-limits-plugin && git log --oneline -1
```

Expected: the clone succeeds and prints the latest commit (must be `aa440f8` or newer — earlier commits lack the ZAI CREDIT_LIMIT fix and the renewal lines).

### Step 3 — Install dependencies and build

```bash
cd ~/.config/opencode/oc-usage-limits-plugin
bun install
bun run build
ls -la dist/
```

Expected:

- `bun install` finishes with no errors.
- `bun run build` prints `✔ Build complete` and produces `dist/index.mjs` (+ `dist/index.d.mts`).
- Sanity check the fix is compiled in: `grep -c CREDIT_LIMIT dist/index.mjs` prints `4` or more.

### Step 4 — Replace the npm spec with the local path in tui.json

Edit `~/.config/opencode/tui.json`. Replace the string `"oc-usage-limits-plugin"` with the absolute clone path. Leave every other entry and the `$schema` key untouched.

Before:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-subagent-statusline",
    "opencode-sdd-engram-manage",
    "oc-usage-limits-plugin"
  ]
}
```

After:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-subagent-statusline",
    "opencode-sdd-engram-manage",
    "/home/<user>/.config/opencode/oc-usage-limits-plugin"
  ]
}
```

Replace `<user>` with the actual username (use `echo $USER`).

**Warning — do NOT use `opencode plugin <path> --force` to perform this replacement.** The CLI appends the local path alongside the existing npm spec instead of replacing it, and both entries load: the plugin renders twice. Manual replacement is the safe path. (Verified against OpenCode 1.18.x.)

### Step 5 — Verify the built module loads

```bash
bun -e "const m = await import('file://'$HOME'/.config/opencode/oc-usage-limits-plugin/dist/index.mjs'.replace('\$HOME', process.env.HOME)); console.log(m.default.id, typeof m.default.tui)"
```

Expected output:

```
mynameistito.usage-limits function
```

The loader contract is: default export object with an `id` string and a `tui` function. Anything else will fail to initialize.

### Step 6 — Remove the stale npm cache (optional but recommended)

```bash
rm -rf ~/.cache/opencode/packages/oc-usage-limits-plugin@latest
```

Harmless either way — the npm spec no longer appears in `tui.json`, so the cache is never read.

### Step 7 — Restart OpenCode and verify

1. Quit OpenCode completely and start it again.
2. The sidebar must render the `Usage Limits` panel with the configured providers (Codex, ZAI, OpenCode GO, ...).
3. For a ZAI data check: values must appear instead of an `invalid ZAI usage` error.
4. For a headless error check, launch once from a terminal and inspect the log:

```bash
opencode --print-logs 2>&1 | grep -i '\[tui.plugin\]'
```

Expected: no lines. Any `[tui.plugin] failed to ...` line means the local spec is wrong — re-check Step 4 and Step 5.

### Rollback (Scenario A)

- Restore the npm spec: edit `tui.json` and put `"oc-usage-limits-plugin"` back in place of the absolute path, then restart.
- Full restore: `rm -rf ~/.config/opencode && cp -a ~/opencode-config-backup-<date> ~/.config/opencode` (OpenCode must be closed first).

---

## Scenario B — Fresh local install (no previous remote plugin)

Use this when `tui.json` does not list this plugin at all (or `tui.json` does not exist yet).

### Step 1 — Back up the OpenCode config

Same as Scenario A, Step 1.

### Step 2 — Clone and build

Same as Scenario A, Steps 2-3 (clone into `~/.config/opencode/oc-usage-limits-plugin`, then `bun install && bun run build`).

### Step 3 — Register the plugin

Either run the official CLI, which appends the absolute path to the global config:

```bash
opencode plugin ~/.config/opencode/oc-usage-limits-plugin -g
```

Expected: `Added to ~/.config/opencode/tui.json` and `Detected tui target`.

Or edit `~/.config/opencode/tui.json` manually (create the file if it does not exist):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/home/<user>/.config/opencode/oc-usage-limits-plugin"]
}
```

### Step 4 — Restart and verify

Same as Scenario A, Steps 5 and 7 (module import check, restart, sidebar render, log grep).

### Rollback (Scenario B)

Remove the absolute path entry from `tui.json` (or delete a self-created `tui.json`), then restart.

---

## Keeping the local install up to date

The TUI executes `dist/index.mjs`, so pulling new source is not enough:

```bash
cd ~/.config/opencode/oc-usage-limits-plugin
git pull
bun install
bun run build
```

Then restart OpenCode.

## Usage config lives outside the plugin

Providers, labels, refresh cadence, and renewal dates are configured in `~/.config/opencode/usage-limits.jsonc` (JSONC: comments and trailing commas allowed). The owner's production config — copy it verbatim:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/mynameistito/oc-usage-limits-plugin/main/usage-limits.schema.json",
  "enabled": true,
  "refreshIntervalSeconds": 1200, // refresh usage data every 20 minutes (seconds; minimum 15)
  "providers": {
    "codex": {
      "enabled": true,
      "label": "Codex",
      "renewsOnDay": 20, // ChatGPT Plus renews on the 20th monthly
    },
    "zai": {
      "enabled": true,
      "label": "ZAI",
      "renewsAt": "2026-09-17T23:06:56", // exact instant of the current cycle (paid 2026-08-17 23:06:56)
      "renewsOnDay": 17, // after renewsAt passes, recurs on the 17th carrying 23:06:56
    },
    "opencode-go": {
      "enabled": true,
      "label": "Opencode Go", // renewal is automatic from the monthly cycle reset
    },
  },
}
```

- `refreshIntervalSeconds`: how often usage data is refetched. `1200` = 20 minutes. Minimum is `15`.
- `renewsOnDay` (1-31): recurring billing day; the plugin computes the next occurrence and clamps to short months.
- `renewsAt`: one-shot absolute instant; shown while it is in the future.
- Compose `renewsAt` + `renewsOnDay` for a zero-maintenance exact countdown: the absolute instant shows first, then the recurring day takes over carrying that instant's time of day (e.g. ZAI always renews the 17th at 23:06:56).
- OpenCode GO renewal is automatic (derived from its monthly cycle reset); no config needed.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[tui.plugin] failed to initialize tui plugin` in logs | Bad spec path or broken build | Re-check the absolute path in `tui.json`; re-run `bun run build`; run the Step 5 import check. |
| Plugin renders twice / duplicate panels | npm spec and local path both listed | Remove the `"oc-usage-limits-plugin"` npm string, keep only the path entry. |
| Changes not visible after editing source | `dist/` is stale | `bun run build`, then restart. Pulling source alone does nothing. |
| `invalid ZAI usage` in sidebar | Running a build older than `aa440f8` | Pull and rebuild; verify with `grep -c CREDIT_LIMIT dist/index.mjs`. |
| Config decode error at startup | Unknown keys in `usage-limits.jsonc` or malformed `tui.json` | Validate JSON; keep only documented keys; check `usage-limits.schema.json`. |

## Final checklist

- [ ] Backup of `~/.config/opencode` exists and sizes match.
- [ ] Clone is at commit `aa440f8` or newer, outside the `plugins/` directory.
- [ ] `dist/index.mjs` exists and `grep -c CREDIT_LIMIT dist/index.mjs` is ≥ 1.
- [ ] `tui.json` lists exactly one entry for this plugin (absolute path, no npm spec).
- [ ] `bun -e` import prints `mynameistito.usage-limits function`.
- [ ] OpenCode restarted; sidebar renders; no `[tui.plugin]` lines in logs.
