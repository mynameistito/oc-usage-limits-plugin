import type { Effect, Schema } from "effect";

import type { ProviderError } from "@/errors.ts";
import type { ProviderRuntime } from "@/providers/runtime/index.ts";
import type {
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderID,
  ProviderUsage,
} from "@/types.ts";
import type { UsageWindowKind } from "@/usage.ts";

/** Fetches and normalizes usage for one provider adapter. */
type ProviderFetch<ID extends ProviderID> = (
  config: ProviderConfigMap[ID] | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
) => Effect.Effect<ProviderUsage<ID>, ProviderError, ProviderRuntime>;

/** Provider runtime capabilities declared for registry introspection. */
interface ProviderCapabilities {
  readonly customBaseUrl: boolean;
  readonly transport: "command" | "http";
}

/** Static metadata and adapter binding for one plugin provider. */
export interface ProviderDefinition<ID extends ProviderID = ProviderID> {
  /** Plugin provider identifier and config key. */
  id: ID;
  /** Default sidebar label when config.label is omitted. */
  defaultLabel: string;
  /** Schema for this provider's supported configuration fields. */
  configSchema: Schema.Schema<ProviderConfigMap[ID]>;
  /** Runtime behavior supported by this adapter. */
  capabilities: ProviderCapabilities;
  /** Provider-specific usage fetch adapter. */
  fetch: ProviderFetch<ID>;
  /**
   * OpenCode session provider IDs that map to this plugin provider for the
   * prompt footer. Empty means sidebar-only.
   */
  openCodeProviderIDs: readonly string[];
  /** Preferred stable usage-window kind for the prompt footer. */
  footerWindowKind: UsageWindowKind;
}
