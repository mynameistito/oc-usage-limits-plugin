import { Effect, Redacted, Result } from "effect";

import { codexProviderConfigSchema } from "@/config-schema.ts";
import {
  MissingProviderCredentialsError,
  ProviderResponseDecodeError,
} from "@/errors.ts";
import type { ProviderTransportError } from "@/errors.ts";
import { limitLabelForWindow } from "@/format.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import { isJsonNumber, isJsonString } from "@/providers/json.ts";
import { ProviderClock } from "@/providers/runtime/clock.ts";
import { ProviderEnvironment } from "@/providers/runtime/environment.ts";
import { ProviderFileSystem } from "@/providers/runtime/filesystem.ts";
import { ProviderHttpClient } from "@/providers/runtime/http.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import type {
  OpenCodeAuth,
  CodexProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import {
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "@/usage.ts";
import type { JsonObject, JsonValue } from "@/utils.ts";
import { isRecord } from "@/utils.ts";
import { resolveHttpsBaseUrl } from "@/utils/url.ts";

/** Default ChatGPT backend base URL used for Codex usage requests. */
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

interface CodexRateLimitWindow {
  readonly used_percent?: number;
  readonly limit_window_seconds?: number;
  readonly reset_at?: number;
}

interface CodexRateLimit {
  readonly primary_window?: CodexRateLimitWindow;
  readonly secondary_window?: CodexRateLimitWindow;
}

interface CodexPayload {
  readonly rate_limit?: CodexRateLimit;
  readonly rate_limit_reset_credits?: { readonly available_count?: number };
  readonly plan_type?: string;
}

interface CodexAuthPayload {
  readonly tokens: {
    readonly access_token?: JsonValue;
    readonly account_id?: JsonValue;
  };
}

const parseCodexAuth = (value: JsonObject): CodexAuthPayload | null => {
  if (!isRecord(value.tokens)) {
    return null;
  }
  return {
    tokens: {
      access_token: value.tokens.access_token,
      account_id: value.tokens.account_id,
    },
  };
};

const parseCodexWindow = (window: JsonObject): CodexRateLimitWindow | null => {
  if (window.used_percent !== undefined && !isJsonNumber(window.used_percent)) {
    return null;
  }
  return {
    limit_window_seconds: isJsonNumber(window.limit_window_seconds)
      ? window.limit_window_seconds
      : undefined,
    reset_at: isJsonNumber(window.reset_at) ? window.reset_at : undefined,
    used_percent: isJsonNumber(window.used_percent)
      ? window.used_percent
      : undefined,
  };
};

const parseCodexPayload = (value: JsonObject): CodexPayload => {
  const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : undefined;
  return {
    plan_type: isJsonString(value.plan_type) ? value.plan_type : undefined,
    rate_limit: rateLimit
      ? {
          primary_window: isRecord(rateLimit.primary_window)
            ? (parseCodexWindow(rateLimit.primary_window) ?? undefined)
            : undefined,
          secondary_window: isRecord(rateLimit.secondary_window)
            ? (parseCodexWindow(rateLimit.secondary_window) ?? undefined)
            : undefined,
        }
      : undefined,
    rate_limit_reset_credits:
      isRecord(value.rate_limit_reset_credits) &&
      isJsonNumber(value.rate_limit_reset_credits.available_count)
        ? { available_count: value.rate_limit_reset_credits.available_count }
        : undefined,
  };
};

const resetCreditsFromPayload = (payload: CodexPayload): number | null => {
  const credits = payload.rate_limit_reset_credits;
  const availableCount = credits?.available_count;
  return availableCount !== undefined &&
    Number.isFinite(availableCount) &&
    availableCount >= 0
    ? availableCount
    : null;
};

/**
 * Reads Codex credentials from the Codex CLI auth file.
 *
 * @param authPath - Optional path override. Defaults to `~/.codex/auth.json`.
 * @returns Access token and ChatGPT account ID required by the Codex usage API.
 * @throws {Error} When the auth file is missing or does not contain credentials.
 * @throws {TypeError} When the auth file contains credentials with invalid types.
 */
const readCodexAuthFile = (
  authPath: string | undefined
): Effect.Effect<
  {
    readonly access: Redacted.Redacted<string>;
    readonly accountId: Redacted.Redacted<string>;
  },
  | MissingProviderCredentialsError
  | ProviderResponseDecodeError
  | ProviderTransportError,
  ProviderEnvironment | ProviderFileSystem
> =>
  Effect.gen(function* loadCodexAuthFile() {
    const files = yield* ProviderFileSystem;
    const environment = yield* ProviderEnvironment;
    const auth = yield* files.readJson({
      path: authPath ?? "~/.codex/auth.json",
      providerID: "codex",
    });
    const parsedAuth = isRecord(auth) ? parseCodexAuth(auth) : null;
    if (!parsedAuth) {
      return yield* new MissingProviderCredentialsError({
        operation: "read-auth",
        providerID: "codex",
      });
    }
    const access = environment.credential(parsedAuth.tokens.access_token);
    const accountId = environment.credential(parsedAuth.tokens.account_id);
    if (!access || !accountId) {
      return yield* new MissingProviderCredentialsError({
        operation: "read-auth",
        providerID: "codex",
      });
    }
    return { access, accountId };
  });

const loadCodexCredentials = (
  config: CodexProviderConfig | undefined,
  isOfficialHost: boolean,
  openCodeAccess: Redacted.Redacted<string> | undefined,
  openCodeAccountId: Redacted.Redacted<string> | undefined,
  configuredAccess: Redacted.Redacted<string> | undefined
) =>
  Effect.gen(function* loadCredentials() {
    if (!isOfficialHost && !config?.authPath && !configuredAccess) {
      return yield* new MissingProviderCredentialsError({
        operation: "fetch-usage",
        providerID: "codex",
      });
    }
    if (isOfficialHost && openCodeAccess && openCodeAccountId) {
      return { access: openCodeAccess, accountId: openCodeAccountId };
    }
    if (config?.authPath) {
      return yield* readCodexAuthFile(config.authPath);
    }
    if (configuredAccess) {
      return {
        access: configuredAccess,
        accountId: isOfficialHost
          ? (openCodeAccountId ?? Redacted.make("configured"))
          : Redacted.make("configured"),
      };
    }
    return yield* readCodexAuthFile(globalThis.undefined);
  });

/**
 * Converts a raw Codex rate-limit window into the plugin's normalized shape.
 *
 * @param value - Unknown `primary_window` or `secondary_window` payload.
 * @param fallback - Label used when the provider does not report a known window
 *   length.
 * @returns A normalized usage window, or `null` for invalid payloads.
 */
const codexWindow = (
  value: CodexRateLimitWindow | undefined,
  fallback: string
): UsageWindow | null => {
  if (!value) {
    return null;
  }

  const parsedUsed = parseUsagePercentage(value.used_percent);
  if (value.used_percent !== undefined && Result.isFailure(parsedUsed)) {
    return null;
  }
  const used = Result.isSuccess(parsedUsed) ? parsedUsed.success : null;
  const windowSeconds = value.limit_window_seconds ?? 0;
  const resetAt = resetInstantOrNull(
    value.reset_at !== undefined && value.reset_at > 0
      ? new Date(value.reset_at * 1000)
      : null
  );

  return {
    kind: windowSeconds > 0 ? "rolling" : "other",
    label:
      windowSeconds > 0
        ? limitLabelForWindow(windowSeconds, fallback)
        : fallback,
    quota: used === null ? unknownQuota : percentageQuota(used),
    resetsAt: resetAt,
  };
};

const reportedWindowsAreInvalid = (
  rateLimit: CodexRateLimit | undefined,
  windows: readonly UsageWindow[]
): boolean =>
  rateLimit !== undefined &&
  (rateLimit.primary_window !== undefined ||
    rateLimit.secondary_window !== undefined) &&
  windows.length === 0;

/**
 * Fetches and normalizes Codex usage limits.
 *
 * Credentials are read from OpenCode auth when available, otherwise from the
 * Codex CLI auth file. The returned windows represent the primary and secondary
 * Codex rate-limit windows reported by ChatGPT's backend API.
 *
 * @param config - Optional Codex provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized Codex usage data.
 * @throws {Error} When credentials are missing or the provider response is invalid.
 */
const fetchCodexUsageEffect = (
  config: CodexProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"codex">["fetch"]> =>
  Effect.gen(function* runFetchCodexUsage() {
    const environment = yield* ProviderEnvironment;
    const http = yield* ProviderHttpClient;
    const clock = yield* ProviderClock;
    const baseUrl = resolveHttpsBaseUrl(
      config?.baseUrl,
      DEFAULT_CODEX_BASE_URL
    );
    const isOfficialHost = new URL(baseUrl).hostname === "chatgpt.com";
    const openCodeAccess = environment.credential(openCodeAuth.openai?.access);
    const openCodeAccountId = environment.credential(
      openCodeAuth.openai?.accountId
    );
    const configuredAccess = environment.resolveCredential(config?.apiKey);
    const credentials = yield* loadCodexCredentials(
      config,
      isOfficialHost,
      openCodeAccess,
      openCodeAccountId,
      configuredAccess
    );

    const payload = yield* http.requestJson({
      headers: {
        Authorization: `Bearer ${Redacted.value(credentials.access)}`,
        "ChatGPT-Account-Id": Redacted.value(credentials.accountId),
        "User-Agent": "opencode-usage-limits",
      },
      method: "GET",
      providerID: "codex",
      timeoutMs,
      url: `${baseUrl}/wham/usage`,
    });

    const parsedPayload = isRecord(payload) ? parseCodexPayload(payload) : null;
    if (!parsedPayload) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: "decode-response",
        providerID: "codex",
      });
    }

    const rateLimit = parsedPayload.rate_limit;
    const primaryWindow = codexWindow(rateLimit?.primary_window, "usage");
    const windows = [
      primaryWindow,
      codexWindow(rateLimit?.secondary_window, "secondary"),
    ].filter((item): item is UsageWindow => item !== null);
    if (!primaryWindow || reportedWindowsAreInvalid(rateLimit, windows)) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: "decode-response",
        providerID: "codex",
      });
    }
    const resetCredits = resetCreditsFromPayload(parsedPayload);

    return {
      capturedAt: yield* clock.now,
      id: "codex",
      label: config?.label ?? "Codex",
      metadata: { resetCredits },
      tierName: parsedPayload.plan_type,
      windows,
    };
  });

/** Stable Promise export for direct consumers of the provider adapter. */
export const fetchCodexUsage = (
  config: CodexProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"codex">> =>
  Effect.runPromise(
    fetchCodexUsageEffect(config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

/** Plugin registration for the Codex provider adapter. */
export const codexProvider = {
  capabilities: { customBaseUrl: true, transport: "http" },
  configSchema: codexProviderConfigSchema,
  defaultLabel: "Codex",
  fetch: fetchCodexUsageEffect,
  footerWindowKind: "rolling",
  id: "codex",
  openCodeProviderIDs: ["openai"],
} as const satisfies ProviderDefinition<"codex">;
