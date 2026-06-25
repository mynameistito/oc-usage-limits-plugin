import { codexProvider } from "@/providers/codex.ts";
import { minimaxProvider } from "@/providers/minimax.ts";
import { syntheticProvider } from "@/providers/synthetic.ts";
import { zaiProvider } from "@/providers/zai-coding-plan.ts";
import type { ProviderID } from "@/types.ts";

/**
 * Registered providers in sidebar display order.
 *
 * Add new providers here: import the provider export and append it to this array.
 */
export const PROVIDERS = [
  codexProvider,
  zaiProvider,
  syntheticProvider,
  minimaxProvider,
] as const;

/** Sidebar display order derived from {@link PROVIDERS}. */
export const PROVIDER_ORDER = PROVIDERS.map(
  (provider) => provider.id
) as readonly ProviderID[];

/** Registry of supported provider adapters keyed by plugin provider ID. */
export const PROVIDER_REGISTRY = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider])
) as {
  [K in ProviderID]: Extract<(typeof PROVIDERS)[number], { id: K }>;
};

/**
 * Returns the default display label for a provider ID.
 *
 * @param id - Plugin provider identifier.
 * @returns The canonical display label for the provider.
 */
export const defaultLabelFor = (id: ProviderID): string =>
  PROVIDER_REGISTRY[id].defaultLabel;

/**
 * Maps an OpenCode session provider ID to a plugin provider ID.
 *
 * @param openCodeID - OpenCode provider identifier from the active session.
 * @returns The matching plugin provider ID, or `null` when unmapped.
 */
export const pluginProviderForOpenCode = (
  openCodeID: string
): ProviderID | null => {
  for (const provider of PROVIDERS) {
    if (provider.openCodeProviderIDs.some((id) => id === openCodeID)) {
      return provider.id;
    }
  }
  return null;
};
