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

/** Default Synthetic API base URL. */
const DEFAULT_SYNTHETIC_BASE_URL = "https://api.synthetic.new";

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
const keyFromSyntheticAuth = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.key === "string") {
    return value.key;
  }

  if (typeof value.apiKey === "string") {
    return value.apiKey;
  }

  if (isRecord(value.synthetic)) {
    if (typeof value.synthetic.key === "string") {
      return value.synthetic.key;
    }
    if (typeof value.synthetic.apiKey === "string") {
      return value.synthetic.apiKey;
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
const readSyntheticAuthPathKey = async (
  authPath: string | undefined
): Promise<string | undefined> => {
  if (!authPath) {
    return undefined;
  }

  try {
    return keyFromSyntheticAuth(await readJsonFile<unknown>(authPath));
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
 * Derives the 5-hour usage window from a Synthetic quotas response.
 *
 * Prefers the v3 `rollingFiveHourLimit` shape and falls back to the legacy
 * `subscription` bucket when v3 fields are absent.
 *
 * @param payload - Parsed Synthetic quotas payload.
 * @returns A normalized 5h window, or `null` when no shape applies.
 */
const syntheticFiveHourWindow = (
  payload: Record<string, unknown>
): UsageWindow | null => {
  const rolling = payload.rollingFiveHourLimit;
  if (isRecord(rolling)) {
    const { remaining } = rolling;
    const { max } = rolling;
    if (typeof remaining === "number" && typeof max === "number" && max > 0) {
      const used = clampPercent((1 - remaining / max) * 100);
      const resetsAt = parseIsoDate(rolling.nextTickAt);
      return {
        current: max - remaining,
        label: "5h",
        remainingPercent: 100 - used,
        resetAfterSeconds: resetsAt
          ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
          : null,
        resetsAt,
        total: max,
        usedPercent: used,
      };
    }
  }

  const { subscription } = payload;
  if (isRecord(subscription)) {
    const { limit } = subscription;
    const { requests } = subscription;
    if (
      typeof limit === "number" &&
      typeof requests === "number" &&
      limit > 0
    ) {
      const used = clampPercent((requests / limit) * 100);
      const resetsAt = parseIsoDate(subscription.renewsAt);
      return {
        current: requests,
        label: "5h",
        remainingPercent: 100 - used,
        resetAfterSeconds: resetsAt
          ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
          : null,
        resetsAt,
        total: limit,
        usedPercent: used,
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
  payload: Record<string, unknown>
): UsageWindow | null => {
  const weekly = payload.weeklyTokenLimit;
  if (!isRecord(weekly)) {
    return null;
  }

  const { percentRemaining } = weekly;
  if (typeof percentRemaining !== "number") {
    return null;
  }

  const used = clampPercent(100 - percentRemaining);
  const resetsAt = parseIsoDate(weekly.nextRegenAt);
  return {
    label: "weekly",
    remainingPercent: 100 - used,
    resetAfterSeconds: resetsAt
      ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
      : null,
    resetsAt,
    usedPercent: used,
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
export const fetchSyntheticUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const configuredKey = resolveEnvReference(config?.apiKey);
  const apiKey =
    (await readSyntheticAuthPathKey(config?.authPath)) ??
    keyFromSyntheticAuth(openCodeAuth) ??
    configuredKey;
  if (!apiKey) {
    throw new Error("missing Synthetic key");
  }

  const baseUrl = resolveHttpsBaseUrl(
    config?.baseUrl,
    DEFAULT_SYNTHETIC_BASE_URL
  );
  const payload = await fetchJson(
    `${baseUrl}/v2/quotas`,
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
    throw new Error("invalid Synthetic usage");
  }

  const windows: UsageWindow[] = [];
  const fiveHour = syntheticFiveHourWindow(payload);
  if (fiveHour) {
    windows.push(fiveHour);
  }
  const weekly = syntheticWeeklyWindow(payload);
  if (weekly) {
    windows.push(weekly);
  }

  if (windows.length === 0) {
    throw new Error("invalid Synthetic usage");
  }

  return {
    capturedAt: new Date(),
    id: "synthetic",
    label: config?.label ?? "Synthetic",
    windows,
  };
};

/** Plugin registration for the Synthetic provider adapter. */
export const syntheticProvider = {
  defaultLabel: "Synthetic",
  fetch: fetchSyntheticUsage,
  footerWindowLabel: "5h",
  id: "synthetic",
  openCodeProviderIDs: [],
} as const satisfies ProviderDefinition<"synthetic">;
