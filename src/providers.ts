import { Effect } from "effect";

import type { ProviderError } from "@/errors.ts";
import { codexProvider } from "@/providers/codex.ts";
import { PROVIDER_ORDER } from "@/providers/index.ts";
import { minimaxProvider } from "@/providers/minimax.ts";
import { openCodeGoProvider } from "@/providers/opencode-go.ts";
import { qwenProvider } from "@/providers/qwen.ts";
import type { ProviderRuntime } from "@/providers/runtime/index.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import { syntheticProvider } from "@/providers/synthetic.ts";
import { zaiProvider } from "@/providers/zai-coding-plan.ts";
import type {
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderID,
  ProviderUsage,
  ResolvedUsageLimitsConfig,
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
export const fetchProviderEffect = <ID extends ProviderID>(
  id: ID,
  config: ProviderConfigMap[ID] | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime> => {
  switch (id) {
    case "codex": {
      // SAFETY: The generic ID binds config to the matching ProviderConfigMap entry.
      return codexProvider.fetch(
        config as ProviderConfigMap["codex"] | undefined,
        openCodeAuth,
        timeoutMs
      ) as Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;
    }
    case "minimax": {
      // SAFETY: The generic ID binds config to the matching ProviderConfigMap entry.
      return minimaxProvider.fetch(
        config as ProviderConfigMap["minimax"] | undefined,
        openCodeAuth,
        timeoutMs
      ) as Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;
    }
    case "opencode-go": {
      // SAFETY: The discriminated ID selects the matching provider definition.
      return openCodeGoProvider.fetch(
        config,
        openCodeAuth,
        timeoutMs
      ) as Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;
    }
    case "qwen": {
      // SAFETY: The discriminated ID selects the matching provider definition.
      return qwenProvider.fetch(
        config,
        openCodeAuth,
        timeoutMs
      ) as Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;
    }
    case "synthetic": {
      // SAFETY: The generic ID binds config to the matching ProviderConfigMap entry.
      return syntheticProvider.fetch(
        config as ProviderConfigMap["synthetic"] | undefined,
        openCodeAuth,
        timeoutMs
      ) as Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;
    }
    case "zai": {
      // SAFETY: The generic ID binds config to the matching ProviderConfigMap entry.
      return zaiProvider.fetch(
        config as ProviderConfigMap["zai"] | undefined,
        openCodeAuth,
        timeoutMs
      ) as Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;
    }
    default: {
      throw new Error(`unknown provider: ${id}`);
    }
  }
};

/** Stable Promise export for direct consumers of the provider dispatcher. */
export const fetchProvider = <ID extends ProviderID>(
  id: ID,
  config: ProviderConfigMap[ID] | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<ID>> =>
  Effect.runPromise(
    fetchProviderEffect(id, config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

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
  config: ResolvedUsageLimitsConfig
): [ProviderID, ProviderConfigMap[ProviderID]][] =>
  PROVIDER_ORDER.flatMap((id) => {
    const provider = config.providers[id];
    if (provider?.enabled !== true) {
      return [];
    }
    return [[id, provider]];
  });
