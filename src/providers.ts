import { fetchCodexUsage } from "@/providers/codex.ts";
import { fetchMiniMaxTokenPlanUsage } from "@/providers/minimax.ts";
import { fetchSyntheticUsage } from "@/providers/synthetic.ts";
import { fetchZaiCodingPlanUsage } from "@/providers/zai-coding-plan.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderID,
  ProviderUsage,
  UsageLimitsConfig,
} from "@/types.ts";

/**
 * Fetches usage data for a configured provider.
 *
 * This dispatches to the provider-specific adapter while keeping plugin refresh
 * code independent of each provider's authentication and response format.
 *
 * @param id - Provider adapter to fetch.
 * @param config - Optional provider-specific configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized provider usage data.
 */
export const fetchProvider = (
  id: ProviderID,
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  if (id === "codex") {
    return fetchCodexUsage(config, openCodeAuth, timeoutMs);
  }
  if (id === "zai") {
    return fetchZaiCodingPlanUsage(config, openCodeAuth, timeoutMs);
  }
  if (id === "synthetic") {
    return fetchSyntheticUsage(config, openCodeAuth, timeoutMs);
  }
  if (id === "minimax") {
    return fetchMiniMaxTokenPlanUsage(config, openCodeAuth, timeoutMs);
  }

  const exhaustive: never = id;
  throw new Error(`unknown provider: ${exhaustive}`);
};

/**
 * Returns enabled provider configurations in the order they should appear in UI.
 *
 * Providers are opt-in: a provider is included only when its config sets
 * `enabled: true`.
 *
 * @param config - Fully resolved plugin configuration.
 * @returns Tuples of provider IDs and their config objects.
 */
export const getProviderConfigs = (
  config: Required<UsageLimitsConfig>
): [ProviderID, ProviderConfig][] =>
  (["codex", "zai", "synthetic", "minimax"] as const).flatMap((id) => {
    const provider = config.providers[id];
    if (provider?.enabled !== true) {
      return [];
    }
    return [[id, provider]];
  });
