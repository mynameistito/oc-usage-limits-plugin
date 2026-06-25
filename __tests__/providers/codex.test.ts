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
