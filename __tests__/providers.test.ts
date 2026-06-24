import { afterEach, describe, expect, mock, test } from "bun:test";

import { fetchProvider, getProviderConfigs } from "@/providers.ts";
import { fetchCodexUsage } from "@/providers/codex.ts";
import { fetchMiniMaxTokenPlanUsage } from "@/providers/minimax.ts";
import { fetchSyntheticUsage } from "@/providers/synthetic.ts";
import { fetchZaiCodingPlanUsage } from "@/providers/zai-coding-plan.ts";
import type { OpenCodeAuth, UsageLimitsConfig } from "@/types.ts";

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
  delete process.env.OC_USAGE_LIMITS_SYNTHETIC_KEY;
  delete process.env.OC_USAGE_LIMITS_MINIMAX_KEY;
  mock.restore();
});

describe("provider configuration", () => {
  test("returns enabled providers in display order", () => {
    const config: Required<UsageLimitsConfig> = {
      enabled: true,
      providers: {
        codex: { enabled: true, label: "Codex" },
        minimax: { enabled: true, label: "MiniMax" },
        synthetic: { enabled: true, label: "Synthetic" },
        zai: { enabled: false, label: "ZAI" },
      },
      refreshIntervalSeconds: 60,
      requestTimeoutMs: 1000,
      showErrors: true,
    };

    expect(getProviderConfigs(config)).toEqual([
      ["codex", { enabled: true, label: "Codex" }],
      ["synthetic", { enabled: true, label: "Synthetic" }],
      ["minimax", { enabled: true, label: "MiniMax" }],
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

  test.each([
    ["http://localhost:3000/", "http://localhost:3000/wham/usage"],
    ["http://127.0.0.1:4321", "http://127.0.0.1:4321/wham/usage"],
    ["http://[::1]:3000", "http://[::1]:3000/wham/usage"],
    [
      "https://chatgpt.com/backend-api/",
      "https://chatgpt.com/backend-api/wham/usage",
    ],
  ] as const)("allows safe base URL %s", async (baseUrl, expectedUrl) => {
    const fetchMock = installFetchMock(Response.json({ rate_limit: {} }));

    await fetchCodexUsage(
      { baseUrl },
      { openai: { access: "token", accountId: "account" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
  });

  test.each([
    ["http://evil.example", "https://chatgpt.com/backend-api/wham/usage"],
    ["ftp://example.com", "https://chatgpt.com/backend-api/wham/usage"],
    ["not a url", "https://chatgpt.com/backend-api/wham/usage"],
  ] as const)(
    "falls back from unsafe base URL %s",
    async (baseUrl, expectedUrl) => {
      const fetchMock = installFetchMock(Response.json({ rate_limit: {} }));

      await fetchCodexUsage(
        { baseUrl },
        { openai: { access: "token", accountId: "account" } },
        1000
      );

      expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
    }
  );
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
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 55.6,
      usedPercent: 44.4,
    });
    expect(usage.windows[0]?.resetAfterSeconds).toBeGreaterThan(0);
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

describe("Synthetic provider", () => {
  const nextTickAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const nextRegenAt = new Date(
    Date.now() + 3 * 24 * 60 * 60 * 1000
  ).toISOString();

  test("parses v3 rolling and weekly windows and sends a bearer header", async () => {
    const fetchMock = installFetchMock(
      Response.json({
        rollingFiveHourLimit: {
          limited: false,
          max: 100,
          nextTickAt,
          remaining: 40,
          tickPercent: 0.6,
        },
        weeklyTokenLimit: {
          nextRegenAt,
          percentRemaining: 75,
        },
      })
    );

    const usage = await fetchSyntheticUsage(
      { label: "Syn" },
      { synthetic: { key: "syn-test-key" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.synthetic.new/v2/quotas"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer syn-test-key",
      },
      method: "GET",
    });
    expect(usage).toMatchObject({ id: "synthetic", label: "Syn" });
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 40,
      usedPercent: 60,
    });
    expect(usage.windows[1]).toMatchObject({
      label: "weekly",
      remainingPercent: 75,
      usedPercent: 25,
    });
    expect(usage.windows[0]?.resetAfterSeconds).toBeGreaterThan(0);
    expect(usage.windows[1]?.resetAfterSeconds).toBeGreaterThan(0);
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(nextTickAt);
    expect(usage.windows[1]?.resetsAt?.toISOString()).toBe(nextRegenAt);
  });

  test("accepts apiKey under the synthetic block in OpenCode auth", async () => {
    const fetchMock = installFetchMock(
      Response.json({ subscription: { limit: 1, requests: 0 } })
    );

    const usage = await fetchSyntheticUsage(
      {},
      { synthetic: { apiKey: "syn-apikey-test" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer syn-apikey-test" },
    });
    expect(usage.id).toBe("synthetic");
    expect(usage.windows).toHaveLength(1);
  });

  test("falls back to the legacy subscription bucket when v3 fields are missing", async () => {
    const renewsAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    installFetchMock(
      Response.json({
        subscription: {
          limit: 200,
          renewsAt,
          requests: 50,
        },
      })
    );

    const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 75,
      usedPercent: 25,
    });
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(renewsAt);
  });

  test("prefers the v3 rollingFiveHourLimit over the legacy subscription bucket", async () => {
    const renewsAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    installFetchMock(
      Response.json({
        rollingFiveHourLimit: {
          limited: false,
          max: 200,
          nextTickAt,
          remaining: 100,
          tickPercent: 0.05,
        },
        subscription: {
          limit: 100,
          renewsAt,
          requests: 50,
        },
        weeklyTokenLimit: {
          nextRegenAt,
          percentRemaining: 50,
        },
      })
    );

    const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 50,
      usedPercent: 50,
    });
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(nextTickAt);
    expect(usage.windows[1]).toMatchObject({
      label: "weekly",
      remainingPercent: 50,
      usedPercent: 50,
    });
  });

  test("tolerates the legacy toolCallDiscounts alias and emits v3 windows", async () => {
    installFetchMock(
      Response.json({
        rollingFiveHourLimit: {
          limited: true,
          max: 80,
          nextTickAt,
          remaining: 10,
          tickPercent: 0.875,
        },
        toolCallDiscounts: {
          limit: 50,
          renewsAt: nextTickAt,
          requests: 20,
        },
        weeklyTokenLimit: {
          nextRegenAt,
          percentRemaining: 90,
        },
      })
    );

    const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 12.5,
      usedPercent: 87.5,
    });
    expect(usage.windows[1]).toMatchObject({
      label: "weekly",
      remainingPercent: 90,
      usedPercent: 10,
    });
  });

  test("resolves environment references when no other credential is available", async () => {
    process.env.OC_USAGE_LIMITS_SYNTHETIC_KEY = "env-syn-key";
    const fetchMock = installFetchMock(
      Response.json({
        rollingFiveHourLimit: {
          limited: false,
          max: 50,
          nextTickAt,
          remaining: 50,
          tickPercent: 0,
        },
      })
    );

    const usage = await fetchSyntheticUsage(
      { apiKey: "{env:OC_USAGE_LIMITS_SYNTHETIC_KEY}" },
      {},
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer env-syn-key" },
    });
    expect(usage.windows).toHaveLength(1);
  });

  test("rejects missing keys and malformed responses", async () => {
    await expect(fetchSyntheticUsage(undefined, {}, 1000)).rejects.toThrow(
      "missing Synthetic key"
    );

    installFetchMock(Response.json([]));
    await expect(
      fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
    ).rejects.toThrow("invalid Synthetic usage");

    installFetchMock(Response.json({}));
    await expect(
      fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000)
    ).rejects.toThrow("invalid Synthetic usage");
  });
});

