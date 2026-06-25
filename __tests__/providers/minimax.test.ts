import { describe, expect, test } from "bun:test";

import { fetchMiniMaxTokenPlanUsage } from "@/providers/minimax.ts";
import type { OpenCodeAuth } from "@/types.ts";

import { installFetchMock } from "./helpers.ts";

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
