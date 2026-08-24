import { Effect, Redacted, Result } from "effect";

import { openCodeGoProviderConfigSchema } from "@/config-schema.ts";
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
  OpenCodeGoProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import {
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "@/usage.ts";
import { isRecord } from "@/utils.ts";
import type { JsonValue } from "@/utils.ts";
import { resolveHttpsBaseUrl } from "@/utils/url.ts";

/** Default OpenCode GO API base URL. */
const DEFAULT_OPEN_CODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const OPENCODE_GO_PROVIDER_ID = "opencode-go" as const;
const DECODE_RESPONSE = "decode-response";
type AuthCredential = JsonValue;

const keyFromAuth = (
  value: OpenCodeAuth | JsonValue,
  credential: (
    value: JsonValue | Redacted.Redacted<string> | undefined
  ) => Redacted.Redacted<string> | undefined
): Redacted.Redacted<string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const entry of [value[OPENCODE_GO_PROVIDER_ID], value.opencode]) {
    if (!isRecord(entry)) {
      continue;
    }
    const key = credential(entry.key) ?? credential(entry.apiKey);
    if (key) {
      return key;
    }
  }
  return credential(value.key) ?? credential(value.apiKey);
};

const readAuthPathKey = (
  authPath: string | undefined
): Effect.Effect<
  Redacted.Redacted<string> | undefined,
  never,
  ProviderEnvironment | ProviderFileSystem
> => {
  if (!authPath) {
    return Effect.succeed<undefined>(globalThis.undefined);
  }
  return Effect.gen(function* readOpenCodeGoAuthPathKey() {
    const files = yield* ProviderFileSystem;
    const environment = yield* ProviderEnvironment;
    const auth = yield* files.readJson({
      path: authPath,
      providerID: OPENCODE_GO_PROVIDER_ID,
    });
    return keyFromAuth(auth, environment.credential);
  }).pipe(
    Effect.catchCause(() => Effect.succeed<undefined>(globalThis.undefined))
  );
};

const usageWindow = (
  value: AuthCredential | undefined,
  kind: UsageWindow["kind"],
  label: string
): UsageWindow | null => {
  if (!isRecord(value)) {
    return null;
  }
  const percent = parseUsagePercentage(value.percent);
  if (Result.isFailure(percent)) {
    return null;
  }
  return {
    kind,
    label,
    quota: percentageQuota(percent.success),
    resetsAt: resetInstantOrNull(value.resetsAt),
  };
};

/** Fetches and normalizes OpenCode GO usage windows. */
const fetchOpenCodeGoUsageEffect = (
  config: OpenCodeGoProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"opencode-go">["fetch"]> =>
  Effect.gen(function* runFetchOpenCodeGoUsage() {
    const environment = yield* ProviderEnvironment;
    const http = yield* ProviderHttpClient;
    const clock = yield* ProviderClock;
    const baseUrl = resolveHttpsBaseUrl(
      config?.baseUrl,
      DEFAULT_OPEN_CODE_GO_BASE_URL
    );
    const officialHost = new URL(baseUrl).hostname === "opencode.ai";
    const authPathKey = yield* readAuthPathKey(config?.authPath);
    const configuredKey = environment.resolveCredential(config?.apiKey);
    const authKey = keyFromAuth(openCodeAuth, environment.credential);
    const apiKey =
      authPathKey ??
      (officialHost ? (authKey ?? configuredKey) : configuredKey);
    if (!apiKey) {
      return yield* new MissingProviderCredentialsError({
        operation: "fetch-usage",
        providerID: OPENCODE_GO_PROVIDER_ID,
      });
    }

    const payload = yield* http.requestJson({
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${Redacted.value(apiKey)}`,
      },
      method: "GET",
      providerID: OPENCODE_GO_PROVIDER_ID,
      timeoutMs,
      url: `${baseUrl}/usage`,
    });
    if (!isRecord(payload) || !isRecord(payload.usage)) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: OPENCODE_GO_PROVIDER_ID,
      });
    }

    const windows = [
      usageWindow(payload.usage.rolling, "rolling", "rolling"),
      usageWindow(payload.usage.weekly, "weekly", "weekly"),
      usageWindow(payload.usage.monthly, "monthly", "monthly"),
    ].filter((window): window is UsageWindow => window !== null);
    if (windows.length === 0) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
        providerID: OPENCODE_GO_PROVIDER_ID,
      });
    }

    return {
      capturedAt: yield* clock.now,
      id: OPENCODE_GO_PROVIDER_ID,
      label: config?.label ?? "OpenCode GO",
      windows,
    };
  });

/** Stable Promise export for direct consumers of the provider adapter. */
export const fetchOpenCodeGoUsage = (
  config: OpenCodeGoProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage<"opencode-go">> =>
  Effect.runPromise(
    fetchOpenCodeGoUsageEffect(config, openCodeAuth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    )
  );

/** Plugin registration for the OpenCode GO provider adapter. */
export const openCodeGoProvider = {
  capabilities: { customBaseUrl: true, transport: "http" },
  configSchema: openCodeGoProviderConfigSchema,
  defaultLabel: "OpenCode GO",
  fetch: fetchOpenCodeGoUsageEffect,
  footerWindowKind: "rolling",
  id: OPENCODE_GO_PROVIDER_ID,
  openCodeProviderIDs: [OPENCODE_GO_PROVIDER_ID],
} as const satisfies ProviderDefinition<"opencode-go">;
