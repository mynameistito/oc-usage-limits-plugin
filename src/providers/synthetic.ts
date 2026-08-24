import { Effect, Redacted, Result } from "effect";

import { syntheticProviderConfigSchema } from "@/config-schema.ts";
import {
  MissingProviderCredentialsError,
  ProviderResponseDecodeError,
} from "@/errors.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import { isJsonNumber, isJsonString } from "@/providers/json.ts";
import { ProviderClock } from "@/providers/runtime/clock.ts";
import { ProviderEnvironment } from "@/providers/runtime/environment.ts";
import { ProviderFileSystem } from "@/providers/runtime/filesystem.ts";
import { ProviderHttpClient } from "@/providers/runtime/http.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import type {
  OpenCodeAuth,
  SyntheticProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import type { Percentage, QuotaCount, UsageQuota } from "@/usage.ts";
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "@/usage.ts";
import { isRecord } from "@/utils.ts";
import type { JsonObject, JsonValue } from "@/utils.ts";
import { resolveHttpsBaseUrl } from "@/utils/url.ts";

/** Default Synthetic API base URL. */
const DEFAULT_SYNTHETIC_BASE_URL = "https://api.synthetic.new";

interface SyntheticRollingLimit {
  readonly remaining?: number;
  readonly max?: number;
  readonly nextTickAt?: string;
}
interface SyntheticSubscription {
  readonly limit?: number;
  readonly requests?: number;
  readonly renewsAt?: string;
}
interface SyntheticWeeklyLimit {
  readonly percentRemaining?: number;
  readonly nextRegenAt?: string;
}
interface SyntheticPayload {
  readonly rollingFiveHourLimit?: SyntheticRollingLimit;
  readonly subscription?: SyntheticSubscription;
  readonly weeklyTokenLimit?: SyntheticWeeklyLimit;
}

const parseSyntheticRolling = (
  value: JsonValue | undefined
): SyntheticRollingLimit | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    max: isJsonNumber(value.max) ? value.max : undefined,
    nextTickAt: isJsonString(value.nextTickAt) ? value.nextTickAt : undefined,
    remaining: isJsonNumber(value.remaining) ? value.remaining : undefined,
  };
};

const parseSyntheticSubscription = (
  value: JsonValue | undefined
): SyntheticSubscription | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    limit: isJsonNumber(value.limit) ? value.limit : undefined,
    renewsAt: isJsonString(value.renewsAt) ? value.renewsAt : undefined,
    requests: isJsonNumber(value.requests) ? value.requests : undefined,
  };
};

const parseSyntheticWeekly = (
  value: JsonValue | undefined
): SyntheticWeeklyLimit | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    nextRegenAt: isJsonString(value.nextRegenAt)
      ? value.nextRegenAt
      : undefined,
    percentRemaining: isJsonNumber(value.percentRemaining)
      ? value.percentRemaining
      : undefined,
  };
};

const parseSyntheticPayload = (value: JsonObject): SyntheticPayload => ({
  rollingFiveHourLimit: parseSyntheticRolling(value.rollingFiveHourLimit),
  subscription: parseSyntheticSubscription(value.subscription),
  weeklyTokenLimit: parseSyntheticWeekly(value.weeklyTokenLimit),
});

const countQuotaWhenIntegral = (
  current: QuotaCount,
  total: QuotaCount,
  usedPercent: Percentage
): UsageQuota =>
  Number.isInteger(current) && Number.isInteger(total) && current <= total
    ? countQuota(current, total, usedPercent)
    : percentageQuota(usedPercent);

/**
 * Extracts a Synthetic API key from any supported auth object shape.
 *
 * Accepts the nested `synthetic` block used by OpenCode auth and direct key
 * fields. The provider keeps the auth payload intentionally narrow so the rest
 * of the plugin can remain provider-agnostic.
 *
 * @param value - Unknown auth payload to inspect.
 * @returns The first recognized API key.
 */
const keyFromSyntheticAuth = (
  value: JsonObject,
  credential: (
    value: JsonValue | undefined
  ) => Redacted.Redacted<string> | undefined
): Redacted.Redacted<string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const directKey = credential(value.key);
  if (directKey) {
    return directKey;
  }

  const directApiKey = credential(value.apiKey);
  if (directApiKey) {
    return directApiKey;
  }

  if (isRecord(value.synthetic)) {
    const key = credential(value.synthetic.key);
    if (key) {
      return key;
    }
    const apiKey = credential(value.synthetic.apiKey);
    if (apiKey) {
      return apiKey;
    }
  }

  return undefined;
};

