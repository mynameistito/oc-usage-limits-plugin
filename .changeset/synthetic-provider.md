---
"oc-usage-limits-plugin": minor
---

Add Synthetic provider. Surfaces rolling 5-hour and weekly quota windows in the sidebar. Credentials are looked up in this order: (1) the configured `authPath` JSON file, (2) OpenCode's shared `auth.json`, then (3) the provider's `apiKey` config (with `{env:...}` references).
