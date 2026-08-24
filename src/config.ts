import { homedir } from "node:os";
import path from "node:path";

import { Result } from "effect";

import { parseOpenCodeAuth, parseUsageLimitsConfig } from "@/config-schema.ts";
import { ConfigDecodeError, ConfigReadError } from "@/errors.ts";
import type { OpenCodeAuth, ResolvedUsageLimitsConfig } from "@/types.ts";
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

/** Fully resolved defaults used when no plugin config exists. */
export const DEFAULT_CONFIG: ResolvedUsageLimitsConfig = {
  enabled: true,
  providers: {},
  refreshIntervalSeconds: 60,
  requestTimeoutMs: 10_000,
  showErrors: true,
};

const isMissingFile = (error: Error): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** Loads and parses the usage-limits plugin configuration. */
export const loadConfig = async (): Promise<
  Result.Result<ResolvedUsageLimitsConfig, ConfigReadError | ConfigDecodeError>
> => {
  try {
    return parseUsageLimitsConfig(await readJsonFile(CONFIG_PATH));
  } catch (error) {
    if (error instanceof Error && isMissingFile(error)) {
      return Result.succeed(DEFAULT_CONFIG);
    }
    if (error instanceof SyntaxError) {
      return Result.fail(
        new ConfigDecodeError({ cause: "syntax", operation: "parse-jsonc" })
      );
    }
    return Result.fail(
      new ConfigReadError({
        cause: "filesystem",
        operation: "read-config",
        path: CONFIG_PATH,
      })
    );
  }
};

/** Loads recognized OpenCode auth fields without making auth absence fatal. */
export const loadOpenCodeAuth = async (): Promise<OpenCodeAuth> => {
  try {
    return parseOpenCodeAuth(await readJsonFile(OPENCODE_AUTH_PATH));
  } catch {
    return {};
  }
};
