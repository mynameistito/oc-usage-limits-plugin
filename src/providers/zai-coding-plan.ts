import { Result } from "effect";

import { credentialValue } from "@/config-schema.ts";
import { MissingProviderCredentialsError } from "@/errors.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
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
import {
  fetchJson,
  isRecord,
  readJsonFile,
  resolveEnvReference,
} from "@/utils.ts";

/** ZAI Coding Plan quota endpoint used to fetch usage limits. */
const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

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
const keyFromZaiAuth = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const directKey = credentialValue(value.key);
  if (directKey) {
    return directKey;
  }

  const directApiKey = credentialValue(value.apiKey);
  if (directApiKey) {
    return directApiKey;
  }

  const zaiCodingPlan = value["zai-coding-plan"];
  if (isRecord(zaiCodingPlan)) {
    const key = credentialValue(zaiCodingPlan.key);
    if (key) {
      return key;
    }
  }

  if (isRecord(value.zai)) {
    return credentialValue(value.zai.key);
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
const readZaiAuthPathKey = async (
  authPath: string | undefined
): Promise<string | undefined> => {
  if (!authPath) {
    return undefined;
  }

  try {
    return keyFromZaiAuth(await readJsonFile(authPath));
  } catch {
    return undefined;
  }
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
const zaiWindowFromLimit = (
  limit: Record<string, unknown>
): { promptTotal: number | null; window: UsageWindow | null } => {
  const parsedUsed = parseUsagePercentage(limit.percentage);
  const usedPercent = Result.isSuccess(parsedUsed) ? parsedUsed.success : null;
  const resetsAt = resetInstantOrNull(
    typeof limit.nextResetTime === "number"
      ? new Date(limit.nextResetTime)
      : null
  );
  const usageTotal = typeof limit.usage === "number" ? limit.usage : undefined;

  if (limit.type === "TOKENS_LIMIT") {
    const rawCurrentValue =
      typeof limit.currentValue === "number" ? limit.currentValue : undefined;
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

const parseZaiLimits = (
  limits: readonly unknown[]
): { readonly promptTotal: number | null; readonly windows: UsageWindow[] } => {
  const windows: UsageWindow[] = [];
  let promptTotal: number | null = null;
  let sawTokenLimit = false;

  for (const limit of limits) {
    if (!isRecord(limit) || typeof limit.type !== "string") {
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
export const fetchZaiCodingPlanUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"zai">> => {
  const configuredKey = resolveEnvReference(credentialValue(config?.apiKey));
  const apiKey =
    (await readZaiAuthPathKey(config?.authPath)) ??
    keyFromZaiAuth(openCodeAuth) ??
    configuredKey;
  if (!apiKey) {
    throw new MissingProviderCredentialsError({
      operation: "fetch-usage",
      providerID: "zai",
    });
  }

  const scheme = config?.authorizationScheme ?? "raw";
  const payload = await fetchJson(
    ZAI_QUOTA_URL,
    {
      headers: {
        "Accept-Language": "en-US,en",
        Authorization: scheme === "bearer" ? `Bearer ${apiKey}` : apiKey,
        "Content-Type": "application/json",
      },
      method: "GET",
    },
    timeoutMs
  );

  if (
    !isRecord(payload) ||
    !isRecord(payload.data) ||
    !Array.isArray(payload.data.limits)
  ) {
    throw new Error("invalid ZAI usage");
  }

  const { promptTotal, windows } = parseZaiLimits(payload.data.limits);

  return {
    capturedAt: new Date(),
    id: "zai",
    label: config?.label ?? "ZAI",
    tierName: inferZaiTier(promptTotal),
    windows,
  };
};

/** Plugin registration for the ZAI Coding Plan provider adapter. */
export const zaiProvider = {
  defaultLabel: "ZAI",
  fetch: fetchZaiCodingPlanUsage,
  footerWindowLabel: "5h",
  id: "zai",
  openCodeProviderIDs: ["zai-coding-plan"],
} as const satisfies ProviderDefinition<"zai">;
