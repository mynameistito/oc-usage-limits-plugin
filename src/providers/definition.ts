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
export interface ProviderDefinition<ID extends ProviderID = ProviderID> {
  /** Plugin provider identifier and config key. */
  id: ID;
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