/**
 * Attempts to load a Synthetic API key from a configured auth path.
 *
 * Missing or invalid files are ignored so other credential sources can still be
 * tried by the provider adapter.
 *
 * @param authPath - Optional auth file path.
 * @returns A Synthetic API key when the file exists and contains one.
 */
const readSyntheticAuthPathKey = (
  authPath: string | undefined
): Effect.Effect<
  Redacted.Redacted<string> | undefined,
  never,
  ProviderEnvironment | ProviderFileSystem
> => {
  if (!authPath) {
    return Effect.succeed<undefined>(globalThis.undefined);
  }
  return Effect.gen(function* loadSyntheticAuthPathKey() {
    const files = yield* ProviderFileSystem;
    const environment = yield* ProviderEnvironment;
    const auth = yield* files.readJson({
      path: authPath,
      providerID: "synthetic",
    });
    return isRecord(auth)
      ? keyFromSyntheticAuth(auth, environment.credential)
      : undefined;
  }).pipe(
    Effect.catchCause(() => Effect.succeed<undefined>(globalThis.undefined))
  );
};

/**
 * Builds a `Date` from a provider-reported ISO timestamp.
 *
 * @param value - ISO-8601 timestamp string reported by the provider.
 * @returns A `Date` when the input parses, otherwise `null`.
 */
const parseIsoDate = (value: string | undefined): Date | null => {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  return resetInstantOrNull(parsed);
};

/**
 * Derives the 5-hour usage window from a Synthetic quotas response.
 *
 * Prefers the v3 `rollingFiveHourLimit` shape and falls back to the legacy
 * `subscription` bucket when v3 fields are absent.
 *
 * @param payload - Parsed Synthetic quotas payload.
 * @returns A normalized 5h window, or `null` when no shape applies.
 */
const syntheticFiveHourWindow = (
  payload: SyntheticPayload
): UsageWindow | null => {
  const rolling = payload.rollingFiveHourLimit;
  if (rolling) {
    const { remaining } = rolling;
    const { max } = rolling;
    const parsedRemaining = parseUsageCount(remaining);
    const parsedMax = parseUsageCount(max);
    if (
      Result.isSuccess(parsedRemaining) &&
      Result.isSuccess(parsedMax) &&
      parsedMax.success > 0 &&
      parsedRemaining.success <= parsedMax.success
    ) {
      const parsedUsed = parseUsagePercentage(
        (1 - parsedRemaining.success / parsedMax.success) * 100
      );
      if (Result.isFailure(parsedUsed)) {
        return null;
      }
      const parsedCurrent = parseUsageCount(
        parsedMax.success - parsedRemaining.success
      );
      if (Result.isFailure(parsedCurrent)) {
        return null;
      }
      const resetsAt = parseIsoDate(rolling.nextTickAt);
      return {
        kind: "rolling",
        label: "5h",
        quota: countQuotaWhenIntegral(
          parsedCurrent.success,
          parsedMax.success,
          parsedUsed.success
        ),
        resetsAt,
      };
    }
  }

  const { subscription } = payload;
  if (subscription) {
    const { limit } = subscription;
    const { requests } = subscription;
    const parsedLimit = parseUsageCount(limit);
    const parsedRequests = parseUsageCount(requests);
    if (
      Result.isSuccess(parsedLimit) &&
      Result.isSuccess(parsedRequests) &&
      parsedLimit.success > 0 &&
      parsedRequests.success <= parsedLimit.success
    ) {
      const parsedUsed = parseUsagePercentage(
        (parsedRequests.success / parsedLimit.success) * 100
      );
      if (Result.isFailure(parsedUsed)) {
        return null;
      }
      const resetsAt = parseIsoDate(subscription.renewsAt);
      return {
        kind: "rolling",
        label: "5h",
        quota: countQuotaWhenIntegral(
          parsedRequests.success,
          parsedLimit.success,
          parsedUsed.success
        ),
        resetsAt,
      };
    }
  }

  return null;
};

