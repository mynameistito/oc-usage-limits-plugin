import { Effect, Redacted, Result, Schema } from "effect";

import { commandCodeProviderConfigSchema } from "@/config-schema.ts";
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
  CommandCodeProviderConfig,
  OpenCodeAuth,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import type { ResetInstant } from "@/usage.ts";
import {
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
  unknownQuota,
} from "@/usage.ts";
import { isRecord } from "@/utils.ts";
import type { JsonValue } from "@/utils.ts";
import { resolveHttpsBaseUrl } from "@/utils/url.ts";

/** Default Command Code API base URL. */
const DEFAULT_COMMANDCODE_BASE_URL = "https://api.commandcode.ai";
/** Account-identity endpoint that resolves the organization namespace. */
const COMMANDCODE_WHOAMI_PATH = "/alpha/whoami";
/** Credit-window usage endpoint (the same source the CLI's `/usage` reads). */
const COMMANDCODE_CREDITS_PATH = "/alpha/billing/credits";
/** Billing-period spend endpoint used to derive the monthly credit window. */
const COMMANDCODE_USAGE_SUMMARY_PATH = "/alpha/usage/summary";
const COMMANDCODE_PROVIDER_ID = "commandcode" as const;
const DECODE_RESPONSE = "decode-response";
const decodeString = Schema.decodeUnknownOption(Schema.String);

type ProviderPayload = Readonly<Record<string, JsonValue>>;

/**
 * Builds an absolute Command Code endpoint URL.
 *
 * Query parameters with an empty or absent value are dropped rather than sent
 * blank, because the API rejects an empty `orgId=` with HTTP 400.
 *
 * @param baseUrl - Validated API base URL.
 * @param path - Endpoint path, including its leading slash.
 * @param query - Query parameters; falsy values are omitted.
 * @returns The absolute request URL.
 */
const commandCodeUrl = (
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, string | undefined>> = {}
): string => {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

/**
 * Reads the account's organization scope from a `/alpha/whoami` payload.
 *
 * The endpoint reports the account at the root or nested under `data`, and
 * names the organization block `org` or `organization`. Only a non-empty id is
 * usable, because an empty `orgId` query parameter is rejected with HTTP 400.
 *
 * @param payload - Parsed `/alpha/whoami` response.
 * @returns The organization id, or `undefined` for a personal account.
 */
const orgIdFromWhoami = (payload: JsonValue): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const scope = isRecord(payload.data) ? payload.data : payload;
  const org = isRecord(scope.org) ? scope.org : scope.organization;
  if (!isRecord(org)) {
    return undefined;
  }
  const { id } = org;
  const orgId = decodeString(id);
  return orgId._tag === "Some" && orgId.value.trim() !== ""
    ? orgId.value
    : undefined;
};

/**
 * Detects an explicit failure signal in a `/alpha/whoami` payload.
 *
 * The endpoint can answer `200` with a body that reports failure through its
 * `success` flag. That payload carries no trustworthy account scope, so it must
 * fail the refresh instead of being read as a personal account. Only an
 * explicit `false` fails, because the flag is optional and its absence is not a
 * failure.
 *
 * @param payload - Parsed `/alpha/whoami` response.
 * @returns `true` when the payload explicitly reports failure.
 */
const whoamiReportsFailure = (payload: JsonValue): boolean => {
  if (!isRecord(payload)) {
    return false;
  }
  if (payload.success === false) {
    return true;
  }
  return isRecord(payload.data) && payload.data.success === false;
};

/**
 * Builds the bearer-auth headers shared by every Command Code request.
 *
 * @param apiKey - Resolved Command Code API key.
 * @returns Headers for an authenticated JSON request.
 */
const authorizedHeaders = (apiKey: Redacted.Redacted<string>) => ({
  Accept: "application/json",
  Authorization: `Bearer ${Redacted.value(apiKey)}`,
});

/**
 * Extracts a Command Code API key from any supported auth object shape.
 *
 * Accepts the nested `commandcode` block used by OpenCode auth and direct key
 * fields so the adapter stays provider-agnostic.
 *
 * @param value - Unknown auth payload to inspect.
 * @returns The first recognized API key.
 */
