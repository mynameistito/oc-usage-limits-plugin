import { afterEach, describe, expect, mock, test } from "bun:test";

import { fetchProvider, getProviderConfigs } from "@/providers.ts";
import { fetchCodexUsage } from "@/providers/codex.ts";
import { fetchZaiCodingPlanUsage } from "@/providers/zai-coding-plan.ts";
import type { UsageLimitsConfig } from "@/types.ts";

const originalFetch = globalThis.fetch;
type FetchMock = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const installFetchMock = (response: Response) => {
  const fetchMock = mock<FetchMock>(() => Promise.resolve(response));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OC_USAGE_LIMITS_ZAI_KEY;
  mock.restore();
});

describe("provider configuration", () => {
  test("returns enabled providers in display order", () => {
    const config: Required<UsageLimitsConfig> = {
      enabled: true,
      providers: {
        codex: { enabled: true, label: "Codex" },
        zai: { enabled: false, label: "ZAI" },
      },
      refreshIntervalSeconds: 60,
      requestTimeoutMs: 1000,
      showErrors: true,
    };

    expect(getProviderConfigs(config)).toEqual([
      ["codex", { enabled: true, label: "Codex" }],
    ]);
  });

  test("dispatches provider fetches by id", async () => {
    installFetchMock(
      Response.json({
        plan_type: "plus",
        rate_limit: {},
        rate_limit_reset_credits: { available_count: 3 },
      })
    );

    await expect(
      fetchProvider(
        "codex",
        { enabled: true },
        { openai: { access: "token", accountId: "account" } },
        1000
      )
    ).resolves.toMatchObject({ id: "codex" });
  });

  test("rejects unknown provider ids", () => {
    expect(() =>
      fetchProvider(
        "unknown" as never,
        { apiKey: "key", enabled: true },
        {},
        1000
      )
    ).toThrow("unknown provider: unknown");
  });
});

describe("Codex provider", () => {
  test("builds authenticated requests and parses usage windows", async () => {
    const fetchMock = installFetchMock(
      Response.json({
        plan_type: "team",
        rate_limit: {
          primary_window: {
            limit_window_seconds: 18_000,
            reset_after_seconds: 3600,
            reset_at: 1_782_216_000,
            used_percent: 125,
          },
          secondary_window: {
            limit_window_seconds: 86_400,
            reset_after_seconds: 7200,
            used_percent: -5,
          },
        },
        rate_limit_reset_credits: { available_count: 2 },
      })
    );

    const usage = await fetchCodexUsage(
      { baseUrl: "https://codex.example/", label: "Codex" },
      { openai: { access: "access-token", accountId: "account-id" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://codex.example/wham/usage"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer access-token",
        "ChatGPT-Account-Id": "account-id",
      },
      method: "GET",
    });
    expect(usage).toMatchObject({
      id: "codex",
      label: "Codex",
      metadata: { resetCredits: 2 },
      tierName: "team",
    });
    expect(usage.windows).toMatchObject([
      {
        label: "5h",
        remainingPercent: 0,
        resetAfterSeconds: 3600,
        usedPercent: 100,
      },
      {
        label: "daily",
        remainingPercent: 100,
        resetAfterSeconds: 7200,
        usedPercent: 0,
      },
    ]);
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(
      "2026-06-23T12:00:00.000Z"
    );
  });

  test("rejects malformed Codex responses", async () => {
    installFetchMock(Response.json([]));

    await expect(
      fetchCodexUsage(
        undefined,
        { openai: { access: "access-token", accountId: "account-id" } },
        1000
      )
    ).rejects.toThrow("invalid Codex usage");
  });
});

describe("ZAI provider", () => {
  test("prefers auth data, sends bearer tokens when configured, and infers Max tier", async () => {
    const nextResetTime = Date.now() + 90_000;
    const fetchMock = installFetchMock(
      Response.json({
        data: {
          limits: [
            {
              nextResetTime,
              percentage: 44.4,
              type: "TOKENS_LIMIT",
            },
            {
              currentValue: 25,
              percentage: 75,
              type: "TIME_LIMIT",
              usage: 1500,
            },
            { type: "UNKNOWN_LIMIT" },
          ],
        },
      })
    );

    const usage = await fetchZaiCodingPlanUsage(
      {
        apiKey: "config-key",
        authorizationScheme: "bearer",
        label: "Zed",
      },
      { zai: { key: "auth-key" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.z.ai/api/monitor/usage/quota/limit"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer auth-key" },
      method: "GET",
    });
    expect(usage).toMatchObject({
      id: "zai",
      label: "Zed",
      tierName: "Max",
    });
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "tokens",
      remainingPercent: 55.6,
      usedPercent: 44.4,
    });
    expect(usage.windows[0]?.resetAfterSeconds).toBeGreaterThan(0);
    expect(usage.windows[1]).toMatchObject({
      current: 25,
      label: "MCP",
      remainingPercent: 25,
      resetAfterSeconds: null,
      total: 1500,
      usedPercent: 75,
    });
  });

  test("uses configured environment references when auth does not contain a key", async () => {
    process.env.OC_USAGE_LIMITS_ZAI_KEY = "env-key";
    const fetchMock = installFetchMock(Response.json({ data: { limits: [] } }));

    await fetchZaiCodingPlanUsage(
      { apiKey: "{env:OC_USAGE_LIMITS_ZAI_KEY}" },
      {},
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "env-key" },
    });
  });

  test.each([
    [299, "Lite"],
    [300, "Pro"],
    [1399, "Pro"],
    [1400, "Max"],
  ] as const)(
    "infers %s total prompts as %s tier",
    async (usageTotal, tierName) => {
      installFetchMock(
        Response.json({
          data: {
            limits: [{ percentage: 1, type: "TIME_LIMIT", usage: usageTotal }],
          },
        })
      );

      await expect(
        fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
      ).resolves.toMatchObject({ tierName });
    }
  );

  test("rejects missing keys and malformed responses", async () => {
    await expect(fetchZaiCodingPlanUsage(undefined, {}, 1000)).rejects.toThrow(
      "missing ZAI key"
    );

    installFetchMock(Response.json({ data: {} }));
    await expect(
      fetchZaiCodingPlanUsage({ apiKey: "key" }, {}, 1000)
    ).rejects.toThrow("invalid ZAI usage");
  });
});
