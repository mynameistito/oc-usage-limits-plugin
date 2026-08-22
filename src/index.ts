import type { UsageLimitsPlugin } from "@/plugin.tsx";
import { setupUsageLimitsPlugin } from "@/plugin.tsx";

/** Local seam for the v2 Plugin.define API until the host package exposes it. */
const Plugin = {
  define: <T extends UsageLimitsPlugin>(plugin: T): T => plugin,
};

export default Plugin.define({
  id: "mynameistito.usage-limits",
  setup: setupUsageLimitsPlugin,
} satisfies UsageLimitsPlugin);
