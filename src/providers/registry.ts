import { fetchCodexUsage } from "@/providers/codex.ts";
import { fetchZaiCodingPlanUsage } from "@/providers/zai-coding-plan.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderID,
  ProviderUsage,
} from "@/types.ts";

/** Fetches and normalizes usage for one provider adapter. */
type ProviderFetch = (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
) => Promise<ProviderUsage>;

/** Static metadata and adapter binding for one plugin provider. */
export interface ProviderDefinition {
  /** Default sidebar label when config.label is omitted. */
  defaultLabel: string;
  /** Provider-specific usage fetch adapter. */
  fetch: ProviderFetch;
  /**
   * OpenCode session provider IDs that map to this plugin provider for the
   * prompt footer. Empty means sidebar-only.
   */
  openCodeProviderIDs: readonly string[];
  /** Preferred usage window label for the prompt footer. */
  footerWindowLabel: string;
}

/** Sidebar display order. Add new providers here. */
export const PROVIDER_ORDER = [
  "codex",
  "zai",
] as const satisfies readonly ProviderID[];

/** Registry of supported provider adapters keyed by plugin provider ID. */
export const PROVIDER_REGISTRY: Record<ProviderID, ProviderDefinition> = {
  codex: {
    defaultLabel: "Codex",
    fetch: fetchCodexUsage,
    footerWindowLabel: "5h",
    openCodeProviderIDs: ["openai"],
  },
  zai: {
    defaultLabel: "ZAI",
    fetch: fetchZaiCodingPlanUsage,
    footerWindowLabel: "5h",
    openCodeProviderIDs: ["zai-coding-plan"],
  },
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
  for (const id of PROVIDER_ORDER) {
    if (PROVIDER_REGISTRY[id].openCodeProviderIDs.includes(openCodeID)) {
      return id;
    }
  }
  return null;
};
