import { codexProvider } from "@/providers/codex.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import { minimaxProvider } from "@/providers/minimax.ts";
import { qwenProvider } from "@/providers/qwen.ts";
import { syntheticProvider } from "@/providers/synthetic.ts";
import { zaiProvider } from "@/providers/zai-coding-plan.ts";
import type { ProviderID } from "@/types.ts";

type ProviderRegistry = {
  readonly [ID in ProviderID]: ProviderDefinition<ID>;
};

/**
 * Sidebar display order for supported providers.
 *
 * Adding a provider requires updating `ProviderID`, this order, and
 * `PROVIDER_REGISTRY` alongside the provider adapter export.
 */
export const PROVIDER_ORDER = [
  "codex",
  "zai",
  "synthetic",
  "minimax",
  "qwen",
] as const satisfies readonly ProviderID[];

/** Registry of supported provider adapters keyed by plugin provider ID. */
export const PROVIDER_REGISTRY: ProviderRegistry = {
  codex: codexProvider,
  minimax: minimaxProvider,
  qwen: qwenProvider,
  synthetic: syntheticProvider,
  zai: zaiProvider,
};

/** Provider definitions projected in explicit sidebar display order. */
export const PROVIDERS = PROVIDER_ORDER.map((id) => PROVIDER_REGISTRY[id]);

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
