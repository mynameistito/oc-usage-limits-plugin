import { describe, expect, test } from "bun:test";

import { fetchCodexUsage } from "@/providers/codex.ts";

import { installFetchMock } from "./helpers.ts";

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
            used_percent: 100,
          },
          secondary_window: {
            limit_window_seconds: 86_400,
            reset_after_seconds: 7200,
            used_percent: 0,
          },
        },
        rate_limit_reset_credits: { available_count: 2 },
      })
    );

    const usage = await fetchCodexUsage(
      {
        apiKey: "configured-token",
        baseUrl: "https://codex.example/",
        label: "Codex",
      },
      { openai: { access: "access-token", accountId: "account-id" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://codex.example/wham/usage"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer configured-token",
        "ChatGPT-Account-Id": "configured",
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
        quota: { remainingPercent: 0, usedPercent: 100 },
      },
      {
        label: "daily",
        quota: { remainingPercent: 100, usedPercent: 0 },
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

  test("does not use discovered OpenCode credentials for a custom host", async () => {
    await expect(
      fetchCodexUsage(
        { baseUrl: "https://codex.example/" },
        { openai: { access: "discovered", accountId: "discovered" } },
        1000
      )
    ).rejects.toThrow("missing Codex auth");
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
    const fetchMock = installFetchMock(
      Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
    );

    await fetchCodexUsage(
      { apiKey: "configured-token", baseUrl },
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
      const fetchMock = installFetchMock(
        Response.json({ rate_limit: { primary_window: { used_percent: 0 } } })
      );

      await fetchCodexUsage(
        { baseUrl },
        { openai: { access: "token", accountId: "account" } },
        1000
      );

      expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
    }
  );

  describe("window variants", () => {
    test("primary window only", async () => {
      installFetchMock(
        Response.json({
          plan_type: "team",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_after_seconds: 3600,
              reset_at: 1_782_216_000,
              used_percent: 50,
            },
          },
        })
      );

      const usage = await fetchCodexUsage(
        {
          apiKey: "configured-token",
          baseUrl: "https://codex.example/",
          label: "Codex",
        },
        { openai: { access: "access-token", accountId: "account-id" } },
        1000
      );

      expect(usage.windows).toHaveLength(1);
      expect(usage.windows[0]).toMatchObject({
        label: "5h",
        quota: { remainingPercent: 50, usedPercent: 50 },
      });
    });

    test("primary + secondary windows", async () => {
      installFetchMock(
        Response.json({
          plan_type: "team",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_after_seconds: 3600,
              reset_at: 1_782_216_000,
              used_percent: 100,
            },
            secondary_window: {
              limit_window_seconds: 86_400,
              reset_after_seconds: 7200,
              used_percent: 0,
            },
          },
        })
      );

      const usage = await fetchCodexUsage(
        {
          apiKey: "configured-token",
          baseUrl: "https://codex.example/",
          label: "Codex",
        },
        { openai: { access: "access-token", accountId: "account-id" } },
        1000
      );

      expect(usage.windows).toHaveLength(2);
      expect(usage.windows[0]).toMatchObject({
        label: "5h",
        quota: { remainingPercent: 0, usedPercent: 100 },
      });
      expect(usage.windows[1]).toMatchObject({
        label: "daily",
        quota: { remainingPercent: 100, usedPercent: 0 },
      });
    });

    test("reset credits metadata", async () => {
      installFetchMock(
        Response.json({
          plan_type: "team",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_after_seconds: 3600,
              reset_at: 1_782_216_000,
              used_percent: 50,
            },
          },
          rate_limit_reset_credits: { available_count: 5 },
        })
      );

      const usage = await fetchCodexUsage(
        {
          apiKey: "configured-token",
          baseUrl: "https://codex.example/",
          label: "Codex",
        },
        { openai: { access: "access-token", accountId: "account-id" } },
        1000
      );

      expect(usage.metadata).toMatchObject({
        resetCredits: 5,
      });
    });

    test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects invalid required percentage %s",
      async (usedPercent) => {
        installFetchMock(
          Response.json({
            rate_limit: {
              primary_window: {
                limit_window_seconds: 18_000,
                used_percent: usedPercent,
              },
            },
          })
        );

        await expect(
          fetchCodexUsage(
            undefined,
            { openai: { access: "token", accountId: "account" } },
            1000
          )
        ).rejects.toThrow("invalid Codex usage");
      }
    );

    test("plan type", async () => {
      installFetchMock(
        Response.json({
          plan_type: "enterprise",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_after_seconds: 3600,
              reset_at: 1_782_216_000,
              used_percent: 50,
            },
          },
        })
      );

      const usage = await fetchCodexUsage(
        {
          apiKey: "configured-token",
          baseUrl: "https://codex.example/",
          label: "Codex",
        },
        { openai: { access: "access-token", accountId: "account-id" } },
        1000
      );

      expect(usage.tierName).toBe("enterprise");
    });
  });
});
