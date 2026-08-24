import { Effect, Result } from "effect";

import { qwenProviderConfigSchema } from "@/config-schema.ts";
import {
  MissingProviderCredentialsError,
  ProviderResponseDecodeError,
} from "@/errors.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import { isJsonBoolean, isJsonNumber, isJsonString } from "@/providers/json.ts";
import { ProviderClock } from "@/providers/runtime/clock.ts";
import { ProviderCommandExecutor } from "@/providers/runtime/command.ts";
import type {
  OpenCodeAuth,
  QwenProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
  resetInstantOrNull,
} from "@/usage.ts";
import { isRecord } from "@/utils.ts";

/** Default CLI command used when no override is configured. */
const DEFAULT_CLI = "qwencloud";
const DECODE_RESPONSE_OPERATION = "decode-response";

interface QwenAuthPayload {
  readonly authenticated?: boolean;
  readonly server_verified?: boolean;
}
interface QwenTokenPlan {
  readonly planName?: string;
  readonly remainingCredits?: number;
  readonly resetDate?: string;
  readonly status?: string;
  readonly subscribed: boolean;
  readonly totalCredits?: number;
  readonly usedPct?: number;
}
interface QwenUsagePayload {
  readonly token_plan?: QwenTokenPlanPayload;
}
interface QwenCommandError extends Error {
  readonly code?: number | string;
  readonly stdout?: string;
}
interface QwenTokenPlanPayload {
  readonly planName?: string;
  readonly remainingCredits?: number;
  readonly resetDate?: string;
  readonly status?: string;
  readonly subscribed: boolean;
  readonly totalCredits?: number;
  readonly usedPct?: number;
}

const safeCommandCause = (error: QwenCommandError): Error => {
  const code =
    isJsonNumber(error.code) || isJsonString(error.code)
      ? error.code
      : undefined;
  const suffix = code === undefined ? "failed" : `exit code ${code}`;
  return new Error(`qwencloud CLI ${suffix}`);
};

const commandError = (error: Error): QwenCommandError =>
  // SAFETY: command runners attach these optional fields to Error instances.
  error as QwenCommandError;

/** Legacy injectable Qwen command boundary retained for direct consumers. */
export type QwenCommandRunner = (
  cli: string,
  args: string[],
  timeoutMs: number
) => Promise<string>;

/** Dependencies for constructing a direct Qwen adapter. */
export interface QwenProviderDependencies {
  readonly commandRunner: QwenCommandRunner;
  readonly now: () => Date;
}

/**
 * Parses the JSON output of `qwencloud auth status --format json` and returns
 * the boolean authentication state.
 *
 * @param raw - Raw stdout JSON from the CLI.
 * @returns `true` when the CLI reports authenticated credentials.
 */
const parseAuthStatus = (raw: string): boolean => {
  let data: QwenAuthPayload;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error("not an object");
    }
    data = {
      authenticated:
        isJsonBoolean(parsed.authenticated) && parsed.authenticated,
      server_verified:
        !isJsonBoolean(parsed.server_verified) || parsed.server_verified,
    };
  } catch {
    throw new Error("Failed to parse qwencloud auth status");
  }

  return data.authenticated === true && data.server_verified !== false;
};

/**
 * Parses the Token Plan snapshot from the JSON output of
 * `qwencloud usage summary --format json`.
 *
 * Note: `subscription tokenplan status` is a Team-only command (marked
 * "Token Plan Team Edition" in the CLI source). Individual plans are only
 * reported through `usage summary`'s `token_plan` field.
 *
 * The CLI includes `free_tier`, `coding_plan`, `token_plan`, and
 * `pay_as_you_go` sections. This function extracts only the Token Plan
 * payload.
 *
 * @param raw - Raw stdout JSON from the CLI.
 * @returns The parsed Token Plan snapshot.
 */
const parseTokenPlan = (raw: string): QwenTokenPlan => {
  let data: QwenUsagePayload;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error("not an object");
    }
    const tokenPlan = isRecord(parsed.token_plan)
      ? parsed.token_plan
      : undefined;
    data = {
      token_plan: tokenPlan
        ? {
            planName: isJsonString(tokenPlan.planName)
              ? tokenPlan.planName
              : undefined,
            remainingCredits: isJsonNumber(tokenPlan.remainingCredits)
              ? tokenPlan.remainingCredits
              : undefined,
            resetDate: isJsonString(tokenPlan.resetDate)
              ? tokenPlan.resetDate
              : undefined,
            status: isJsonString(tokenPlan.status)
              ? tokenPlan.status
              : undefined,
            subscribed: tokenPlan.subscribed === true,
            totalCredits: isJsonNumber(tokenPlan.totalCredits)
              ? tokenPlan.totalCredits
              : undefined,
            usedPct: isJsonNumber(tokenPlan.usedPct)
              ? tokenPlan.usedPct
              : undefined,
          }
        : undefined,
    };
  } catch {
    throw new Error("Failed to parse qwencloud usage response");
  }
  const tp = data.token_plan;
  if (!isRecord(tp)) {
    return { subscribed: false as const };
  }

  return tp;
};

/**
 * Constructs a single usage window from a parsed Token Plan snapshot.
 *
 * Qwen Token Plan reports a single aggregate Credits balance that covers all
 * models. The window uses the `"credits"` label and reports the percentage
 * consumed, seconds until the subscription reset, and absolute counts when
 * available.
 *
 * @param tp - Parsed Token Plan data.
 * @returns A normalized usage window, or `null` when no percentage is reported.
 */
