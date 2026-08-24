import { Effect, Redacted, Result } from "effect";

import { zaiProviderConfigSchema } from "@/config-schema.ts";
import {
  MissingProviderCredentialsError,
  ProviderResponseDecodeError,
} from "@/errors.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import { ProviderClock } from "@/providers/runtime/clock.ts";
import { ProviderEnvironment } from "@/providers/runtime/environment.ts";
import { ProviderFileSystem } from "@/providers/runtime/filesystem.ts";
import { ProviderHttpClient } from "@/providers/runtime/http.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import type {
  OpenCodeAuth,
  ZaiProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "@/usage.ts";
import { isRecord } from "@/utils.ts";
import type { JsonValue } from "@/utils.ts";

/** ZAI Coding Plan quota endpoint used to fetch usage limits. */
const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const DECODE_RESPONSE = "decode-response";
type CredentialInput = JsonValue | Redacted.Redacted<string> | undefined;

type ZaiLimit = Readonly<Record<string, JsonValue>>;

interface ZaiLimitResult {
  readonly promptTotal: number | null;
  readonly window: UsageWindow | null;
}
interface ZaiLimitsResult {
  readonly promptTotal: number | null;
  readonly windows: UsageWindow[];
}

/**
 * Infers the ZAI plan tier from the provider's prompt/time quota total.
 *
 * @param total - Total quota reported by the ZAI time-limit payload.
 * @returns The inferred tier name, or `undefined` when it cannot be inferred.
 */
const inferZaiTier = (total: number | null): string | undefined => {
  if (total === null) {
    return undefined;
  }
  if (total >= 1400) {
    return "Max";
  }
  if (total >= 300) {
    return "Pro";
  }
  if (total > 0) {
    return "Lite";
  }
  return undefined;
};

const zaiQuota = (
  current: number | undefined,
  total: number | undefined,
  usedPercent: number | null
) => {
  const parsedUsed = parseUsagePercentage(usedPercent);
  if (Result.isFailure(parsedUsed)) {
    return unknownQuota;
  }
  const parsedCurrent = parseUsageCount(current);
  const parsedTotal = parseUsageCount(total);
  if (
    Result.isSuccess(parsedCurrent) &&
    Result.isSuccess(parsedTotal) &&
    parsedCurrent.success <= parsedTotal.success
  ) {
    return countQuota(
      parsedCurrent.success,
      parsedTotal.success,
      parsedUsed.success
    );
  }
  return percentageQuota(parsedUsed.success);
};

/**
 * Extracts a ZAI API key from any supported auth object shape.
 *
 * The plugin accepts both direct `{ key }`/`{ apiKey }` objects and the nested
 * shapes used by OpenCode auth.
 *
 * @param value - Unknown auth payload to inspect.
 * @returns The first recognized API key.
 */
const keyFromZaiAuth = (
  value: OpenCodeAuth | JsonValue,
  credential: (value: CredentialInput) => Redacted.Redacted<string> | undefined
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

  const zaiCodingPlan = value["zai-coding-plan"];
  if (isRecord(zaiCodingPlan)) {
    const key = credential(zaiCodingPlan.key);
    if (key) {
      return key;
    }
  }

  if (isRecord(value.zai)) {
    return credential(value.zai.key);
  }

  return undefined;
};

/**
 * Attempts to load a ZAI API key from a configured auth path.
 *
 * Missing or invalid files are ignored so other credential sources can still be
 * tried by the provider adapter.
 *
 * @param authPath - Optional auth file path.
 * @returns A ZAI API key when the file exists and contains one.
 */
const readZaiAuthPathKey = (
  authPath: string | undefined
): Effect.Effect<
  Redacted.Redacted<string> | undefined,
  never,
  ProviderEnvironment | ProviderFileSystem
> => {
  if (!authPath) {
    return Effect.succeed<undefined>(globalThis.undefined);
  }
  return Effect.gen(function* loadZaiAuthPathKey() {
    const files = yield* ProviderFileSystem;
    const environment = yield* ProviderEnvironment;
    const auth = yield* files.readJson({ path: authPath, providerID: "zai" });
    return keyFromZaiAuth(auth, environment.credential);
  }).pipe(
    Effect.catchCause(() => Effect.succeed<undefined>(globalThis.undefined))
  );
};

/**
 * Converts one raw ZAI limit entry into a normalized usage window.
 *
 * Token limits become the primary `5h` quota window. Time limits are not shown
 * but still expose the total prompt quota used to infer the user's ZAI tier.
 *
 * @param limit - Raw limit object from the ZAI quota API.
 * @returns The normalized window plus any prompt total discovered on the entry.
 */
