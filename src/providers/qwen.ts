import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderDefinition } from "@/providers/definition.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import { clampPercent } from "@/utils.ts";

const execFileAsync = promisify(execFile);

/** Default CLI command used when no override is configured. */
const DEFAULT_CLI = "qwencloud";

/**
 * Minimal parsed auth-status subset — only the fields the provider needs.
 *
 * The CLI `auth status` response contains additional fields and may vary across
 * versions; this type only describes what this provider consumes.
 */
interface QwencloudAuthStatus {
  authenticated?: boolean;
  server_verified?: boolean;
}

/**
 * Runs the QwenCloud CLI and captures stdout.
 *
 * Diagnostics written to stderr are ignored unless stdout is empty — the CLI
 * writes human-facing progress and warnings to stderr on normal runs.
 *
 * @param cli  - CLI binary or command name.
 * @param args - CLI arguments (without the program name).
 * @param timeoutMs - Maximum execution time in milliseconds.
 * @returns The stdout output of the CLI.
 */
const runQwencloud = async (
  cli: string,
  args: string[],
  timeoutMs: number
): Promise<string> => {
  try {
    const { stdout } = (await execFileAsync(cli, args, {
      maxBuffer: 2 * 1024 * 1024,
      timeout: timeoutMs,
    })) as { stdout: string };
    return stdout.trim();
  } catch (error) {
    // execFile rejects on non-zero exit. The CLI writes usage/auth data to
    // stdout even when returning exit code 2 (not authenticated) or 1 (usage
    // error), so read stdout from the error object before re-throwing.
    const execErr = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    const out = (execErr.stdout ?? "").trim();
    if (out) {
      return out;
    }
    // No stdout → genuine spawn failure (binary missing, timeout, etc.)
    const msg =
      execErr.stderr?.trim() || `exit code ${execErr.code ?? "unknown"}`;
    throw new Error(msg, { cause: error });
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
  let data: QwencloudAuthStatus;
  try {
    data = JSON.parse(raw) as QwencloudAuthStatus;
  } catch {
    throw new Error("Failed to parse qwencloud auth status");
  }

  return data.authenticated === true && data.server_verified !== false;
};

/**
 * Parses the Token Plan snapshot from the JSON output of
 * `qwencloud usage summary --format json`.
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
  tp: ReturnType<typeof parseTokenPlan>
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
    resetsAt = new Date(tp.resetDate);
    const diff = resetsAt.getTime() - Date.now();
    resetAfterSeconds = Math.max(0, Math.ceil(diff / 1000));
  }

  return {
    current: tp.remainingCredits,
    label: "credits",
    remainingPercent,
    resetAfterSeconds,
    resetsAt,
    total: tp.totalCredits,
    usedPercent: used,
  };
};

/**
 * Fetches and normalizes Qwen Token Plan usage limits via the QwenCloud CLI.
 *
 * The CLI must be installed (`@qwencloud/qwencloud-cli`) and authenticated via
 * `qwencloud auth login` (OAuth2 device-flow). The provider shells out to the
 * CLI asynchronously, so it does **not** require a separate management API key
 * — the CLI handles credential storage and renewal.
 *
 * @param config - Optional Qwen provider configuration.  Set `baseUrl` to
 *   override the CLI path (default `"qwencloud"`). `apiKey` is ignored.
 * @param _openCodeAuth - Unused; Qwen credentials live in the CLI keychain.
 * @param timeoutMs - Subprocess timeout in milliseconds (capped by the CLI).
 * @returns Normalized Qwen Token Plan usage data.
 * @throws {Error} When the CLI is not installed, not authenticated, or the
 *   account has no active Token Plan subscription.
 */
export const fetchQwenTokenPlanUsage = async (
  config: ProviderConfig | undefined,
  _openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const cli = config?.baseUrl || DEFAULT_CLI;

  let authRaw: string;
  try {
    authRaw = await runQwencloud(
      cli,
      ["auth", "status", "--format", "json"],
      timeoutMs
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

  const usageRaw = await runQwencloud(
    cli,
    ["usage", "summary", "--format", "json"],
    timeoutMs
  );
  const tp = parseTokenPlan(usageRaw);

  if (!tp.subscribed) {
    throw new Error(
      "No subscription detected. Verify at home.qwencloud.com/billing"
    );
  }

  const window = buildQwenWindow(tp);
  if (!window) {
    throw new Error("invalid Qwen usage");
  }

  return {
    capturedAt: new Date(),
    id: "qwen",
    label: config?.label ?? tp.planName ?? "Qwen Token Plan",
    windows: [window],
  };
};

/** Plugin registration for the Qwen Token Plan provider adapter. */
export const qwenProvider = {
  defaultLabel: "Qwen",
  fetch: fetchQwenTokenPlanUsage,
  footerWindowLabel: "credits",
  id: "qwen",
  openCodeProviderIDs: ["bailian-token-plan-personal", "qwen"],
} as const satisfies ProviderDefinition<"qwen">;
