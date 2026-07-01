import { describe, expect, test } from "bun:test";

import { fetchNeuralWattUsage } from "@/providers/neuralwatt.ts";

import { installFetchMock } from "./helpers.ts";

describe("NeuralWatt provider", () => {
  const currentPeriodEnd = new Date(
    Date.now() + 10 * 24 * 60 * 60 * 1000
  ).toISOString();

  const subscriptionPayload = {
    balance: {
      accounting_method: "energy",
      credits_remaining_usd: 32.6774,
      credits_used_usd: 19.6626,
      total_credits_usd: 52.34,
    },
    key: { allowance: null, name: "my-production-key" },
    limits: { overage_limit_usd: null, rate_limit_tier: "standard" },
    snapshot_at: "2026-04-16T18:30:00Z",
    subscription: {
      auto_renew: true,
      billing_interval: "month",
      current_period_end: currentPeriodEnd,
      current_period_start: "2026-04-11T05:05:25Z",
      in_overage: false,
      kwh_included: 20,
      kwh_remaining: 6.0977,
      kwh_used: 13.9023,
      plan: "standard",
      status: "active",
    },
    usage: {
      current_month: {
        cost_usd: 160.1463,
        energy_kwh: 9.7278,
        requests: 23_902,
        tokens: 1_116_658_995,
      },
      lifetime: {
        cost_usd: 243.9145,
        energy_kwh: 15.6009,
        requests: 37_801,
        tokens: 1_235_477_176,
      },
    },
  };

  test("parses the monthly subscription window and sends a bearer header", async () => {
    const fetchMock = installFetchMock(Response.json(subscriptionPayload));

    const usage = await fetchNeuralWattUsage(
      { label: "NW" },
      { neuralwatt: { apiKey: "nw-test-key" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.neuralwatt.com/v1/quota"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer nw-test-key",
      },
      method: "GET",
    });
    expect(usage).toMatchObject({ id: "neuralwatt", label: "NW" });
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      current: 13.9023,
      label: "monthly",
      total: 20,
    });
    expect(usage.windows[0]?.usedPercent).toBeCloseTo(69.5115, 5);
    expect(usage.windows[0]?.remainingPercent).toBeCloseTo(30.4885, 5);
    expect(usage.windows[0]?.resetAfterSeconds).toBeGreaterThan(0);
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(currentPeriodEnd);
    expect(usage.tierName).toBe("standard");
  });

  test("includes a key allowance window alongside the subscription window", async () => {
    installFetchMock(
      Response.json({
        ...subscriptionPayload,
        key: {
          allowance: {
            blocked: false,
            limit_usd: 100,
            period: "daily",
            remaining_usd: 54.5,
            spent_usd: 45.5,
          },
          name: "my-production-key",
        },
      })
    );

    const usage = await fetchNeuralWattUsage({ apiKey: "nw-key" }, {}, 1000);

    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({
      label: "monthly",
    });
    expect(usage.windows[0]?.usedPercent).toBeCloseTo(69.5115, 5);
    expect(usage.windows[1]).toMatchObject({
      current: 45.5,
      label: "daily",
      remainingPercent: 54.5,
      total: 100,
      usedPercent: 45.5,
    });
    expect(usage.windows[1]?.resetAfterSeconds).toBeNull();
    expect(usage.windows[1]?.resetsAt).toBeNull();
  });

  test("falls back to the credit balance window when subscription is missing", async () => {
    installFetchMock(
      Response.json({
        balance: {
          accounting_method: "energy",
          credits_remaining_usd: 32.6774,
          credits_used_usd: 19.6626,
          total_credits_usd: 52.34,
        },
        key: { allowance: null, name: "my-production-key" },
        snapshot_at: "2026-04-16T18:30:00Z",
      })
    );

    const usage = await fetchNeuralWattUsage({ apiKey: "nw-key" }, {}, 1000);

    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      current: 19.6626,
      label: "credits",
      total: 52.34,
    });
    expect(usage.windows[0]?.usedPercent).toBeCloseTo(37.567, 3);
    expect(usage.windows[0]?.remainingPercent).toBeCloseTo(62.433, 3);
    expect(usage.tierName).toBeUndefined();
  });

  test("rejects missing keys and malformed responses", async () => {
    await expect(fetchNeuralWattUsage(undefined, {}, 1000)).rejects.toThrow(
      "missing NeuralWatt key"
    );

    installFetchMock(Response.json([]));
    await expect(
      fetchNeuralWattUsage({ apiKey: "nw-key" }, {}, 1000)
    ).rejects.toThrow("invalid NeuralWatt usage");

    installFetchMock(Response.json({}));
    await expect(
      fetchNeuralWattUsage({ apiKey: "nw-key" }, {}, 1000)
    ).rejects.toThrow("invalid NeuralWatt usage");
  });

  test("resolves environment references when no other credential is available", async () => {
    process.env.OC_USAGE_LIMITS_NEURALWATT_KEY = "env-nw-key";
    const fetchMock = installFetchMock(
      Response.json({
        subscription: {
          current_period_end: currentPeriodEnd,
          kwh_included: 10,
          kwh_used: 2.5,
          plan: "basic",
        },
      })
    );

    const usage = await fetchNeuralWattUsage(
      { apiKey: "{env:OC_USAGE_LIMITS_NEURALWATT_KEY}" },
      {},
      1000
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer env-nw-key" },
    });
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]).toMatchObject({
      label: "monthly",
      usedPercent: 25,
    });
  });

  describe("allowance periods", () => {
    const baseAllowance = {
      blocked: false,
      limit_usd: 200,
      remaining_usd: 150,
      spent_usd: 50,
    };

    test.each([
      { expectedLabel: "daily", period: "daily", usedPercent: 25 },
      { expectedLabel: "weekly", period: "weekly", usedPercent: 25 },
      { expectedLabel: "key monthly", period: "monthly", usedPercent: 25 },
      { expectedLabel: "allowance", period: "yearly", usedPercent: 25 },
    ])(
      "uses label '$expectedLabel' for period '$period'",
      async ({ period, expectedLabel, usedPercent }) => {
        installFetchMock(
          Response.json({
            ...subscriptionPayload,
            key: {
              allowance: { ...baseAllowance, period },
              name: "my-production-key",
            },
          })
        );

        const usage = await fetchNeuralWattUsage(
          { apiKey: "nw-key" },
          {},
          1000
        );

        expect(usage.windows).toHaveLength(2);
        expect(usage.windows[1]).toMatchObject({
          label: expectedLabel,
          usedPercent,
        });
      }
    );
  });
});
