import { afterEach, describe, expect, mock, test } from "bun:test";

import { Redacted, Result } from "effect";

import {
  credentialValue,
  parseOpenCodeAuth,
  parseUsageLimitsConfig,
} from "@/config-schema.ts";
import { ConfigDecodeError, ConfigReadError } from "@/errors.ts";

const actualUtils = await import("@/utils.ts");
const originalReadJsonFile = actualUtils.readJsonFile;
const readJsonFile = mock(originalReadJsonFile);

mock.module("@/utils.ts", () => ({ ...actualUtils, readJsonFile }));

const { loadConfig, loadOpenCodeAuth } = await import("@/config.ts");

afterEach(() => {
  readJsonFile.mockReset();
  readJsonFile.mockImplementation(originalReadJsonFile);
});

describe("configuration parsing", () => {
  test("defaults only omitted top-level fields and accepts $schema", () => {
    const result = parseUsageLimitsConfig({
      $schema: "https://example.com/usage-limits.schema.json",
      providers: {},
      refreshIntervalSeconds: 15,
      requestTimeoutMs: 1000,
      showErrors: false,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        enabled: true,
        providers: {},
        refreshIntervalSeconds: 15,
        requestTimeoutMs: 1000,
        showErrors: false,
      });
    }
  });

  test("parses every provider field and redacts API keys", () => {
    const result = parseUsageLimitsConfig({
      providers: {
        codex: {
          apiKey: "do-not-log",
          authPath: "~/.codex/auth.json",
          authorizationScheme: "bearer",
          baseUrl: "https://example.com",
          enabled: true,
          footerWindow: "weekly",
          label: "Work",
          showFooterBar: false,
          showSidebarBar: true,
          sidebarWindow: "weekly",
        },
      },
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const apiKey = result.success.providers.codex?.apiKey;
      expect(Redacted.isRedacted(apiKey)).toBe(true);
      expect(String(apiKey)).not.toContain("do-not-log");
      expect(result.success.providers.codex).toMatchObject({
        authPath: "~/.codex/auth.json",
        authorizationScheme: "bearer",
        baseUrl: "https://example.com",
        enabled: true,
        footerWindow: "weekly",
        label: "Work",
        showFooterBar: false,
        showSidebarBar: true,
        sidebarWindow: "weekly",
      });
    }
  });

  test.each([
    [{ enabled: "yes" }, "wrong boolean type"],
    [{ refreshIntervalSeconds: 14 }, "refresh minimum"],
    [{ refreshIntervalSeconds: Number.NaN }, "finite refresh"],
    [{ requestTimeoutMs: 999 }, "timeout minimum"],
    [{ providers: { codex: { authorizationScheme: "token" } } }, "enum"],
    [{ providers: { unknown: {} } }, "unknown provider"],
    [{ unknown: true }, "unknown top-level key"],
  ])("rejects %s (%s)", (input) => {
    const result = parseUsageLimitsConfig(input);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ConfigDecodeError);
    }
  });

  test("redacts malformed credential values from diagnostics", () => {
    const credential = { secret: "never-render-this" };
    const result = parseUsageLimitsConfig({
      providers: { synthetic: { apiKey: credential } },
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure.cause)).not.toContain("never-render-this");
    }
  });
});

describe("configuration loading", () => {
  test("returns defaults when no user config exists", async () => {
    readJsonFile.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );

    const result = await loadConfig();
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.refreshIntervalSeconds).toBe(60);
    }
  });

  test("returns typed read and JSONC decode failures", async () => {
    readJsonFile.mockRejectedValueOnce(new Error("permission denied"));
    const readResult = await loadConfig();
    expect(Result.isFailure(readResult)).toBe(true);
    if (Result.isFailure(readResult)) {
      expect(readResult.failure).toBeInstanceOf(ConfigReadError);
    }

    readJsonFile.mockRejectedValueOnce(new SyntaxError("malformed"));
    const decodeResult = await loadConfig();
    expect(Result.isFailure(decodeResult)).toBe(true);
    if (Result.isFailure(decodeResult)) {
      expect(decodeResult.failure).toBeInstanceOf(ConfigDecodeError);
    }
  });

  test("loads recognized auth fields as redacted values", async () => {
    readJsonFile.mockResolvedValueOnce({
      ignored: { value: true },
      openai: { access: "token", accountId: "account" },
    });

    const auth = await loadOpenCodeAuth();
    expect(Redacted.isRedacted(auth.openai?.access)).toBe(true);
    expect(String(auth.openai?.access)).not.toContain("token");
  });

  test("treats absent or malformed auth as empty", async () => {
    readJsonFile.mockRejectedValueOnce(new Error("missing"));
    await expect(loadOpenCodeAuth()).resolves.toEqual({});
    expect(parseOpenCodeAuth({ openai: { access: 42 } })).toEqual({});
  });

  test("keeps valid auth entries when another recognized entry is malformed", () => {
    const auth = parseOpenCodeAuth({
      minimax: { key: "valid-minimax" },
      openai: { access: "valid-openai", accountId: "valid-account" },
      synthetic: { key: 42 },
      zai: { key: "valid-zai" },
    });

    expect(credentialValue(auth.openai?.access)).toBe("valid-openai");
    expect(credentialValue(auth.minimax?.key)).toBe("valid-minimax");
    expect(credentialValue(auth.zai?.key)).toBe("valid-zai");
    expect(auth.synthetic).toBeUndefined();
  });

  test("keeps valid credential fields beside malformed sibling fields", () => {
    const auth = parseOpenCodeAuth({
      minimax: { apiKey: 42, ignored: "value", key: "valid-key" },
      openai: {
        access: "valid-access",
        accountId: { invalid: true },
        ignored: "value",
      },
    });

    expect(credentialValue(auth.minimax?.key)).toBe("valid-key");
    expect(auth.minimax?.apiKey).toBeUndefined();
    expect(credentialValue(auth.openai?.access)).toBe("valid-access");
    expect(auth.openai?.accountId).toBeUndefined();
  });
});
