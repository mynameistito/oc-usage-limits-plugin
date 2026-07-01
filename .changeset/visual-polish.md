---
"oc-usage-limits-plugin": minor
---

Visual polish: Unicode block progress bars, tier badges, rich reset countdowns, token count formatting, and improved stale/error indicators.

- **Progress bars**: Replaced plain `•` bullet with Unicode block bars (`████░░░░`) in both sidebar (width 12) and footer (width 8), colored by usage threshold
- **Tier/plan badges**: Provider tier names (e.g. `Pro`, `Max`, `Lite`) now render as `[Pro]` next to the provider label in muted color
- **Rich reset countdowns**: Half-hour remainders now show as `1.5h`, `0.5h` instead of `1h 30m`
- **Token count formatting**: Count-based quotas display as `(1.5K/15K)` with K/M suffixes when `current`/`total` are available
- **Stale/error UX**: "stale" and "cached" indicators now render in warning color; error-with-previous shows "cached" instead of "stale"
- **Updated timestamp**: Panel footer shows `Updated HH:MM` after each successful refresh
