import { describe, expect, test } from "bun:test";

import { fetchZaiCodingPlanUsage } from "@/providers/zai-coding-plan.ts";

import { installFetchMock } from "./helpers.ts";

describe("ZAI provider", () => {
  test("prefers auth data, sends bearer tokens when configured, and infers Max tier", async () => {
    const nextResetTime = Date.now() + 90_000;
    const fetchMock = installFetchMock(
      Response.json({
        data: {
          limits: [
            {
              currentValue: 4440,
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
      current: 4440,
      label: "5h",
      remainingPercent: 55.6,
      total: 10_000,
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
