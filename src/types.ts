/** Provider adapters supported by the usage-limits plugin. */
export type ProviderID =
  | "codex"
  | "zai"
  | "synthetic"
  | "minimax"
  | "neuralwatt";

/**
 * Normalized usage information for one provider quota window.
 *
 * A provider can expose multiple windows, such as a short rolling window and a
 * longer daily or monthly cap. Percentages are nullable because some providers
 * report counts without a reliable percentage.
 */
export interface UsageWindow {
  /** Human-readable window label displayed in the TUI. */
  label: string;
  /** Percentage of the quota already consumed, clamped to `0..100`. */
  usedPercent: number | null;
  /** Percentage of quota remaining, or `null` when usage is unknown. */
  remainingPercent: number | null;
  /** Absolute reset time when reported by the provider. */
  resetsAt: Date | null;
  /** Seconds until reset when reported or derivable, otherwise `null`. */
  resetAfterSeconds: number | null;
  /** Current consumed count for count-based quotas. */
  current?: number;
  /** Total available count for count-based quotas. */
  total?: number;
}

/** Normalized usage payload returned by each provider adapter. */
export interface ProviderUsage {
  /** Provider adapter that produced the data. */
  id: ProviderID;
  /** Display label for the provider. */
  label: string;
  /** Optional plan or tier name inferred from provider data. */
  tierName?: string;
  /** Time at which this usage snapshot was captured. */
  capturedAt: Date;
  /** Quota windows exposed by the provider. */
  windows: UsageWindow[];
  /** Provider-specific values useful for display or diagnostics. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * UI state for a provider across refresh cycles.
 *
 * Error states may carry a previous successful usage payload so the UI can keep
 * showing stale usage while surfacing the fetch error.
 */
export type ProviderState =
  | { id: ProviderID; label: string; status: "disabled" }
  | { id: ProviderID; label: string; status: "loading" }
  | {
      id: ProviderID;
      label: string;
      status: "ready";
      data: ProviderUsage;
      stale: boolean;
    }
  | {
      id: ProviderID;
      label: string;
      status: "error";
      message: string;
      previous?: ProviderUsage;
    };

/** Provider-specific configuration loaded from `usage-limits.jsonc`. */
export interface ProviderConfig {
  /** Whether this provider should be fetched and displayed. */
  enabled?: boolean;
  /** Optional provider display label override. */
  label?: string;
  /** Optional path to a provider auth file. Supports a leading `~`. */
  authPath?: string;
  /** Literal API key or `{env:NAME}` reference for providers that support it. */
  apiKey?: string;
  /** How the API key should be placed in the `Authorization` header. */
  authorizationScheme?: "raw" | "bearer";
  /** Optional API base URL override, primarily for testing or compatible APIs. */
  baseUrl?: string;
}

/** Top-level usage-limits plugin configuration. */
export interface UsageLimitsConfig {
  /** Enables or disables the entire plugin. Defaults to `true`. */
  enabled?: boolean;
  /** Provider refresh cadence in seconds. Defaults to `60`. */
  refreshIntervalSeconds?: number;
  /** HTTP request timeout in milliseconds. Defaults to `10000`. */
  requestTimeoutMs?: number;
  /** Whether provider fetch errors should be rendered in the sidebar. */
  showErrors?: boolean;
  /** Per-provider configuration keyed by plugin provider ID. */
  providers?: Partial<Record<ProviderID, ProviderConfig>>;
}

/**
 * Subset of OpenCode's auth file consumed by this plugin.
 *
 * Provider adapters tolerate missing fields and may fall back to provider-owned
 * auth files or explicit configuration values.
 */
export interface OpenCodeAuth {
  /** OpenAI/Codex credentials stored by OpenCode. */
  openai?: {
    /** Bearer access token for ChatGPT backend requests. */
    access?: string;
    /** ChatGPT account identifier required by Codex usage requests. */
    accountId?: string;
  };
  /** ZAI Coding Plan credentials stored under OpenCode's provider ID. */
  "zai-coding-plan"?: {
    /** ZAI API key. */
    key?: string;
  };
  /** ZAI credentials stored under the plugin's normalized provider ID. */
  zai?: {
    /** ZAI API key. */
    key?: string;
  };
  /** Synthetic credentials stored under OpenCode's provider ID. */
  synthetic?: {
    /** Synthetic API key. */
    key?: string;
    /** Synthetic API key (alternate field name). */
    apiKey?: string;
  };
  /** MiniMax Token Plan credentials stored under the plugin's provider ID. */
  minimax?: {
    /** MiniMax Token Plan subscription key. */
    key?: string;
    /** MiniMax Token Plan subscription key (alternate field name). */
    apiKey?: string;
  };
  /** MiniMax Token Plan credentials stored under the OpenCode convention ID. */
  "minimax-coding-plan"?: {
    /** MiniMax Token Plan subscription key. */
    key?: string;
    /** MiniMax Token Plan subscription key (alternate field name). */
    apiKey?: string;
  };
  /** MiniMax Token Plan credentials stored under an alternate OpenCode ID. */
  "minimax-token-plan"?: {
    /** MiniMax Token Plan subscription key. */
    key?: string;
    /** MiniMax Token Plan subscription key (alternate field name). */
    apiKey?: string;
  };
  /** NeuralWatt credentials stored under the plugin's provider ID. */
  neuralwatt?: {
    /** NeuralWatt API key. */
    apiKey?: string;
  };
}
