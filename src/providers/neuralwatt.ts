import type { ProviderDefinition } from "@/providers/definition.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import {
  clampPercent,
  fetchJson,
  isRecord,
  readJsonFile,
  resolveEnvReference,
} from "@/utils.ts";
import { resolveHttpsBaseUrl } from "@/utils/url.ts";

/** Default NeuralWatt API base URL. */
const DEFAULT_NEURALWATT_BASE_URL = "https://api.neuralwatt.com/v1";

/**
 * Extracts a NeuralWatt API key from any supported auth object shape.
 *
 * Accepts direct `{ apiKey }` objects and the nested `neuralwatt` block used by
 * OpenCode auth.
 *
 * @param value - Unknown auth payload to inspect.
 * @returns The first recognized API key.
 */
const keyFromNeuralWattAuth = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.apiKey === "string") {
    return value.apiKey;
  }

  if (isRecord(value.neuralwatt)) {
    if (typeof value.neuralwatt.apiKey === "string") {
      return value.neuralwatt.apiKey;
    }
    if (typeof value.neuralwatt.key === "string") {
      return value.neuralwatt.key;
    }
  }

  return undefined;
};

/**
 * Attempts to load a NeuralWatt API key from a configured auth path.
 *
 * Missing or invalid files are ignored so other credential sources can still be
 * tried by the provider adapter.
 *
 * @param authPath - Optional auth file path.
 * @returns A NeuralWatt API key when the file exists and contains one.
 */
const readNeuralWattAuthPathKey = async (
  authPath: string | undefined
): Promise<string | undefined> => {
  if (!authPath) {
    return undefined;
  }

  try {
    return keyFromNeuralWattAuth(await readJsonFile<unknown>(authPath));
  } catch {
    return undefined;
  }
};

/**
 * Builds a `Date` from a provider-reported ISO timestamp.
 *
 * @param value - ISO-8601 timestamp string reported by the provider.
 * @returns A `Date` when the input parses, otherwise `null`.
 */
const parseIsoDate = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Derives the monthly subscription window from a NeuralWatt quota response.
 *
 * @param payload - Parsed NeuralWatt quotas payload.
 * @returns A normalized monthly window, or `null` when no subscription applies.
 */
const neuralwattSubscriptionWindow = (
  payload: Record<string, unknown>
): UsageWindow | null => {
  const { subscription } = payload;
  if (!isRecord(subscription)) {
    return null;
  }

  const kwhUsed = subscription.kwh_used;
  const kwhIncluded = subscription.kwh_included;
  if (
    typeof kwhUsed !== "number" ||
    typeof kwhIncluded !== "number" ||
    kwhIncluded <= 0
  ) {
    return null;
  }

  const used = clampPercent((kwhUsed / kwhIncluded) * 100);
  const resetsAt = parseIsoDate(subscription.current_period_end);
  return {
    current: Math.max(0, Math.min(kwhIncluded, kwhUsed)),
    label: "monthly",
    remainingPercent: 100 - used,
    resetAfterSeconds: resetsAt
      ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
      : null,
    resetsAt,
    total: kwhIncluded,
    usedPercent: used,
  };
};

/**
 * Derives a key-allowance window from a NeuralWatt quota response.
 *
 * The allowance period (daily/weekly/monthly) drives the window label. No reset
 * timestamp is provided, so `resetsAt` and `resetAfterSeconds` are left `null`.
 *
 * @param payload - Parsed NeuralWatt quotas payload.
 * @returns A normalized allowance window, or `null` when absent.
 */