const buildQwenWindow = (tp: QwenTokenPlan): UsageWindow | null => {
  if (!tp.subscribed) {
    return null;
  }

  const parsedUsed = parseUsagePercentage(tp.usedPct);
  if (Result.isFailure(parsedUsed)) {
    return null;
  }

  let resetsAt: Date | null = null;
  if (tp.resetDate) {
    const parsed = new Date(tp.resetDate);
    if (!Number.isNaN(parsed.getTime())) {
      resetsAt = resetInstantOrNull(parsed);
    }
  }

  const parsedTotal = parseUsageCount(tp.totalCredits);
  const parsedRemaining = parseUsageCount(tp.remainingCredits);
  const parsedCurrent =
    Result.isSuccess(parsedTotal) &&
    Result.isSuccess(parsedRemaining) &&
    parsedRemaining.success <= parsedTotal.success
      ? parseUsageCount(parsedTotal.success - parsedRemaining.success)
      : undefined;

  return {
    kind: "credits",
    label: "credits",
    quota:
      Result.isSuccess(parsedTotal) &&
      parsedCurrent !== undefined &&
      Result.isSuccess(parsedCurrent)
        ? countQuota(
            parsedCurrent.success,
            parsedTotal.success,
            parsedUsed.success
          )
        : percentageQuota(parsedUsed.success),
    resetsAt,
  };
};

/**
 * Fetches and normalizes Qwen Token Plan usage through the runtime command layer.
 */
const fetchQwenTokenPlanUsage = (
  config: QwenProviderConfig | undefined,
  _openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): ReturnType<ProviderDefinition<"qwen">["fetch"]> =>
  Effect.gen(function* runFetchQwenTokenPlanUsage() {
    const commands = yield* ProviderCommandExecutor;
    const clock = yield* ProviderClock;
    const authRaw = yield* commands.execute({
      acceptedExitCodes: new Set([2]),
      args: ["auth", "status", "--format", "json"],
      command: DEFAULT_CLI,
      providerID: "qwen",
      timeoutMs,
    });
    const authenticated = yield* Effect.try({
      catch: () =>
        new ProviderResponseDecodeError({
          cause: "decode",
          operation: DECODE_RESPONSE_OPERATION,
          providerID: "qwen",
        }),
      try: () => parseAuthStatus(authRaw),
    });
    if (!authenticated) {
      return yield* new MissingProviderCredentialsError({
        operation: "run-command",
        providerID: "qwen",
      });
    }

    const usageRaw = yield* commands.execute({
      args: ["usage", "summary", "--format", "json"],
      command: DEFAULT_CLI,
      providerID: "qwen",
      timeoutMs,
    });
    const tokenPlan = yield* Effect.try({
      catch: () =>
        new ProviderResponseDecodeError({
          cause: "decode",
          operation: DECODE_RESPONSE_OPERATION,
          providerID: "qwen",
        }),
      try: () => parseTokenPlan(usageRaw),
    });
    const window = buildQwenWindow(tokenPlan);
    if (!tokenPlan.subscribed || !window) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE_OPERATION,
        providerID: "qwen",
      });
    }

    return {
      capturedAt: yield* clock.now,
      id: "qwen",
      label: config?.label ?? tokenPlan.planName ?? "Qwen Token Plan",
      windows: [window],
    };
  });

/** Stable injectable Promise adapter retained for existing direct consumers. */
export const createQwenProvider = (dependencies: QwenProviderDependencies) => ({
  fetch: async (
    config: QwenProviderConfig | undefined,
    _openCodeAuth: OpenCodeAuth,
    timeoutMs: number
  ): Promise<ProviderUsage<"qwen">> => {
    const run = async (
      args: string[],
      allowNonZero = false
    ): Promise<string> => {
      try {
        const output = await dependencies.commandRunner(
          DEFAULT_CLI,
          args,
          timeoutMs
        );
        return output.trim();
      } catch (error) {
        const parsed = error instanceof Error ? commandError(error) : undefined;
        const code =
          parsed && isJsonNumber(parsed.code) ? parsed.code : undefined;
        const stdout =
          parsed && isJsonString(parsed.stdout) ? parsed.stdout.trim() : "";
        if (allowNonZero && stdout && code !== undefined && code !== 0) {
          return stdout;
        }
        throw safeCommandCause(parsed ?? new Error("command failed"));
      }
    };
    let authRaw: string;
    try {
      authRaw = await run(["auth", "status", "--format", "json"], true);
    } catch (error) {
      throw new Error("qwencloud CLI not available (qwencloud CLI failed)", {
        cause: error,
      });
    }
    const auth = parseAuthStatus(authRaw);
    if (!auth) {
      throw new Error("Not authenticated. Run: qwencloud auth login");
    }

    let usageRaw: string;
    try {
      usageRaw = await run(["usage", "summary", "--format", "json"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      throw new Error(`qwencloud usage query failed (${message})`, {
        cause: error,
      });
    }
    const tokenPlan = parseTokenPlan(usageRaw);
    if (!tokenPlan.subscribed) {
      throw new Error(
        "No subscription detected. Verify at home.qwencloud.com/billing"
      );
    }
    const window = buildQwenWindow(tokenPlan);
    if (!window) {
      throw new Error("invalid Qwen usage");
    }
    return {
      capturedAt: dependencies.now(),
      id: "qwen",
      label: config?.label ?? tokenPlan.planName ?? "Qwen Token Plan",
      windows: [window],
    };
  },
});

/** Plugin registration for the Qwen Token Plan provider adapter. */
export const qwenProvider = {
  capabilities: { customBaseUrl: false, transport: "command" },
  configSchema: qwenProviderConfigSchema,
  defaultLabel: "Qwen",
  fetch: fetchQwenTokenPlanUsage,
  footerWindowKind: "credits",
  id: "qwen",
  openCodeProviderIDs: ["bailian-token-plan-personal", "qwen"],
} as const satisfies ProviderDefinition<"qwen">;
