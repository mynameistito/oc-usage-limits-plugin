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

/** Default Synthetic API base URL. */
const DEFAULT_SYNTHETIC_BASE_URL = "https://api.synthetic.new";

/**
 * Determines whether a hostname refers to the local machine.
 *
 * Loopback hosts are the only case where plain `http` is permitted, so local
 * test servers do not require a TLS certificate.
 *
 * @param hostname - Hostname from a parsed URL (no port; IPv6 literals keep
 *   their surrounding brackets per the WHATWG URL standard).
 * @returns `true` when the host is a loopback address.
 */
const isLoopbackHost = (hostname: string): boolean => {
  const host =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  return (
    host === "localhost" ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
  );
};

/**
 * Resolves and validates the Synthetic base URL before it reaches a request.
 *
 * Only `https` URLs are allowed; `http` is permitted solely for loopback hosts.
 * Anything that fails to parse, or uses another scheme, falls back to the
 * default base so the API key is never sent to an unexpected host.
 *
 * @param baseUrl - Configured base URL, or `undefined` for the default.
 * @returns A safe, absolute URL string with no trailing slash.
 */
const resolveSyntheticBaseUrl = (baseUrl: string | undefined): string => {
  const fallback = DEFAULT_SYNTHETIC_BASE_URL.replace(/\/$/u, "");
  let parsed: URL;
  try {
    parsed = new URL((baseUrl ?? DEFAULT_SYNTHETIC_BASE_URL).trim());
  } catch {
    return fallback;
  }

  const allowed =
    parsed.protocol === "https:" ||
    (isLoopbackHost(parsed.hostname) && parsed.protocol === "http:");
  return allowed ? parsed.toString().replace(/\/$/u, "") : fallback;
};

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

  if (isRecord(value.synthetic) && typeof value.synthetic.key === "string") {
    return value.synthetic.key;
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
        label: "5h",
        remainingPercent: 100 - used,
        resetAfterSeconds: resetsAt
          ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
          : null,
        resetsAt,
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
        label: "5h",
        remainingPercent: 100 - used,
        resetAfterSeconds: resetsAt
          ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
          : null,
        resetsAt,
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

  const baseUrl = resolveSyntheticBaseUrl(config?.baseUrl);
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
