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

/** Default MiniMax Token Plan base URL (international region). */
const DEFAULT_MINIMAX_BASE_URL = "https://www.minimax.io";

/** Endpoint path appended to the configured base URL. */
const MINIMAX_TOKEN_PLAN_PATH = "/v1/token_plan/remains";

/**
 * Extracts a MiniMax subscription key from any supported auth object shape.
 *
 * Accepts direct `{ key }` / `{ apiKey }` objects and the nested shapes used by
 * OpenCode auth under `minimax-coding-plan`, `minimax`, or `minimax-token-plan`.
 *
 * @param value - Unknown auth payload to inspect.
 * @returns The first recognized subscription key.
 */
const keyFromMiniMaxAuth = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.key === "string") {
    return value.key;
  }

  if (typeof value.apiKey === "string") {
    return value.apiKey;
  }

  const minimaxCodingPlan = value["minimax-coding-plan"];
  if (isRecord(minimaxCodingPlan)) {
    if (typeof minimaxCodingPlan.key === "string") {
      return minimaxCodingPlan.key;
    }
    if (typeof minimaxCodingPlan.apiKey === "string") {
      return minimaxCodingPlan.apiKey;
    }
  }

  const { minimax } = value;
  if (isRecord(minimax)) {
    if (typeof minimax.key === "string") {
      return minimax.key;
    }
    if (typeof minimax.apiKey === "string") {
      return minimax.apiKey;
    }
  }

  const minimaxTokenPlan = value["minimax-token-plan"];
  if (isRecord(minimaxTokenPlan)) {
    if (typeof minimaxTokenPlan.key === "string") {
      return minimaxTokenPlan.key;
    }
    if (typeof minimaxTokenPlan.apiKey === "string") {
      return minimaxTokenPlan.apiKey;
    }
  }

  return undefined;
};

/**
 * Attempts to load a MiniMax subscription key from a configured auth path.
 *
 * Missing or invalid files are ignored so other credential sources can still be
 * tried by the provider adapter.
 *
 * @param authPath - Optional auth file path.
 * @returns A MiniMax subscription key when the file exists and contains one.
 */
const readMiniMaxAuthPathKey = async (
  authPath: string | undefined
): Promise<string | undefined> => {
  if (!authPath) {
    return undefined;
  }

  try {
    return keyFromMiniMaxAuth(await readJsonFile<unknown>(authPath));
  } catch {
    return undefined;
  }
};

/**
 * Picks the most useful per-model entry from a MiniMax token-plan response.
 *
 * The plan covers all models, but the API returns one record per model. The
 * `"general"` entry is the canonical quota view; if absent, the first record
 * marked as in-plan with a usable remaining percent is used.
 *
 * @param entries - Array of `MiniMaxModelUsage`-shaped records.
 * @returns The selected record, or `null` when none are usable.
 */
const selectMiniMaxEntry = (
  entries: readonly Record<string, unknown>[]
): Record<string, unknown> | null => {
  const general = entries.find((entry) => entry.model_name === "general");
  if (general) {
    return general;
  }

  return (
    entries.find(
      (entry) =>
        entry.current_interval_status === 1 &&
        typeof entry.current_interval_remaining_percent === "number"
    ) ?? null
  );
};

/**
 * Builds the 5-hour usage window from a selected MiniMax model entry.
 *
 * MiniMax reports the percentage of quota remaining rather than used. The
 * window is omitted when the entry does not report a remaining percent or when
 * `current_interval_status === 3`, which means the model is not in the plan for
 * this rolling window (the API still reports `100` for a non-existent bucket).
 *
 * @param entry - Selected MiniMax model entry.
 * @returns A normalized 5h window, or `null` when not reportable.
 */
const minimaxFiveHourWindow = (
  entry: Record<string, unknown>
): UsageWindow | null => {
  if (entry.current_interval_status === 3) {
    return null;
  }
  const remainingPercent = entry.current_interval_remaining_percent;
  if (typeof remainingPercent !== "number") {
    return null;
  }

  const used = clampPercent(100 - remainingPercent);
  const remainsMs = entry.remains_time;
  const resetsAt =
    typeof remainsMs === "number" ? new Date(Date.now() + remainsMs) : null;
  return {
    label: "5h",
    remainingPercent: 100 - used,
    resetAfterSeconds:
      typeof remainsMs === "number"
        ? Math.max(0, Math.ceil(remainsMs / 1000))
        : null,
    resetsAt,
    usedPercent: used,
  };
};

