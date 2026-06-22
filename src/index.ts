import type { TuiPluginModule } from "@opencode-ai/plugin/tui";

import { tui } from "@/plugin.tsx";

/** OpenCode plugin module exported for the `oc-usage-limits-plugin/tui` entry. */
export default {
  id: "mynameistito.usage-limits",
  tui,
} satisfies TuiPluginModule & { id: string };
