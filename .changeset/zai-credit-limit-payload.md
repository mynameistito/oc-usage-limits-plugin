---
"oc-usage-limits-plugin": patch
---

Fix ZAI provider failing with "invalid ZAI usage" after ZAI moved its quota API to CREDIT_LIMIT entries.

- Parse `CREDIT_LIMIT` limit entries into count-based usage windows: `unit: 3` becomes the 5h rolling window and `unit: 6` the weekly window; unknown units degrade to a generic credits window.
- Read the plan tier from the explicit `data.level` field (e.g. `"lite"` -> `"Lite"`), falling back to the previous prompt-total inference when absent.
- Prefer reported counts (`currentValue`, `usage`) and derive the used percentage from them when `percentage` is missing.
- Legacy `TOKENS_LIMIT` / `TIME_LIMIT` payload shapes remain supported.