/**
 * Builds the weekly usage window from a selected MiniMax model entry.
 *
 * The window is omitted when the entry does not report a remaining percent or
 * when `current_weekly_status === 3`, which means the model is not in the plan
 * for this weekly window (the API still reports `100` for a non-existent
 * bucket).
 *
 * @param entry - Selected MiniMax model entry.
 * @returns A normalized weekly window, or `null` when not reportable.
 */
const minimaxWeeklyWindow = (
  entry: Record<string, unknown>
): UsageWindow | null => {
  if (entry.current_weekly_status === 3) {
    return null;
  }
  const remainingPercent = entry.current_weekly_remaining_percent;
  if (typeof remainingPercent !== "number") {
    return null;
  }

  const used = clampPercent(100 - remainingPercent);
  const remainsMs = entry.weekly_remains_time;
  const resetsAt =
    typeof remainsMs === "number" ? new Date(Date.now() + remainsMs) : null;
  return {
    label: "weekly",
    remainingPercent: 100 - used,
    resetAfterSeconds:
      typeof remainsMs === "number"
        ? Math.max(0, Math.ceil(remainsMs / 1000))
        : null,
    resetsAt,
    usedPercent: used,
  };
};

/**
 * Validates the MiniMax token-plan response envelope and returns the per-model
 * entries.
 *
 * Accepts objects with a `model_remains` array and a `base_resp` envelope whose
 * `status_code` is `0` (or absent/null) and `status_msg === "success"`. Any
 * other shape is treated as an invalid response.
 *
 * @param payload - Parsed JSON payload to validate.
 * @returns The filtered list of per-model entry records.
 * @throws {TypeError} When the payload is not an object.
 * @throws {Error} When the envelope shape does not match a successful response.
 */
const parseMiniMaxModelRemains = (
  payload: unknown
): Record<string, unknown>[] => {
  if (!isRecord(payload)) {
    throw new TypeError("invalid MiniMax usage");
  }
  const baseResp = payload.base_resp;
  const statusCode = isRecord(baseResp) ? baseResp.status_code : undefined;
  const statusMsg = isRecord(baseResp) ? baseResp.status_msg : undefined;
  const baseRespOk =
    (statusCode === 0 || statusCode === null || statusCode === undefined) &&
    statusMsg === "success";
  if (!baseRespOk) {
    throw new Error("invalid MiniMax usage");
  }
  if (!Array.isArray(payload.model_remains)) {
    throw new TypeError("invalid MiniMax usage");
  }
  return payload.model_remains.filter(isRecord);
};

/**
 * Fetches and normalizes MiniMax Token Plan usage limits.
 *
 * Credential lookup checks, in order, the configured auth path, OpenCode auth,
 * and a configured literal or environment-backed subscription key.
 *
 * @param config - Optional MiniMax provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized MiniMax Token Plan usage data.
 * @throws {Error} When no subscription key is available or the provider response is invalid.
 */
export const fetchMiniMaxTokenPlanUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const configuredKey = resolveEnvReference(config?.apiKey);
  const apiKey =
    (await readMiniMaxAuthPathKey(config?.authPath)) ??
    keyFromMiniMaxAuth(openCodeAuth) ??
    configuredKey;
  if (!apiKey) {
    throw new Error("missing MiniMax key");
  }

  const baseUrl = resolveHttpsBaseUrl(
    config?.baseUrl,
    DEFAULT_MINIMAX_BASE_URL
  );
  const payload = await fetchJson(
    `${baseUrl}${MINIMAX_TOKEN_PLAN_PATH}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "GET",
    },
    timeoutMs
  );

  const entries = parseMiniMaxModelRemains(payload);
  const selected = selectMiniMaxEntry(entries);
  if (!selected) {
    throw new Error("invalid MiniMax usage");
  }

  const windows: UsageWindow[] = [];
  const fiveHour = minimaxFiveHourWindow(selected);
  if (fiveHour) {
    windows.push(fiveHour);
  }
  const weekly = minimaxWeeklyWindow(selected);
  if (weekly) {
    windows.push(weekly);
  }

  if (windows.length === 0) {
    throw new Error("invalid MiniMax usage");
  }

  return {
    capturedAt: new Date(),
    id: "minimax",
    label: config?.label ?? "MiniMax",
    windows,
  };
};

/** Plugin registration for the MiniMax Token Plan provider adapter. */
export const minimaxProvider = {
  defaultLabel: "MiniMax",
  fetch: fetchMiniMaxTokenPlanUsage,
  footerWindowLabel: "5h",
  id: "minimax",
  openCodeProviderIDs: ["minimax-coding-plan", "minimax"],
} as const satisfies ProviderDefinition<"minimax">;