const keyFromCommandCodeAuth = (
  value: OpenCodeAuth | JsonValue,
  credential: (
    value: JsonValue | Redacted.Redacted<string> | undefined
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

  const { commandcode: commandCode } = value;
  if (isRecord(commandCode)) {
    const key = credential(commandCode.key);
    if (key) {
      return key;
    }
    const apiKey = credential(commandCode.apiKey);
    if (apiKey) {
      return apiKey;
    }
  }

  return undefined;
};

/**
 * Attempts to load a Command Code API key from a configured auth path.
 *
 * @param authPath - Optional auth file path.
 * @returns A Command Code API key when the file exists and contains one.
 */
const readCommandCodeAuthPathKey = (
  authPath: string | undefined
): Effect.Effect<
  Redacted.Redacted<string> | undefined,
  never,
  ProviderEnvironment | ProviderFileSystem
> => {
  if (!authPath) {
    return Effect.succeed<undefined>(globalThis.undefined);
  }
  return Effect.gen(function* loadCommandCodeAuthPathKey() {
    const files = yield* ProviderFileSystem;
    const environment = yield* ProviderEnvironment;
    const auth = yield* files.readJson({
      path: authPath,
      providerID: COMMANDCODE_PROVIDER_ID,
    });
    return keyFromCommandCodeAuth(auth, environment.credential);
  }).pipe(
    Effect.catchCause(() => Effect.succeed<undefined>(globalThis.undefined))
  );
};

/**
 * Converts a millisecond epoch reset timestamp into a canonical instant.
 *
 * @param value - Provider-reported epoch milliseconds.
 * @returns A valid reset instant, or `null` when absent or invalid.
 */
const resetFromEpochMs = (
  value: JsonValue | undefined
): ResetInstant | null => {
  const parsed = parseUsageCount(value);
  return Result.isFailure(parsed)
    ? null
    : resetInstantOrNull(new Date(parsed.success));
};

/**
 * Builds one usage window from a Command Code credit bucket.
 *
 * Command Code reports credit spend as `used` against a `cap` rather than a
 * percentage, so the used percentage is derived from the ratio.
 *
 * @param value - `fiveHour` or `weekly` bucket from `windowLimits`.
 * @param kind - Normalized window kind.
 * @param label - Display label for the window.
 * @returns A normalized window, or `null` when the bucket is unusable.
 */
const commandCodeWindow = (
  value: JsonValue | undefined,
  kind: UsageWindow["kind"],
  label: string
): UsageWindow | null => {
  if (!isRecord(value)) {
    return null;
  }
  const parsedUsed = parseUsageCount(value.used);
  const parsedCap = parseUsageCount(value.cap);
  if (Result.isFailure(parsedUsed) || Result.isFailure(parsedCap)) {
    return null;
  }
  if (parsedCap.success <= 0) {
    return null;
  }
  const parsedPercent = parseUsagePercentage(
    Math.min(parsedUsed.success / parsedCap.success, 1) * 100
  );
  if (Result.isFailure(parsedPercent)) {
    return null;
  }
  return {
    kind,
    label,
    quota: percentageQuota(parsedPercent.success),
    resetsAt: resetFromEpochMs(value.resetAt),
  };
};

/**
 * Reads the credits spent in the current billing period.
 *
 * @param payload - Parsed `/alpha/usage/summary` payload, or null when the
 *   request failed.
 * @returns Non-negative spent credits, or `null` when unreported.
 */
const summarySpentCredits = (payload: JsonValue | null): number | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const spent = parseUsageCount(payload.totalCredits ?? payload.totalCost);
  return Result.isFailure(spent) ? null : spent.success;
};

/**
 * Builds the monthly credit window.
 *
 * Command Code exposes no monthly rate-limit bucket; the monthly view is the
 * plan's credit pool. The remaining pool is `monthlyCredits + purchasedCredits
 * + freeCredits` and the billing-period spend comes from the usage summary, so
 * the used percentage is `spent / (remaining + spent)`.
 *
 * @param credits - `credits` object from the billing payload.
 * @param spent - Credits spent this billing period, or null when unknown.
 * @returns A normalized monthly window, or `null` when no pool is reported.
 */
const commandCodeMonthlyWindow = (
  credits: JsonValue | undefined,
  spent: number | null
): UsageWindow | null => {
  if (!isRecord(credits)) {
    return null;
  }
  const monthly = parseUsageCount(credits.monthlyCredits);
  const purchased = parseUsageCount(credits.purchasedCredits);
  const free = parseUsageCount(credits.freeCredits);
  if (
    Result.isFailure(monthly) ||
    Result.isFailure(purchased) ||
    Result.isFailure(free)
  ) {
    return null;
  }
  const remaining = monthly.success + purchased.success + free.success;
  if (spent === null) {
    return {
      kind: "monthly",
      label: "monthly",
      quota: unknownQuota,
      resetsAt: null,
    };
  }
  const total = remaining + spent;
  if (total <= 0) {
    return null;
  }
  const parsedPercent = parseUsagePercentage((spent / total) * 100);
  if (Result.isFailure(parsedPercent)) {
    return null;
  }
  return {
    kind: "monthly",
    label: "monthly",
    quota: percentageQuota(parsedPercent.success),
    resetsAt: null,
  };
};