const zaiWindowFromLimit = (limit: ZaiLimit): ZaiLimitResult => {
  const parsedUsed = parseUsagePercentage(limit.percentage);
  const usedPercent = Result.isSuccess(parsedUsed) ? parsedUsed.success : null;
  const resetsAt = resetInstantOrNull(
    Number.isFinite(Number(limit.nextResetTime))
      ? new Date(Number(limit.nextResetTime))
      : null
  );
  const usageTotal = Number.isFinite(Number(limit.usage))
    ? Number(limit.usage)
    : undefined;

  if (limit.type === "TOKENS_LIMIT") {
    const rawCurrentValue = Number.isFinite(Number(limit.currentValue))
      ? Number(limit.currentValue)
      : undefined;
    const currentValue =
      rawCurrentValue === undefined ? undefined : Math.round(rawCurrentValue);
    const computedTotal =
      rawCurrentValue === undefined || usedPercent === null || usedPercent <= 0
        ? undefined
        : Math.round(rawCurrentValue / (usedPercent / 100));
    return {
      promptTotal: null,
      window: {
        kind: "rolling",
        label: "5h",
        quota: zaiQuota(currentValue, computedTotal, usedPercent),
        resetsAt,
      },
    };
  }

  if (limit.type === "TIME_LIMIT") {
    return {
      promptTotal: usageTotal ?? null,
      window: null,
    };
  }

  return { promptTotal: null, window: null };
};

const parseZaiLimits = (limits: readonly unknown[]): ZaiLimitsResult => {
  const windows: UsageWindow[] = [];
  let promptTotal: number | null = null;
  let sawTokenLimit = false;

  for (const limit of limits) {
    if (!isRecord(limit)) {
      continue;
    }

    const usage = zaiWindowFromLimit(limit);
    if (limit.type === "TOKENS_LIMIT") {
      sawTokenLimit = true;
    }
    if (usage.window) {
      windows.push(usage.window);
    }
    if (usage.promptTotal !== null) {
      ({ promptTotal } = usage);
    }
  }

  if (
    sawTokenLimit &&
    windows.every((window) => window.quota._tag === "Unknown")
  ) {
    throw new Error("invalid ZAI usage");
  }

  return { promptTotal, windows };
};

/**
 * Fetches and normalizes ZAI Coding Plan usage limits.
 *
 * Credential lookup checks, in order, the configured auth path, OpenCode auth,
 * and a configured literal or environment-backed API key.
 *
 * @param config - Optional ZAI provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized ZAI usage data.
 * @throws {Error} When no API key is available or the provider response is invalid.
 */
const fetchZaiCodingPlanUsageEffect = (
  config: ZaiProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"zai">["fetch"]> =>
  Effect.gen(function* runFetchZaiCodingPlanUsage() {
    const environment = yield* ProviderEnvironment;
    const http = yield* ProviderHttpClient;
    const clock = yield* ProviderClock;
    const apiKey =
      (yield* readZaiAuthPathKey(config?.authPath)) ??
      keyFromZaiAuth(openCodeAuth, environment.credential) ??
      environment.resolveCredential(config?.apiKey);
    if (!apiKey) {
      return yield* new MissingProviderCredentialsError({
        operation: "fetch-usage",
        providerID: "zai",
      });
    }

    const scheme = config?.authorizationScheme ?? "raw";
    const rawKey = Redacted.value(apiKey);
    const payload = yield* http.requestJson({
      headers: {
        "Accept-Language": "en-US,en",
        Authorization: scheme === "bearer" ? `Bearer ${rawKey}` : rawKey,
        "Content-Type": "application/json",
      },
      method: "GET",
      providerID: "zai",
      timeoutMs,
      url: ZAI_QUOTA_URL,
    });

    if (
      !isRecord(payload) ||
      !isRecord(payload.data) ||
      !Array.isArray(payload.data.limits)
    ) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: "zai",
      });
    }

    const { limits } = payload.data;
    const parsed = yield* Effect.try({
      catch: () =>
        new ProviderResponseDecodeError({
          cause: "schema",
          operation: DECODE_RESPONSE,
          providerID: "zai",
        }),
      try: () => parseZaiLimits(limits),
    });
    const { promptTotal, windows } = parsed;
    if (!windows.some((window) => window.kind === "rolling")) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: "zai",
      });
    }

    return {
      capturedAt: yield* clock.now,
      id: "zai",
      label: config?.label ?? "ZAI",
      tierName: inferZaiTier(promptTotal),
      windows,
    };
  });

/** Stable Promise export for direct consumers of the provider adapter. */
export const fetchZaiCodingPlanUsage = (
  config: ZaiProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"zai">> =>
  Effect.runPromise(
    fetchZaiCodingPlanUsageEffect(config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

/** Plugin registration for the ZAI Coding Plan provider adapter. */
export const zaiProvider = {
  capabilities: { customBaseUrl: false, transport: "http" },
  configSchema: zaiProviderConfigSchema,
  defaultLabel: "ZAI",
  fetch: fetchZaiCodingPlanUsageEffect,
  footerWindowKind: "rolling",
  id: "zai",
  openCodeProviderIDs: ["zai-coding-plan"],
} as const satisfies ProviderDefinition<"zai">;
