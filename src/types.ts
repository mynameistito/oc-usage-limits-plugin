import type { Redacted } from "effect";

import type { ResetInstant, UsageQuota, UsageWindowKind } from "@/usage.ts";

/** Requested sidebar window filter, or all available windows. */
export type SidebarWindow = "all" | UsageWindowKind;

/** Requested provider footer window, or the provider's automatic choice. */
export type FooterWindow = "auto" | UsageWindowKind;

/** Resolved display settings for one provider. */
export interface ProviderDisplayConfig {
  readonly showSidebarBar: boolean;
  readonly showFooterBar: boolean;
  readonly sidebarWindow: SidebarWindow;
  readonly footerWindow: FooterWindow;
}

/** Provider adapters supported by the usage-limits plugin. */
export type ProviderID =
  | "codex"
  | "zai"
  | "synthetic"
  | "minimax"
  | "qwen"
  | "opencode-go";

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

/** Configuration fields shared by every provider. */
interface CommonProviderConfig {
  /** Whether this provider should be fetched and displayed. */
  readonly enabled?: boolean;
  /** Optional provider display label override. */
  readonly label?: string;
  readonly showSidebarBar?: boolean;
  readonly showFooterBar?: boolean;
  readonly sidebarWindow?: SidebarWindow;
  /** Preferred usage window for this provider's prompt footer. */
  readonly footerWindow?: FooterWindow;
}

/** Codex provider configuration. */
export interface CodexProviderConfig extends CommonProviderConfig {
  /** Optional path to a Codex auth file. Supports a leading `~`. */
  readonly authPath?: string;
  /** Optional API base URL override for explicitly configured auth files. */
  readonly baseUrl?: string;
  readonly apiKey?: Credential;
  readonly authorizationScheme?: "raw" | "bearer";
}

/** ZAI provider configuration. */
export interface ZaiProviderConfig extends CommonProviderConfig {
  readonly apiKey?: Credential;
  readonly authPath?: string;
  readonly authorizationScheme?: "raw" | "bearer";
}

/** Synthetic provider configuration. */
export interface SyntheticProviderConfig extends CommonProviderConfig {
  readonly apiKey?: Credential;
  readonly authPath?: string;
  readonly baseUrl?: string;
}

/** MiniMax provider configuration. */
export interface MiniMaxProviderConfig extends CommonProviderConfig {
  readonly apiKey?: Credential;
  readonly authPath?: string;
  readonly baseUrl?: string;
}

/** Qwen provider configuration. */
export type QwenProviderConfig = CommonProviderConfig;

/** OpenCode GO provider configuration. */
export interface OpenCodeGoProviderConfig extends CommonProviderConfig {
  readonly apiKey?: Credential;
  readonly authPath?: string;
  readonly baseUrl?: string;
}

/** Provider configuration indexed by literal provider ID. */
export interface ProviderConfigMap {
  readonly codex: CodexProviderConfig;
  readonly minimax: MiniMaxProviderConfig;
  readonly qwen: QwenProviderConfig;
  readonly synthetic: SyntheticProviderConfig;
  readonly zai: ZaiProviderConfig;
  readonly "opencode-go": OpenCodeGoProviderConfig;
}

/** Any provider-specific configuration. */
export type ProviderConfig = ProviderConfigMap[ProviderID];

/** Fully resolved plugin configuration returned by the config parser. */
export interface ResolvedUsageLimitsConfig {
  readonly enabled: boolean;
  readonly providers: Readonly<Partial<ProviderConfigMap>>;
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
  /** OpenCode GO credentials stored under the provider's catalog ID. */
  "opencode-go"?: {
    /** OpenCode GO API key. */
    readonly key?: Credential;
    /** OpenCode GO API key (alternate field name). */
    readonly apiKey?: Credential;
  };
  /** OpenCode Zen credentials stored under the legacy provider ID. */
  opencode?: {
    /** OpenCode API key. */
    readonly key?: Credential;
    /** OpenCode API key (alternate field name). */
    readonly apiKey?: Credential;
  };
}