/**
 * Fetches and normalizes Command Code credit-window usage.
 *
 * Credential lookup checks, in order, the configured auth path, OpenCode auth,
 * and a configured literal or environment-backed API key.
 *
 * The account namespace is resolved once from `/alpha/whoami` and then carried
 * as an `orgId` scope on the billing and usage requests, so organization and
 * team accounts report the organization's credits instead of the personal
 * default. Identity is required: without it the scope would silently be wrong
 * for those accounts, so a failed `whoami` fails the whole fetch.
 *
 * @param config - Optional Command Code provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized Command Code usage data.
 * @throws {Error} When no API key is available or the provider response is invalid.
 */
const fetchCommandCodeUsageEffect = (
  config: CommandCodeProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"commandcode">["fetch"]> =>
  Effect.gen(function* runFetchCommandCodeUsage() {
    const environment = yield* ProviderEnvironment;
    const http = yield* ProviderHttpClient;
    const clock = yield* ProviderClock;
    const baseUrl = resolveHttpsBaseUrl(
      config?.baseUrl,
      DEFAULT_COMMANDCODE_BASE_URL
    );
    const isOfficialBaseUrl = baseUrl === DEFAULT_COMMANDCODE_BASE_URL;
    const configuredKey = environment.resolveCredential(config?.apiKey);
    const configuredFileKey = yield* readCommandCodeAuthPathKey(
      config?.authPath
    );
    const authKey = keyFromCommandCodeAuth(
      openCodeAuth,
      environment.credential
    );
    const apiKey =
      configuredFileKey ??
      (isOfficialBaseUrl ? (authKey ?? configuredKey) : configuredKey);
    if (!apiKey) {
      return yield* new MissingProviderCredentialsError({
        operation: "fetch-usage",
        providerID: COMMANDCODE_PROVIDER_ID,
      });
    }

    const whoami = yield* http.requestJson({
      headers: authorizedHeaders(apiKey),
      method: "GET",
      providerID: COMMANDCODE_PROVIDER_ID,
      timeoutMs,
      url: commandCodeUrl(baseUrl, COMMANDCODE_WHOAMI_PATH, { limits: "1" }),
    });
    if (whoamiReportsFailure(whoami)) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: COMMANDCODE_PROVIDER_ID,
      });
    }
    const orgId = orgIdFromWhoami(whoami);

    const payload = yield* http.requestJson({
      headers: authorizedHeaders(apiKey),
      method: "GET",
      providerID: COMMANDCODE_PROVIDER_ID,
      timeoutMs,
      url: commandCodeUrl(baseUrl, COMMANDCODE_CREDITS_PATH, { orgId }),
    });
    if (!isRecord(payload) || !isRecord(payload.windowLimits)) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: COMMANDCODE_PROVIDER_ID,
      });
    }

    const summary = yield* http
      .requestJson({
        headers: authorizedHeaders(apiKey),
        method: "GET",
        providerID: COMMANDCODE_PROVIDER_ID,
        timeoutMs,
        url: commandCodeUrl(baseUrl, COMMANDCODE_USAGE_SUMMARY_PATH, {
          orgId,
        }),
      })
      .pipe(Effect.catchCause(() => Effect.succeed<JsonValue | null>(null)));

    // SAFETY: windowLimits was validated as a record by the guard above.
    const limits = payload.windowLimits as ProviderPayload;
    const windows = [
      commandCodeWindow(limits.fiveHour, "rolling", "5h"),
      commandCodeWindow(limits.weekly, "weekly", "weekly"),
      commandCodeMonthlyWindow(payload.credits, summarySpentCredits(summary)),
    ].filter((window): window is UsageWindow => window !== null);
    if (windows.length === 0) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: COMMANDCODE_PROVIDER_ID,
      });
    }

    return {
      capturedAt: yield* clock.now,
      id: COMMANDCODE_PROVIDER_ID,
      label: config?.label ?? "Command Code",
      windows,
    };
  });

/** Stable Promise export for direct consumers of the provider adapter. */
export const fetchCommandCodeUsage = (
  config: CommandCodeProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"commandcode">> =>
  Effect.runPromise(
    fetchCommandCodeUsageEffect(config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

/** Plugin registration for the Command Code provider adapter. */
export const commandCodeProvider = {
  capabilities: { customBaseUrl: true, transport: "http" },
  configSchema: commandCodeProviderConfigSchema,
  defaultLabel: "Command Code",
  fetch: fetchCommandCodeUsageEffect,
  footerWindowKind: "rolling",
  id: COMMANDCODE_PROVIDER_ID,
  openCodeProviderIDs: [COMMANDCODE_PROVIDER_ID],
} as const satisfies ProviderDefinition<"commandcode">;
