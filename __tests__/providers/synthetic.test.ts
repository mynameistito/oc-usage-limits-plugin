import { describe, expect, test } from "bun:test";

import { fetchSyntheticUsage } from "@/providers/synthetic.ts";

import { installFetchMock } from "./helpers.ts";

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
      current: 60,
      label: "5h",
      remainingPercent: 40,
      total: 100,
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
      current: 50,
      label: "5h",
      remainingPercent: 75,
      total: 200,
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
      current: 100,
      label: "5h",
      remainingPercent: 50,
      total: 200,
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

  describe("window variants", () => {
    test("v3 rollingFiveHourLimit only (no weeklyTokenLimit)", async () => {
      installFetchMock(
        Response.json({
          rollingFiveHourLimit: {
            limited: false,
            max: 100,
            nextTickAt,
            remaining: 40,
            tickPercent: 0.6,
          },
        })
      );

      const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

      expect(usage.windows).toHaveLength(1);
      expect(usage.windows[0]).toMatchObject({
        label: "5h",
        remainingPercent: 40,
        usedPercent: 60,
      });
    });

    test("v3 with weeklyTokenLimit", async () => {
      installFetchMock(
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

      const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

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
    });

    test("Legacy subscription only (no v3 fields)", async () => {
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
    });

    test("v3 + legacy both present (v3 takes precedence)", async () => {
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
        current: 100,
        label: "5h",
        remainingPercent: 50,
        total: 200,
        usedPercent: 50,
      });
      expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(nextTickAt);
    });

    test("Zero remaining (remaining=0)", async () => {
      installFetchMock(
        Response.json({
          rollingFiveHourLimit: {
            limited: true,
            max: 100,
            nextTickAt,
            remaining: 0,
            tickPercent: 1,
          },
        })
      );

      const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

      expect(usage.windows).toHaveLength(1);
      expect(usage.windows[0]).toMatchObject({
        current: 100,
        label: "5h",
        remainingPercent: 0,
        total: 100,
        usedPercent: 100,
      });
    });

    test("current/total population (v3 path)", async () => {
      installFetchMock(
        Response.json({
          rollingFiveHourLimit: {
            limited: false,
            max: 150,
            nextTickAt,
            remaining: 45,
            tickPercent: 0.7,
          },
        })
      );

      const usage = await fetchSyntheticUsage({ apiKey: "syn-key" }, {}, 1000);

      expect(usage.windows).toHaveLength(1);
      expect(usage.windows[0]).toMatchObject({
        current: 105,
        label: "5h",
        remainingPercent: 30,
        total: 150,
        usedPercent: 70,
      });
    });
  });
});
