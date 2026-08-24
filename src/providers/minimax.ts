import { Effect, Redacted, Result } from "effect";

import { minimaxProviderConfigSchema } from "@/config-schema.ts";
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
  MiniMaxProviderConfig,
  OpenCodeAuth,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import {
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "@/usage.ts";
import { isRecord } from "@/utils.ts";
import type { JsonObject, JsonValue } from "@/utils.ts";
import { resolveHttpsBaseUrl } from "@/utils/url.ts";

/** Default MiniMax Token Plan base URL (international region). */
const DEFAULT_MINIMAX_BASE_URL = "https://www.minimax.io";

/** Endpoint path appended to the configured base URL. */
const MINIMAX_TOKEN_PLAN_PATH = "/v1/token_plan/remains";
const INVALID_MINIMAX_USAGE = "invalid MiniMax usage";
const DECODE_RESPONSE_OPERATION = "decode-response";

interface MiniMaxModelEntry {
  readonly model_name?: string;
  readonly current_interval_status?: number;
  readonly current_interval_remaining_percent?: number;
  readonly remains_time?: number;
  readonly current_weekly_status?: number;
  readonly current_weekly_remaining_percent?: number;
  readonly weekly_remains_time?: number;
}

interface MiniMaxPayload {
  readonly base_resp?: {
    readonly status_code?: number | null;
    readonly status_msg?: string;
  };
  readonly model_remains: readonly MiniMaxModelEntry[];
}

/**
 * Extracts a MiniMax subscription key from any supported auth object shape.
 *
 * Accepts direct `{ key }` / `{ apiKey }` objects and the nested shapes used by
 * OpenCode auth under `minimax-coding-plan`, `minimax`, or `minimax-token-plan`.
 *
 * @param value - Unknown auth payload to inspect.
 * @returns The first recognized subscription key.
 */
const keyFromMiniMaxAuth = (
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

  const minimaxCodingPlan = value["minimax-coding-plan"];
  if (isRecord(minimaxCodingPlan)) {
    const key = credential(minimaxCodingPlan.key);
    if (key) {
      return key;
    }
    const apiKey = credential(minimaxCodingPlan.apiKey);
    if (apiKey) {
      return apiKey;
    }
  }

  const { minimax } = value;
  if (isRecord(minimax)) {
    const key = credential(minimax.key);
    if (key) {
      return key;
    }
    const apiKey = credential(minimax.apiKey);
    if (apiKey) {
      return apiKey;
    }
  }

  const minimaxTokenPlan = value["minimax-token-plan"];
  if (isRecord(minimaxTokenPlan)) {
    const key = credential(minimaxTokenPlan.key);
    if (key) {
      return key;
    }
    const apiKey = credential(minimaxTokenPlan.apiKey);
    if (apiKey) {
      return apiKey;
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
const readMiniMaxAuthPathKey = (
  authPath: string | undefined
): Effect.Effect<
  Redacted.Redacted<string> | undefined,
  never,
  ProviderEnvironment | ProviderFileSystem
> => {
  if (!authPath) {
    return Effect.succeed<undefined>(globalThis.undefined);
  }
  return Effect.gen(function* loadMiniMaxAuthPathKey() {
    const files = yield* ProviderFileSystem;
    const environment = yield* ProviderEnvironment;
    const auth = yield* files.readJson({
      path: authPath,
      providerID: "minimax",
    });
    return isRecord(auth)
      ? keyFromMiniMaxAuth(auth, environment.credential)
      : undefined;
  }).pipe(
    Effect.catchCause(() => Effect.succeed<undefined>(globalThis.undefined))
  );
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
  entries: readonly MiniMaxModelEntry[]
): MiniMaxModelEntry | null => {
  const general = entries.find((entry) => entry.model_name === "general");
  if (general) {
    return general;
  }

  return (
    entries.find(
      (entry) =>
        entry.current_interval_status === 1 &&
        entry.current_interval_remaining_percent !== undefined
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
  entry: MiniMaxModelEntry,
  now: Date
): UsageWindow | null => {
  if (entry.current_interval_status === 3) {
    return null;
  }
  const remainingPercent = entry.current_interval_remaining_percent;
  const parsedRemaining = parseUsagePercentage(remainingPercent);
  if (Result.isFailure(parsedRemaining)) {
    return null;
  }

  const parsedUsed = parseUsagePercentage(100 - parsedRemaining.success);
  if (Result.isFailure(parsedUsed)) {
    return null;
  }
  const remainsMs = entry.remains_time;
  const resetsAt = resetInstantOrNull(
    remainsMs === undefined ? null : new Date(now.getTime() + remainsMs)
  );
  return {
    kind: "rolling",
    label: "5h",
    quota: percentageQuota(parsedUsed.success),
    resetsAt,
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
  entry: MiniMaxModelEntry,
  now: Date
): UsageWindow | null => {
  if (entry.current_weekly_status === 3) {
    return null;
  }
  const remainingPercent = entry.current_weekly_remaining_percent;
  const parsedRemaining = parseUsagePercentage(remainingPercent);
  if (Result.isFailure(parsedRemaining)) {
    return null;
  }

  const parsedUsed = parseUsagePercentage(100 - parsedRemaining.success);
  if (Result.isFailure(parsedUsed)) {
    return null;
  }
  const remainsMs = entry.weekly_remains_time;
  const resetsAt = resetInstantOrNull(
    remainsMs === undefined ? null : new Date(now.getTime() + remainsMs)
  );
  return {
    kind: "weekly",
    label: "weekly",
    quota: percentageQuota(parsedUsed.success),
    resetsAt,
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
const parseMiniMaxModelRemains = (payload: JsonObject): MiniMaxPayload => {
  const baseResp = isRecord(payload.base_resp) ? payload.base_resp : undefined;
  const statusCode = isRecord(baseResp) ? baseResp.status_code : undefined;
  const statusMsg = isRecord(baseResp) ? baseResp.status_msg : undefined;
  const baseRespOk =
    (statusCode === 0 || statusCode === null || statusCode === undefined) &&
    statusMsg === "success";
  if (!baseRespOk) {
    throw new Error(INVALID_MINIMAX_USAGE);
  }
  if (!Array.isArray(payload.model_remains)) {
    throw new TypeError(INVALID_MINIMAX_USAGE);
  }
  const entries = payload.model_remains.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    return [
      {
        current_interval_remaining_percent: isJsonNumber(
          entry.current_interval_remaining_percent
        )
          ? entry.current_interval_remaining_percent
          : undefined,
        current_interval_status: isJsonNumber(entry.current_interval_status)
          ? entry.current_interval_status
          : undefined,
        current_weekly_remaining_percent: isJsonNumber(
          entry.current_weekly_remaining_percent
        )
          ? entry.current_weekly_remaining_percent
          : undefined,
        current_weekly_status: isJsonNumber(entry.current_weekly_status)
          ? entry.current_weekly_status
          : undefined,
        model_name: isJsonString(entry.model_name)
          ? entry.model_name
          : undefined,
        remains_time: isJsonNumber(entry.remains_time)
          ? entry.remains_time
          : undefined,
        weekly_remains_time: isJsonNumber(entry.weekly_remains_time)
          ? entry.weekly_remains_time
          : undefined,
      },
    ];
  });
  return {
    base_resp: baseResp
      ? {
          status_code:
            isJsonNumber(baseResp.status_code) || baseResp.status_code === null
              ? baseResp.status_code
              : undefined,
          status_msg: isJsonString(baseResp.status_msg)
            ? baseResp.status_msg
            : undefined,
        }
      : undefined,
    model_remains: entries,
  };
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
const fetchMiniMaxTokenPlanUsageEffect = (
  config: MiniMaxProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"minimax">["fetch"]> =>
  Effect.gen(function* runFetchMiniMaxTokenPlanUsage() {
    const environment = yield* ProviderEnvironment;
    const http = yield* ProviderHttpClient;
    const clock = yield* ProviderClock;
    const baseUrl = resolveHttpsBaseUrl(
      config?.baseUrl,
      DEFAULT_MINIMAX_BASE_URL
    );
    const officialHosts = new Set(["www.minimax.io", "api.minimaxi.com"]);
    const isOfficialHost = officialHosts.has(new URL(baseUrl).hostname);
    const configuredKey = environment.resolveCredential(config?.apiKey);
    const configuredFileKey = yield* readMiniMaxAuthPathKey(config?.authPath);
    const authKey = isRecord(openCodeAuth)
      ? keyFromMiniMaxAuth(openCodeAuth, environment.credential)
      : undefined;
    const apiKey =
      configuredFileKey ??
      (isOfficialHost ? (authKey ?? configuredKey) : configuredKey);
    if (!apiKey) {
      return yield* new MissingProviderCredentialsError({
        operation: "fetch-usage",
        providerID: "minimax",
      });
    }

    const payload = yield* http.requestJson({
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${Redacted.value(apiKey)}`,
        "Content-Type": "application/json",
      },
      method: "GET",
      providerID: "minimax",
      timeoutMs,
      url: `${baseUrl}${MINIMAX_TOKEN_PLAN_PATH}`,
    });

    const response = yield* Effect.try({
      catch: () =>
        new ProviderResponseDecodeError({
          cause: "schema",
          operation: DECODE_RESPONSE_OPERATION,
          providerID: "minimax",
        }),
      try: () => {
        if (!isRecord(payload)) {
          throw new TypeError(INVALID_MINIMAX_USAGE);
        }
        return parseMiniMaxModelRemains(payload);
      },
    });
    const selected = selectMiniMaxEntry(response.model_remains);
    if (!selected) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE_OPERATION,
        providerID: "minimax",
      });
    }

    const capturedAt = yield* clock.now;
    const windows: UsageWindow[] = [];
    const fiveHour = minimaxFiveHourWindow(selected, capturedAt);
    if (fiveHour) {
      windows.push(fiveHour);
    }
    const weekly = minimaxWeeklyWindow(selected, capturedAt);
    if (weekly) {
      windows.push(weekly);
    }

    if (!fiveHour) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE_OPERATION,
        providerID: "minimax",
      });
    }

    return {
      capturedAt,
      id: "minimax",
      label: config?.label ?? "MiniMax",
      windows,
    };
  });

/** Stable Promise export for direct consumers of the provider adapter. */
export const fetchMiniMaxTokenPlanUsage = (
  config: MiniMaxProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"minimax">> =>
  Effect.runPromise(
    fetchMiniMaxTokenPlanUsageEffect(config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

/** Plugin registration for the MiniMax Token Plan provider adapter. */
export const minimaxProvider = {
  capabilities: { customBaseUrl: true, transport: "http" },
  configSchema: minimaxProviderConfigSchema,
  defaultLabel: "MiniMax",
  fetch: fetchMiniMaxTokenPlanUsageEffect,
  footerWindowKind: "rolling",
  id: "minimax",
  openCodeProviderIDs: ["minimax-coding-plan", "minimax"],
} as const satisfies ProviderDefinition<"minimax">;