const successEnvelope = <T>(modelRemains: T) => ({
  base_resp: { status_code: 0, status_msg: "success" },
  model_remains: modelRemains,
});

describe("MiniMax provider", () => {
  const fiveHourRemains = 90 * 60 * 1000;
  const weeklyRemains = 3 * 24 * 60 * 60 * 1000;

  test("parses the general entry and reports both 5h and weekly windows", async () => {
    const fetchMock = installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 99,
            current_weekly_remaining_percent: 99,
            model_name: "video",
            remains_time: fiveHourRemains,
            weekly_remains_time: weeklyRemains,
          },
          {
            current_interval_remaining_percent: 60,
            current_interval_status: 1,
            current_weekly_remaining_percent: 40,
            current_weekly_status: 1,
            model_name: "general",
            remains_time: fiveHourRemains,
            weekly_remains_time: weeklyRemains,
          },
        ])
      )
    );

    const usage = await fetchMiniMaxTokenPlanUsage(
      { apiKey: "mm-key", label: "MiniMax CN" },
      {},
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.minimax.io/v1/token_plan/remains"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer mm-key",
        "Content-Type": "application/json",
      },
      method: "GET",
    });
    expect(usage).toMatchObject({ id: "minimax", label: "MiniMax CN" });
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 60,
      usedPercent: 40,
    });
    expect(usage.windows[1]).toMatchObject({
      label: "weekly",
      remainingPercent: 40,
      usedPercent: 60,
    });
    expect(usage.windows[0]?.resetAfterSeconds).toBeGreaterThan(0);
    expect(usage.windows[1]?.resetAfterSeconds).toBeGreaterThan(0);
    expect(usage.windows[0]?.resetsAt?.getTime()).toBeGreaterThan(
      Date.now() + fiveHourRemains - 5000
    );
    expect(usage.windows[1]?.resetsAt?.getTime()).toBeGreaterThan(
      Date.now() + weeklyRemains - 5000
    );
  });

  test("honours a baseUrl override for the China region", async () => {
    const fetchMock = installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 80,
            current_weekly_remaining_percent: 80,
            model_name: "general",
            remains_time: fiveHourRemains,
            weekly_remains_time: weeklyRemains,
          },
        ])
      )
    );

    await fetchMiniMaxTokenPlanUsage(
      { apiKey: "mm-key", baseUrl: "https://api.minimaxi.com" },
      {},
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.minimaxi.com/v1/token_plan/remains"
    );
  });

  test("looks up the subscription key under both minimax and minimax-token-plan keys", async () => {
    const fetchMock = installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 80,
            model_name: "general",
            remains_time: fiveHourRemains,
          },
        ])
      )
    );

    await fetchMiniMaxTokenPlanUsage(
      undefined,
      { "minimax-token-plan": { key: "alias-mm-key" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer alias-mm-key" },
    });
  });

  test("accepts the minimax-coding-plan provider id in OpenCode auth", async () => {
    const fetchMock = installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 80,
            model_name: "general",
            remains_time: fiveHourRemains,
          },
        ])
      )
    );

    const usage = await fetchMiniMaxTokenPlanUsage(
      {},
      { "minimax-coding-plan": { key: "auth-mm-key" } } as OpenCodeAuth,
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.minimax.io/v1/token_plan/remains"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer auth-mm-key" },
    });
    expect(usage).toMatchObject({ id: "minimax" });
  });

  test("prefers openCodeAuth over the configured apiKey", async () => {
    const fetchMock = installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 90,
            model_name: "general",
            remains_time: fiveHourRemains,
          },
        ])
      )
    );

    await fetchMiniMaxTokenPlanUsage(
      { apiKey: "config-mm-key" },
      { minimax: { apiKey: "auth-mm-key" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer auth-mm-key" },
    });
  });

  test("resolves environment references when no other credential is available", async () => {
    process.env.OC_USAGE_LIMITS_MINIMAX_KEY = "env-mm-key";
    const fetchMock = installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 90,
            model_name: "general",
            remains_time: fiveHourRemains,
          },
        ])
      )
    );

    await fetchMiniMaxTokenPlanUsage(
      { apiKey: "{env:OC_USAGE_LIMITS_MINIMAX_KEY}" },
      {},
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer env-mm-key" },
    });
  });

  test("emits only the window whose remaining percent is reported", async () => {
    installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 50,
            current_interval_status: 1,
            model_name: "general",
            remains_time: fiveHourRemains,
          },
        ])
      )
    );

    const usage = await fetchMiniMaxTokenPlanUsage(
      { apiKey: "mm-key" },
      {},
      1000
    );

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 50,
      usedPercent: 50,
    });
  });

  test("falls back to the first in-plan entry when no general entry exists", async () => {
    installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 70,
            current_interval_status: 1,
            current_weekly_remaining_percent: 80,
            model_name: "video",
            remains_time: fiveHourRemains,
            weekly_remains_time: weeklyRemains,
          },
          {
            model_name: "image",
          },
        ])
      )
    );

    const usage = await fetchMiniMaxTokenPlanUsage(
      { apiKey: "mm-key" },
      {},
      1000
    );

    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 70,
      usedPercent: 30,
    });
    expect(usage.windows[1]).toMatchObject({
      label: "weekly",
      remainingPercent: 80,
      usedPercent: 20,
    });
  });

  test("rejects missing keys and malformed responses", async () => {
    await expect(
      fetchMiniMaxTokenPlanUsage(undefined, {}, 1000)
    ).rejects.toThrow("missing MiniMax key");

    installFetchMock(Response.json({}));
    await expect(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    ).rejects.toThrow("invalid MiniMax usage");

    installFetchMock(
      Response.json(
        successEnvelope([{ current_interval_status: 3, model_name: "general" }])
      )
    );
    await expect(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    ).rejects.toThrow("invalid MiniMax usage");

    installFetchMock(
      Response.json({
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: "not an array",
      })
    );
    await expect(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    ).rejects.toThrow("invalid MiniMax usage");
  });

  test("rejects payloads that are not wrapped in the model_remains envelope", async () => {
    installFetchMock(
      Response.json([
        {
          current_interval_remaining_percent: 80,
          model_name: "general",
          remains_time: fiveHourRemains,
        },
      ])
    );
    await expect(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    ).rejects.toThrow("invalid MiniMax usage");
  });

  test("rejects envelopes whose base_resp status_code is non-zero", async () => {
    installFetchMock(
      Response.json({
        base_resp: { status_code: 1, status_msg: "some error" },
        model_remains: [
          {
            current_interval_remaining_percent: 50,
            current_interval_status: 1,
            model_name: "general",
            remains_time: fiveHourRemains,
          },
        ],
      })
    );
    await expect(
      fetchMiniMaxTokenPlanUsage({ apiKey: "mm-key" }, {}, 1000)
    ).rejects.toThrow("invalid MiniMax usage");
  });

  test("hides the weekly window when the model is not in the weekly plan", async () => {
    installFetchMock(
      Response.json(
        successEnvelope([
          {
            current_interval_remaining_percent: 91,
            current_interval_status: 1,
            current_weekly_remaining_percent: 100,
            current_weekly_status: 3,
            model_name: "general",
            remains_time: fiveHourRemains,
            weekly_remains_time: weeklyRemains,
          },
        ])
      )
    );

    const usage = await fetchMiniMaxTokenPlanUsage(
      { apiKey: "mm-key" },
      {},
      1000
    );

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      label: "5h",
      remainingPercent: 91,
      usedPercent: 9,
    });
  });
});
