import type { Redacted } from "effect";

import type { ResetInstant, UsageQuota, UsageWindowKind } from "@/usage.ts";

/** Provider adapters supported by the usage-limits plugin. */
export type ProviderID = "codex" | "zai" | "synthetic" | "minimax" | "qwen";

/** Sensitive string accepted by parsed config and legacy provider boundaries. */
type Credential = Redacted.Redacted<string> | string;

/**
 * Normalized usage information for one provider quota window.
 *
 * A provider can expose multiple windows, such as a short rolling window and a
 * longer daily or monthly cap. Percentages are nullable because some providers
 * report counts without a reliable percentage.
 */
export interface UsageWindow {
  /** Stable semantic window kind independent of its display label. */
  readonly kind: UsageWindowKind;
  /** Human-readable window label displayed in the TUI. */
  readonly label: string;
  /** Explicit percentage, count, or unknown quota representation. */
  readonly quota: UsageQuota;
  /** Canonical absolute reset instant when reported by the provider. */
  readonly resetsAt: ResetInstant | null;
}

/** Normalized usage payload returned by each provider adapter. */
export interface ProviderUsage<ID extends ProviderID = ProviderID> {
  /** Provider adapter that produced the data. */
  readonly id: ID;
  /** Display label for the provider. */
  readonly label: string;
  /** Optional plan or tier name inferred from provider data. */
  readonly tierName?: string;
  /** Time at which this usage snapshot was captured. */
  readonly capturedAt: Date;
  /** Quota windows exposed by the provider. */
  readonly windows: readonly UsageWindow[];
  /** Provider-specific values useful for display or diagnostics. */
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

/** Structured provider error categories used by UI behavior. */
type ProviderErrorKind = "missing_credentials";

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
      errorKind?: ProviderErrorKind;
      message: string;
      previous?: ProviderUsage;
    };

/** Provider-specific configuration loaded from `usage-limits.jsonc`. */
export interface ProviderConfig {
  /** Whether this provider should be fetched and displayed. */
  readonly enabled?: boolean;
  /** Optional provider display label override. */
  readonly label?: string;
  /** Optional path to a provider auth file. Supports a leading `~`. */
  readonly authPath?: string;
  /** Literal API key or `{env:NAME}` reference for providers that support it. */
  readonly apiKey?: Credential;
  /** How the API key should be placed in the `Authorization` header. */
  readonly authorizationScheme?: "raw" | "bearer";
  /** Optional API base URL override, primarily for testing or compatible APIs. */
  readonly baseUrl?: string;
}

/** Fully resolved plugin configuration returned by the config parser. */
export interface ResolvedUsageLimitsConfig {
  readonly enabled: boolean;
  readonly providers: Readonly<Partial<Record<ProviderID, ProviderConfig>>>;
  readonly refreshIntervalSeconds: number;
  readonly requestTimeoutMs: number;
  readonly showErrors: boolean;
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
    readonly access?: Credential;
    /** ChatGPT account identifier required by Codex usage requests. */
    readonly accountId?: Credential;
  };
  /** ZAI Coding Plan credentials stored under OpenCode's provider ID. */
  "zai-coding-plan"?: {
    /** ZAI API key. */
    readonly key?: Credential;
  };
  /** ZAI credentials stored under the plugin's normalized provider ID. */
  zai?: {
    /** ZAI API key. */
    readonly key?: Credential;
  };
  /** Synthetic credentials stored under OpenCode's provider ID. */
  synthetic?: {
    /** Synthetic API key. */
    readonly key?: Credential;
    /** Synthetic API key (alternate field name). */
    readonly apiKey?: Credential;
  };
  /** MiniMax Token Plan credentials stored under the plugin's provider ID. */
  minimax?: {
    /** MiniMax Token Plan subscription key. */
    readonly key?: Credential;
    /** MiniMax Token Plan subscription key (alternate field name). */
    readonly apiKey?: Credential;
  };
  /** MiniMax Token Plan credentials stored under the OpenCode convention ID. */
  "minimax-coding-plan"?: {
    /** MiniMax Token Plan subscription key. */
    readonly key?: Credential;
    /** MiniMax Token Plan subscription key (alternate field name). */
    readonly apiKey?: Credential;
  };
  /** MiniMax Token Plan credentials stored under an alternate OpenCode ID. */
  "minimax-token-plan"?: {
    /** MiniMax Token Plan subscription key. */
    readonly key?: Credential;
    /** MiniMax Token Plan subscription key (alternate field name). */
    readonly apiKey?: Credential;
  };
}
