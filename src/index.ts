import { Plugin } from "@opencode-ai/plugin/tui";

import { setupUsageLimitsPlugin } from "@/plugin.tsx";

export default Plugin.define({
  id: "mynameistito.usage-limits",
  setup: setupUsageLimitsPlugin,
});