/**
 * Derives the weekly usage window from a Synthetic quotas response.
 *
 * Accepts the v3 `weeklyTokenLimit` shape; returns `null` when the provider
 * did not report a weekly budget.
 *
 * @param payload - Parsed Synthetic quotas payload.
 * @returns A normalized weekly window, or `null` when not reported.
 */
const syntheticWeeklyWindow = (
  payload: SyntheticPayload
): UsageWindow | null => {
  const weekly = payload.weeklyTokenLimit;
  if (!weekly) {
    return null;
  }

  const { percentRemaining } = weekly;
  const parsedRemaining = parseUsagePercentage(percentRemaining);
  if (Result.isFailure(parsedRemaining)) {
    return null;
  }

  const parsedUsed = parseUsagePercentage(100 - parsedRemaining.success);
  if (Result.isFailure(parsedUsed)) {
    return null;
  }
  const resetsAt = parseIsoDate(weekly.nextRegenAt);
  return {
    kind: "weekly",
    label: "weekly",
    quota: percentageQuota(parsedUsed.success),
    resetsAt,
  };
};

/**
 * Fetches and normalizes Synthetic usage limits.
 *
 * Credential lookup checks, in order, the configured auth path, OpenCode auth,
 * and a configured literal or environment-backed API key.
 *
 * @param config - Optional Synthetic provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized Synthetic usage data.
 * @throws {Error} When no API key is available or the provider response is invalid.
 */
const fetchSyntheticUsageEffect = (
  config: SyntheticProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"synthetic">["fetch"]> =>
  Effect.gen(function* runFetchSyntheticUsage() {
    const environment = yield* ProviderEnvironment;
    const http = yield* ProviderHttpClient;
    const clock = yield* ProviderClock;
    const baseUrl = resolveHttpsBaseUrl(
      config?.baseUrl,
      DEFAULT_SYNTHETIC_BASE_URL
    );
    const isOfficialHost = new URL(baseUrl).hostname === "api.synthetic.new";
    const configuredKey = environment.resolveCredential(config?.apiKey);
    const configuredFileKey = yield* readSyntheticAuthPathKey(config?.authPath);
    const authKey = isRecord(openCodeAuth)
      ? keyFromSyntheticAuth(openCodeAuth, environment.credential)
      : undefined;
    const apiKey =
      configuredFileKey ??
      (isOfficialHost ? (authKey ?? configuredKey) : configuredKey);
    if (!apiKey) {
      return yield* new MissingProviderCredentialsError({
        operation: "fetch-usage",
        providerID: "synthetic",
      });
    }

    const payload = yield* http.requestJson({
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${Redacted.value(apiKey)}`,
      },
      method: "GET",
      providerID: "synthetic",
      timeoutMs,
      url: `${baseUrl}/v2/quotas`,
    });

    const parsedPayload = isRecord(payload)
      ? parseSyntheticPayload(payload)
      : null;
    if (!parsedPayload) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: "decode-response",
        providerID: "synthetic",
      });
    }

    const windows: UsageWindow[] = [];
    const fiveHour = syntheticFiveHourWindow(parsedPayload);
    if (fiveHour) {
      windows.push(fiveHour);
    }
    const weekly = syntheticWeeklyWindow(parsedPayload);
    if (weekly) {
      windows.push(weekly);
    }

    if (!fiveHour) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: "decode-response",
        providerID: "synthetic",
      });
    }

    return {
      capturedAt: yield* clock.now,
      id: "synthetic",
      label: config?.label ?? "Synthetic",
      windows,
    };
  });

/** Stable Promise export for direct consumers of the provider adapter. */
export const fetchSyntheticUsage = (
  config: SyntheticProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"synthetic">> =>
  Effect.runPromise(
    fetchSyntheticUsageEffect(config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

/** Plugin registration for the Synthetic provider adapter. */
export const syntheticProvider = {
  capabilities: { customBaseUrl: true, transport: "http" },
  configSchema: syntheticProviderConfigSchema,
  defaultLabel: "Synthetic",
  fetch: fetchSyntheticUsageEffect,
  footerWindowKind: "rolling",
  id: "synthetic",
  openCodeProviderIDs: ["synthetic"],
} as const satisfies ProviderDefinition<"synthetic">;
