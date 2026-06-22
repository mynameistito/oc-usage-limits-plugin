import { limitLabelForWindow } from "@/format.ts";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import { clampPercent, fetchJson, isRecord, readJsonFile } from "@/utils.ts";

/** Default ChatGPT backend base URL used for Codex usage requests. */
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

/**
 * Reads Codex credentials from the Codex CLI auth file.
 *
 * @param authPath - Optional path override. Defaults to `~/.codex/auth.json`.
 * @returns Access token and ChatGPT account ID required by the Codex usage API.
 * @throws {Error} When the auth file is missing or does not contain credentials.
 * @throws {TypeError} When the auth file contains credentials with invalid types.
 */
const readCodexAuthFile = async (
  authPath: string | undefined
): Promise<{ access: string; accountId: string }> => {
  const auth = await readJsonFile<unknown>(authPath ?? "~/.codex/auth.json");
  if (!isRecord(auth) || !isRecord(auth.tokens)) {
    throw new Error("missing Codex auth");
  }

  const access = auth.tokens.access_token;
  const accountId = auth.tokens.account_id;
  if (typeof access !== "string" || typeof accountId !== "string") {
    throw new TypeError("invalid Codex credential types");
  }

  return { access, accountId };
};

/**
 * Converts a raw Codex rate-limit window into the plugin's normalized shape.
 *
 * @param value - Unknown `primary_window` or `secondary_window` payload.
 * @param fallback - Label used when the provider does not report a known window
 *   length.
 * @returns A normalized usage window, or `null` for invalid payloads.
 */
const codexWindow = (value: unknown, fallback: string): UsageWindow | null => {
  if (!isRecord(value)) {
    return null;
  }

  const used =
    typeof value.used_percent === "number"
      ? clampPercent(value.used_percent)
      : null;
  const resetAfter =
    typeof value.reset_after_seconds === "number"
      ? value.reset_after_seconds
      : null;
  const windowSeconds =
    typeof value.limit_window_seconds === "number"
      ? value.limit_window_seconds
      : 0;
  const resetAt =
    typeof value.reset_at === "number" && value.reset_at > 0
      ? new Date(value.reset_at * 1000)
      : null;

  return {
    label:
      windowSeconds > 0
        ? limitLabelForWindow(windowSeconds, fallback)
        : fallback,
    remainingPercent: used === null ? null : 100 - used,
    resetAfterSeconds: resetAfter,
    resetsAt: resetAt,
    usedPercent: used,
  };
};

/**
 * Fetches and normalizes Codex usage limits.
 *
 * Credentials are read from OpenCode auth when available, otherwise from the
 * Codex CLI auth file. The returned windows represent the primary and secondary
 * Codex rate-limit windows reported by ChatGPT's backend API.
 *
 * @param config - Optional Codex provider configuration.
 * @param openCodeAuth - Shared OpenCode auth payload.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Normalized Codex usage data.
 * @throws {Error} When credentials are missing or the provider response is invalid.
 */
export const fetchCodexUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const { openai } = openCodeAuth;
  const credentials =
    typeof openai?.access === "string" &&
    openai.access.trim() !== "" &&
    typeof openai.accountId === "string" &&
    openai.accountId.trim() !== ""
      ? { access: openai.access, accountId: openai.accountId }
      : await readCodexAuthFile(config?.authPath);

  const baseUrl = config?.baseUrl ?? DEFAULT_CODEX_BASE_URL;
  const payload = await fetchJson(
    `${baseUrl.replace(/\/$/u, "")}/wham/usage`,
    {
      headers: {
        Authorization: `Bearer ${credentials.access}`,
        "ChatGPT-Account-Id": credentials.accountId,
        "User-Agent": "opencode-usage-limits",
      },
      method: "GET",
    },
    timeoutMs
  );

  if (!isRecord(payload)) {
    throw new Error("invalid Codex usage");
  }

  const rateLimit = isRecord(payload.rate_limit)
    ? payload.rate_limit
    : undefined;
  const windows = [
    codexWindow(rateLimit?.primary_window, "usage"),
    codexWindow(rateLimit?.secondary_window, "secondary"),
  ].filter((item): item is UsageWindow => item !== null);
  const resetCredits =
    isRecord(payload.rate_limit_reset_credits) &&
    typeof payload.rate_limit_reset_credits.available_count === "number"
      ? payload.rate_limit_reset_credits.available_count
      : null;

  return {
    capturedAt: new Date(),
    id: "codex",
    label: config?.label ?? "Codex",
    metadata: { resetCredits },
    tierName:
      typeof payload.plan_type === "string" ? payload.plan_type : undefined,
    windows,
  };
};
