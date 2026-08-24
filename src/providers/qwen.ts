import { Effect, Result, Schema } from "effect";

import { qwenProviderConfigSchema } from "@/config-schema.ts";
import {
  MissingProviderCredentialsError,
  ProviderResponseDecodeError,
} from "@/errors.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
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
const DECODE_RESPONSE = "decode-response";
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeNumber = Schema.decodeUnknownOption(Schema.Number);

interface QwenTokenPlan {
  readonly planName?: string;
  readonly remainingCredits?: number;
  readonly resetDate?: string;
  readonly status?: string;
  readonly subscribed: boolean;
  readonly totalCredits?: number;
  readonly usedPct?: number;
}

interface CommandFailure {
  readonly code?: number | string;
}

const safeCommandCause = (error: Error | CommandFailure): Error => {
  const record = isRecord(error) ? error : {};
  const { code } = record;
  const suffix = code === undefined ? "failed" : `exit code ${String(code)}`;
  return new Error(`qwencloud CLI ${suffix}`);
};

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
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse qwencloud auth status");
  }

  if (!isRecord(data)) {
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
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse qwencloud usage response");
  }
  if (!isRecord(data)) {
    throw new Error("Invalid qwencloud usage response");
  }

  const tp = data.token_plan;
  if (!isRecord(tp)) {
    return { subscribed: false as const };
  }

  return {
    planName:
      String(tp.planName) === "undefined" ? undefined : String(tp.planName),
    remainingCredits: Number.isFinite(Number(tp.remainingCredits))
      ? Number(tp.remainingCredits)
      : undefined,
    resetDate:
      String(tp.resetDate) === "undefined" ? undefined : String(tp.resetDate),
    status: String(tp.status) === "undefined" ? undefined : String(tp.status),
    subscribed: tp.subscribed === true,
    totalCredits: Number.isFinite(Number(tp.totalCredits))
      ? Number(tp.totalCredits)
      : undefined,
    usedPct: (() => {
      const parsed = decodeNumber(tp.usedPct);
      return parsed._tag === "Some" ? parsed.value : Number.NaN;
    })(),
  };
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
const buildQwenWindow = (
  tp: ReturnType<typeof parseTokenPlan>
): UsageWindow | null => {
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
          operation: DECODE_RESPONSE,
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
          operation: DECODE_RESPONSE,
          providerID: "qwen",
        }),
      try: () => parseTokenPlan(usageRaw),
    });
    const window = buildQwenWindow(tokenPlan);
    if (!tokenPlan.subscribed || !window) {
      return yield* new ProviderResponseDecodeError({
        cause: "schema",
        operation: DECODE_RESPONSE,
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
        const record = isRecord(error) ? error : {};
        const { code } = record;
        const parsedStdout = decodeString(record.stdout);
        const parsedCode = decodeNumber(code);
        const stdout =
          parsedStdout._tag === "Some" ? parsedStdout.value.trim() : "";
        if (
          allowNonZero &&
          stdout &&
          parsedCode._tag === "Some" &&
          parsedCode.value !== 0
        ) {
          return stdout;
        }
        throw safeCommandCause(error instanceof Error ? error : {});
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
