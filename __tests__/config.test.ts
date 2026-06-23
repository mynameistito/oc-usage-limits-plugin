import { afterEach, describe, expect, mock, test } from "bun:test";

import * as utils from "@/utils.ts";

const originalReadJsonFile = utils.readJsonFile;
const readJsonFile = mock(originalReadJsonFile);

mock.module("@/utils.ts", () => ({ ...utils, readJsonFile }));

const { loadConfig, loadOpenCodeAuth } = await import("@/config.ts");

afterEach(() => {
  readJsonFile.mockReset();
  readJsonFile.mockImplementation(originalReadJsonFile);
});

describe("configuration loading", () => {
  test("returns fallback config when no user config exists", async () => {
    readJsonFile.mockRejectedValueOnce(new Error("missing"));

    await expect(loadConfig()).resolves.toEqual({
      enabled: true,
      providers: {},
      refreshIntervalSeconds: 60,
      requestTimeoutMs: 10_000,
      showErrors: true,
    });
  });

  test("loads configured values while filling missing defaults", async () => {
    readJsonFile.mockResolvedValueOnce({
      providers: { codex: { enabled: true } },
      refreshIntervalSeconds: 120,
      showErrors: false,
    });

    await expect(loadConfig()).resolves.toEqual({
      enabled: true,
      providers: { codex: { enabled: true } },
      refreshIntervalSeconds: 120,
      requestTimeoutMs: 10_000,
      showErrors: false,
    });
  });

  test("falls back for invalid numeric config values", async () => {
    readJsonFile.mockResolvedValueOnce({
      refreshIntervalSeconds: "fast",
      requestTimeoutMs: null,
    });

    await expect(loadConfig()).resolves.toMatchObject({
      refreshIntervalSeconds: 60,
      requestTimeoutMs: 10_000,
    });
  });

  test("falls back for below-minimum numeric config values", async () => {
    readJsonFile.mockResolvedValueOnce({
      refreshIntervalSeconds: 14,
      requestTimeoutMs: 999,
    });

    await expect(loadConfig()).resolves.toMatchObject({
      refreshIntervalSeconds: 60,
      requestTimeoutMs: 10_000,
    });
  });

  test("accepts minimum numeric config values", async () => {
    readJsonFile.mockResolvedValueOnce({
      refreshIntervalSeconds: 15,
      requestTimeoutMs: 1000,
    });

    await expect(loadConfig()).resolves.toMatchObject({
      refreshIntervalSeconds: 15,
      requestTimeoutMs: 1000,
    });
  });

  test("loads OpenCode auth", async () => {
    readJsonFile.mockResolvedValueOnce({
      openai: { access: "token", accountId: "account" },
    });

    await expect(loadOpenCodeAuth()).resolves.toEqual({
      openai: { access: "token", accountId: "account" },
    });
  });

  test("returns empty OpenCode auth when auth cannot be read", async () => {
    readJsonFile.mockRejectedValueOnce(new Error("missing"));

    await expect(loadOpenCodeAuth()).resolves.toEqual({});
  });
});
