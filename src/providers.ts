import { PROVIDER_ORDER, PROVIDER_REGISTRY } from "@/providers/registry.ts";
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
  if (!(id in PROVIDER_REGISTRY)) {
    throw new Error(`unknown provider: ${id}`);
  }
  return PROVIDER_REGISTRY[id].fetch(config, openCodeAuth, timeoutMs);
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
  PROVIDER_ORDER.flatMap((id) => {
    const provider = config.providers[id];
    if (provider?.enabled !== true) {
      return [];
    }
    return [[id, provider]];
  });