const neuralwattAllowanceWindow = (
  payload: Record<string, unknown>,
  hasSubscription = false
): UsageWindow | null => {
  const { key } = payload;
  if (!isRecord(key) || key.allowance === null || key.allowance === undefined) {
    return null;
  }

  const { allowance } = key;
  if (!isRecord(allowance)) {
    return null;
  }

  const spent = allowance.spent_usd;
  const limit = allowance.limit_usd;
  if (typeof spent !== "number" || typeof limit !== "number" || limit <= 0) {
    return null;
  }

  const used = clampPercent((spent / limit) * 100);
  const period = typeof allowance.period === "string" ? allowance.period : "";
  let label: string;
  if (!["daily", "weekly", "monthly"].includes(period)) {
    label = "allowance";
  } else if (hasSubscription && period === "monthly") {
    label = "key monthly";
  } else {
    label = period;
  }

  return {
    current: Math.max(0, Math.min(limit, spent)),
    label,
    remainingPercent: 100 - used,
    resetAfterSeconds: null,
    resetsAt: null,
    total: limit,
    usedPercent: used,
  };
};

/**
 * Derives a credit-balance fallback window from a NeuralWatt quota response.
 *
 * Used when the response does not include a subscription block.
 *
 * @param payload - Parsed NeuralWatt quotas payload.
 * @returns A normalized credits window, or `null` when no balance applies.
 */
const neuralwattCreditBalanceWindow = (
  payload: Record<string, unknown>
): UsageWindow | null => {
  const { balance } = payload;
  if (!isRecord(balance)) {
    return null;
  }

  const creditsUsed = balance.credits_used_usd;
  const totalCredits = balance.total_credits_usd;
  if (
    typeof creditsUsed !== "number" ||
    typeof totalCredits !== "number" ||
    totalCredits <= 0
  ) {
    return null;
  }

  const used = clampPercent((creditsUsed / totalCredits) * 100);
  return {
    current: Math.max(0, Math.min(totalCredits, creditsUsed)),
    label: "credits",
    remainingPercent: 100 - used,
    resetAfterSeconds: null,
    resetsAt: null,
    total: totalCredits,
    usedPercent: used,
  };
};

/**
 * Fetches and normalizes NeuralWatt usage limits.
 *
 * Credential lookup checks, in order, the configured auth path, OpenCode auth,
 * and a configured literal or environment-backed API key.
 *
 * @param config - Optional NeuralWatt provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized NeuralWatt usage data.
 * @throws {Error} When no API key is available or the provider response is invalid.
 */
export const fetchNeuralWattUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const configuredKey = resolveEnvReference(config?.apiKey);
  const apiKey =
    (await readNeuralWattAuthPathKey(config?.authPath)) ??
    keyFromNeuralWattAuth(openCodeAuth) ??
    configuredKey;
  if (!apiKey) {
    throw new Error("missing NeuralWatt key");
  }

  const baseUrl = resolveHttpsBaseUrl(
    config?.baseUrl,
    DEFAULT_NEURALWATT_BASE_URL
  );
  const payload = await fetchJson(
    `${baseUrl}/quota`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      method: "GET",
    },
    timeoutMs
  );

  if (!isRecord(payload)) {
    throw new Error("invalid NeuralWatt usage");
  }

  const windows: UsageWindow[] = [];
  const subscription = neuralwattSubscriptionWindow(payload);
  if (subscription) {
    windows.push(subscription);
  }

  const allowance = neuralwattAllowanceWindow(payload, Boolean(subscription));
  if (allowance) {
    windows.push(allowance);
  }

  if (windows.length === 0) {
    const credits = neuralwattCreditBalanceWindow(payload);
    if (credits) {
      windows.push(credits);
    }
  }

  if (windows.length === 0) {
    throw new Error("invalid NeuralWatt usage");
  }

  const subscriptionPlan = isRecord(payload.subscription)
    ? payload.subscription.plan
    : undefined;

  return {
    capturedAt: new Date(),
    id: "neuralwatt",
    label: config?.label ?? "NeuralWatt",
    tierName:
      typeof subscriptionPlan === "string" ? subscriptionPlan : undefined,
    windows,
  };
};

/** Plugin registration for the NeuralWatt provider adapter. */
export const neuralwattProvider = {
  defaultLabel: "NeuralWatt",
  fetch: fetchNeuralWattUsage,
  footerWindowLabel: "monthly",
  id: "neuralwatt",
  openCodeProviderIDs: ["neuralwatt"],
} as const satisfies ProviderDefinition<"neuralwatt">;
