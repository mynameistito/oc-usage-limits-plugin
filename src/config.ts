import { homedir } from "node:os";
import path from "node:path";

import type { OpenCodeAuth, UsageLimitsConfig } from "@/types.ts";
import { readJsonFile } from "@/utils.ts";

/** Default user configuration path for this plugin. */
const CONFIG_PATH = path.join(
  homedir(),
  ".config",
  "opencode",
  "usage-limits.jsonc"
);
/** Default OpenCode auth path shared by installed providers. */
const OPENCODE_AUTH_PATH = path.join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "auth.json"
);

/**
 * Loads the usage-limits plugin configuration from OpenCode's config directory.
 *
 * Missing files, unreadable files, and invalid JSONC all resolve to conservative
 * defaults so the plugin can start without interrupting the TUI. Partial config
 * files are merged with the same defaults.
 *
 * @returns The fully-populated plugin configuration.
 */
export const loadConfig = async (): Promise<Required<UsageLimitsConfig>> => {
  const fallback: Required<UsageLimitsConfig> = {
    enabled: true,
    providers: {},
    refreshIntervalSeconds: 60,
    requestTimeoutMs: 10_000,
    showErrors: true,
  };

  try {
    const config = await readJsonFile<UsageLimitsConfig>(CONFIG_PATH);
    return {
      enabled: config.enabled ?? fallback.enabled,
      providers: config.providers ?? fallback.providers,
      refreshIntervalSeconds:
        config.refreshIntervalSeconds ?? fallback.refreshIntervalSeconds,
      requestTimeoutMs: config.requestTimeoutMs ?? fallback.requestTimeoutMs,
      showErrors: config.showErrors ?? fallback.showErrors,
    };
  } catch {
    return fallback;
  }
};

/**
 * Loads OpenCode's shared auth file for provider credentials.
 *
 * This file may not exist for every installation or provider. Auth loading is
 * therefore best-effort and returns an empty object when credentials are absent
 * or unreadable.
 *
 * @returns The parsed OpenCode auth payload, or an empty auth object.
 */
export const loadOpenCodeAuth = async (): Promise<OpenCodeAuth> => {
  try {
    return await readJsonFile<OpenCodeAuth>(OPENCODE_AUTH_PATH);
  } catch {
    return {};
  }
};
