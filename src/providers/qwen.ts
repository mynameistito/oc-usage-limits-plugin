import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderDefinition } from "@/providers/definition.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import { clampPercent, isRecord } from "@/utils.ts";

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
    const execErr = error as { code?: number; stdout?: string };
    const out = (execErr.stdout ?? "").trim();
    if (
      out &&
      allowNonZeroOutput &&
      typeof execErr.code === "number" &&
      execErr.code !== 0
    ) {
      return out;
    }
    // CLI stderr can contain verbose diagnostics or response bodies, so never
    // expose it in the user-facing error state.
    const exitCode =
      typeof execErr.code === "number" ? `exit code ${execErr.code}` : "failed";
    throw new Error(`qwencloud CLI ${exitCode}`, { cause: error });
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
    data = JSON.parse(raw) as unknown;
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object") {
    throw new Error("Invalid qwencloud usage response");
  }

  const tp = (data as Record<string, unknown>).token_plan;
  if (!tp || typeof tp !== "object") {
    return { subscribed: false as const };
  }

  const plan = tp as Record<string, unknown>;
  return {
    planName: typeof plan.planName === "string" ? plan.planName : undefined,
    remainingCredits:
      typeof plan.remainingCredits === "number"
        ? plan.remainingCredits
        : undefined,
    resetDate: typeof plan.resetDate === "string" ? plan.resetDate : undefined,
    status: typeof plan.status === "string" ? plan.status : undefined,
    subscribed: plan.subscribed === true,
    totalCredits:
      typeof plan.totalCredits === "number" ? plan.totalCredits : undefined,
    usedPct: typeof plan.usedPct === "number" ? plan.usedPct : undefined,
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
  tp: ReturnType<typeof parseTokenPlan>,
  now: Date
): UsageWindow | null => {
  if (!tp.subscribed) {
    return null;
  }

  const { usedPct } = tp;
  if (typeof usedPct !== "number") {
    return null;
  }

  const used = clampPercent(usedPct);
  const remainingPercent = 100 - used;

  let resetsAt: Date | null = null;
  let resetAfterSeconds: number | null = null;
  if (tp.resetDate) {
    const parsed = new Date(tp.resetDate);
    if (!Number.isNaN(parsed.getTime())) {
      resetsAt = parsed;
      resetAfterSeconds = Math.max(
        0,
        Math.ceil((parsed.getTime() - now.getTime()) / 1000)
      );
    }
  }

  return {
    current:
      tp.totalCredits !== undefined && tp.remainingCredits !== undefined
        ? tp.totalCredits - tp.remainingCredits
        : undefined,
    label: "credits",
    remainingPercent,
    resetAfterSeconds,
    resetsAt,
    total: tp.totalCredits,
    usedPercent: used,
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
  ): Promise<ProviderUsage> => {
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
      throw new Error(
        `qwencloud CLI not available (${msg}). Install: npm i -g @qwencloud/qwencloud-cli and run: qwencloud auth login`,
        { cause: error }
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
      throw new Error(
        `qwencloud usage query failed (${msg}). Verify the CLI is authenticated and try again.`,
        { cause: error }
      );
    }
    const tp = parseTokenPlan(usageRaw);

    if (!tp.subscribed) {
      throw new Error(
        "No subscription detected. Verify at home.qwencloud.com/billing"
      );
    }

    const capturedAt = dependencies.now();
    const window = buildQwenWindow(tp, capturedAt);
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
