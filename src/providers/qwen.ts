import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Result } from "effect";

import type { ProviderDefinition } from "@/providers/definition.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
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

const execFileAsync = promisify(execFile);

/** Subprocess boundary used by the Qwen provider adapter. */
export type QwenCommandRunner = (
  cli: string,
  args: string[],
  timeoutMs: number
) => Promise<string>;

const productionCommandRunner: QwenCommandRunner = async (
  cli,
  args,
  timeoutMs
) => {
  const { stdout } = await execFileAsync(cli, args, {
    encoding: "utf-8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return stdout;
};

/** Default CLI command used when no override is configured. */
const DEFAULT_CLI = "qwencloud";

const commandExitCode = (error: unknown): number | undefined => {
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.code === "number" && Number.isFinite(error.code)
    ? error.code
    : undefined;
};

const commandStdout = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.stdout === "string"
    ? error.stdout.trim()
    : undefined;

/**
 * Runs the QwenCloud CLI and captures stdout.
 *
 * Diagnostics written to stderr are ignored unless stdout is empty — the CLI
 * writes human-facing progress and warnings to stderr on normal runs.
 *
 * @param cli  - CLI binary or command name.
 * @param args - CLI arguments (without the program name).
 * @param timeoutMs - Maximum execution time in milliseconds.
 * @param allowNonZeroOutput - Whether stdout from a failed command is valid.
 * @returns The stdout output of the CLI.
 */
const runQwencloud = async (
  commandRunner: QwenCommandRunner,
  cli: string,
  args: string[],
  timeoutMs: number,
  allowNonZeroOutput = false
): Promise<string> => {
  try {
    const output = await commandRunner(cli, args, timeoutMs);
    return output.trim();
  } catch (error) {
    // execFile rejects on non-zero exit. The CLI writes usage/auth data to
    // stdout even when returning exit code 2 (not authenticated) or 1 (usage
    // error), so read stdout from the error object before re-throwing.
    const exitCode = commandExitCode(error);
    const out = commandStdout(error);
    if (out && allowNonZeroOutput && exitCode !== undefined && exitCode !== 0) {
      return out;
    }
    // CLI stderr can contain verbose diagnostics or response bodies, so never
    // expose it in the user-facing error state.
    const safeStatus =
      exitCode === undefined ? "failed" : `exit code ${exitCode}`;
    // oxlint-disable-next-line preserve-caught-error -- SECURITY: Subprocess errors can retain stdout, stderr, and response bodies.
    throw new Error(`qwencloud CLI ${safeStatus}`);
  }
};

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
const parseTokenPlan = (raw: string) => {
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
    planName: typeof tp.planName === "string" ? tp.planName : undefined,
    remainingCredits:
      typeof tp.remainingCredits === "number" ? tp.remainingCredits : undefined,
    resetDate: typeof tp.resetDate === "string" ? tp.resetDate : undefined,
    status: typeof tp.status === "string" ? tp.status : undefined,
    subscribed: tp.subscribed === true,
    totalCredits:
      typeof tp.totalCredits === "number" ? tp.totalCredits : undefined,
    usedPct: typeof tp.usedPct === "number" ? tp.usedPct : undefined,
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

/** Dependencies for constructing a Qwen provider adapter. */
export interface QwenProviderDependencies {
  /** Runs a QwenCloud subprocess command. */
  commandRunner: QwenCommandRunner;
  /** Returns the current wall-clock time. */
  now: () => Date;
}

/**
 * Creates a Qwen provider adapter with explicit subprocess and clock boundaries.
 *
 * @param dependencies - Runtime dependencies for CLI execution and timestamps.
 * @returns A Qwen provider definition.
 */
export const createQwenProvider = (
  dependencies: QwenProviderDependencies
): ProviderDefinition<"qwen"> => {
  /** Fetches and normalizes Qwen Token Plan usage via the QwenCloud CLI. */
  const fetchQwenTokenPlanUsage = async (
    config: ProviderConfig | undefined,
    _openCodeAuth: OpenCodeAuth,
    timeoutMs: number
  ): Promise<ProviderUsage<"qwen">> => {
    const cli = DEFAULT_CLI;

    let authRaw: string;
    try {
      authRaw = await runQwencloud(
        dependencies.commandRunner,
        cli,
        ["auth", "status", "--format", "json"],
        timeoutMs,
        true
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // oxlint-disable-next-line preserve-caught-error -- SECURITY: Keep the classified message, not the subprocess cause graph.
      throw new Error(
        `qwencloud CLI not available (${msg}). Install: npm i -g @qwencloud/qwencloud-cli and run: qwencloud auth login`
      );
    }

    if (!parseAuthStatus(authRaw)) {
      throw new Error("Not authenticated. Run: qwencloud auth login");
    }

    let usageRaw: string;
    try {
      usageRaw = await runQwencloud(
        dependencies.commandRunner,
        cli,
        ["usage", "summary", "--format", "json"],
        timeoutMs
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // oxlint-disable-next-line preserve-caught-error -- SECURITY: Keep the classified message, not the subprocess cause graph.
      throw new Error(
        `qwencloud usage query failed (${msg}). Verify the CLI is authenticated and try again.`
      );
    }
    const tp = parseTokenPlan(usageRaw);

    if (!tp.subscribed) {
      throw new Error(
        "No subscription detected. Verify at home.qwencloud.com/billing"
      );
    }

    const capturedAt = dependencies.now();
    const window = buildQwenWindow(tp);
    if (!window) {
      throw new Error("invalid Qwen usage");
    }

    return {
      capturedAt,
      id: "qwen",
      label: config?.label ?? tp.planName ?? "Qwen Token Plan",
      windows: [window],
    };
  };

  return {
    defaultLabel: "Qwen",
    fetch: fetchQwenTokenPlanUsage,
    footerWindowLabel: "credits",
    id: "qwen",
    openCodeProviderIDs: ["bailian-token-plan-personal", "qwen"],
  };
};

/** Plugin registration for the Qwen Token Plan provider adapter. */
export const qwenProvider = createQwenProvider({
  commandRunner: productionCommandRunner,
  now: () => new Date(),
});
