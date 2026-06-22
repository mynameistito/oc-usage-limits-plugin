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

  if (typeof value.key === "string") {
    return value.key;
  }

  if (typeof value.apiKey === "string") {
    return value.apiKey;
  }

  const zaiCodingPlan = value["zai-coding-plan"];
  if (isRecord(zaiCodingPlan) && typeof zaiCodingPlan.key === "string") {
    return zaiCodingPlan.key;
  }

  if (isRecord(value.zai) && typeof value.zai.key === "string") {
    return value.zai.key;
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
    return keyFromZaiAuth(await readJsonFile<unknown>(authPath));
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
  const usedPercent =
    typeof limit.percentage === "number"
      ? clampPercent(limit.percentage)
      : null;
  const resetsAt =
    typeof limit.nextResetTime === "number"
      ? new Date(limit.nextResetTime)
      : null;
  const total = typeof limit.usage === "number" ? limit.usage : undefined;

  if (limit.type === "TOKENS_LIMIT") {
    return {
      promptTotal: null,
      window: {
        label: "5h",
        remainingPercent: usedPercent === null ? null : 100 - usedPercent,
        resetAfterSeconds: resetsAt
          ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))
          : null,
        resetsAt,
        usedPercent,
      },
    };
  }

  if (limit.type === "TIME_LIMIT") {
    return {
      promptTotal: total ?? null,
      window: null,
    };
  }

  return { promptTotal: null, window: null };
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
): Promise<ProviderUsage> => {
  const configuredKey = resolveEnvReference(config?.apiKey);
  const apiKey =
    (await readZaiAuthPathKey(config?.authPath)) ??
    keyFromZaiAuth(openCodeAuth) ??
    configuredKey;
  if (!apiKey) {
    throw new Error("missing ZAI key");
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

  const windows: UsageWindow[] = [];
  let promptTotal: number | null = null;

  for (const limit of payload.data.limits) {
    if (!isRecord(limit) || typeof limit.type !== "string") {
      continue;
    }

    const usage = zaiWindowFromLimit(limit);
    if (usage.window) {
      windows.push(usage.window);
    }
    if (usage.promptTotal !== null) {
      ({ promptTotal } = usage);
    }
  }

  return {
    capturedAt: new Date(),
    id: "zai",
    label: config?.label ?? "ZAI",
    tierName: inferZaiTier(promptTotal),
    windows,
  };
};
