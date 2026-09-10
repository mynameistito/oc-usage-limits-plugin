---
"oc-usage-limits-plugin": minor
---

Show subscription renewal date and remaining time under each provider's metrics.

- OpenCode GO now derives its renewal automatically from the monthly cycle reset.
- New optional `renewsOnDay` (recurring day of month, 1-31) and `renewsAt` (absolute ISO date) config fields let any provider display its subscription renewal line.
- Fixed OpenCode GO window reset times not rendering because ISO reset strings were not converted to dates.
