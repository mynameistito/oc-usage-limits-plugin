import { describe, expect, test } from "bun:test";

import { fetchOpenCodeGoUsage } from "@/providers/opencode-go.ts";

import { installFetchMock } from "./helpers.ts";

describe("OpenCode GO provider", () => {
  test("builds authenticated requests and parses usage windows", async () => {
    const fetchMock = installFetchMock(
      Response.json({
        usage: {
          monthly: { percent: 35, resetsAt: "2026-09-01T00:00:00.000Z" },
          rolling: { percent: 12, resetsAt: "2026-08-23T00:00:00.000Z" },
          weekly: { percent: 8, resetsAt: "2026-08-30T00:00:00.000Z" },
        },
      })
    );

    const usage = await fetchOpenCodeGoUsage(
      undefined,
      { "opencode-go": { key: "go-token" } },
      1000
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://opencode.ai/zen/go/v1/usage"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer go-token" },
      method: "GET",
    });
    expect(usage).toMatchObject({ id: "opencode-go", label: "OpenCode GO" });
    expect(usage.windows).toMatchObject([
      { kind: "rolling", quota: { usedPercent: 12 } },
      { kind: "weekly", quota: { usedPercent: 8 } },
      { kind: "monthly", quota: { usedPercent: 35 } },
    ]);
  });

  test("supports the OPENCODE_API_KEY environment reference", async () => {
    const fetchMock = installFetchMock(
      Response.json({ usage: { rolling: { percent: 1 } } })
    );
    const previous = process.env.OPENCODE_API_KEY;
    process.env.OPENCODE_API_KEY = "env-token";

    try {
      await fetchOpenCodeGoUsage(
        { apiKey: "{env:OPENCODE_API_KEY}" },
        {},
        1000
      );
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_API_KEY;
      } else {
        process.env.OPENCODE_API_KEY = previous;
      }
    }

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer env-token" },
    });
  });

  test("rejects malformed usage responses", async () => {
    installFetchMock(Response.json({ usage: { rolling: { percent: 101 } } }));

    await expect(
      fetchOpenCodeGoUsage(undefined, { opencode: { key: "key" } }, 1000)
    ).rejects.toThrow("invalid OpenCode GO usage");
  });
});

describe("OpenCode GO renewals", () => {
  test("parses ISO reset instants and exposes the monthly cycle as renewal", async () => {
    installFetchMock(
      Response.json({
        usage: {
          monthly: { percent: 98, resetsAt: "2026-09-14T19:28:39.246Z" },
          rolling: { percent: 5, resetsAt: "2026-09-10T23:05:54.246Z" },
          weekly: { percent: 43, resetsAt: "2026-09-14T00:00:00.246Z" },
        },
      })
    );

    const usage = await fetchOpenCodeGoUsage(
      undefined,
      { "opencode-go": { key: "go-token" } },
      1000
    );

    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(
      "2026-09-10T23:05:54.246Z"
    );
    expect(usage.renewsAt?.toISOString()).toBe("2026-09-14T19:28:39.246Z");
  });

  test("prefers configured renewal over the monthly cycle", async () => {
    installFetchMock(
      Response.json({
        usage: {
          monthly: { percent: 1, resetsAt: "2026-09-14T19:28:39.246Z" },
        },
      })
    );

    const usage = await fetchOpenCodeGoUsage(
      { renewsOnDay: 20 },
      { "opencode-go": { key: "go-token" } },
      1000
    );

    expect(usage.renewsAt?.toISOString()).not.toBe("2026-09-14T19:28:39.246Z");
    expect(usage.renewsAt?.getDate()).toBe(20);
  });

  test("leaves renewal unset when the monthly window is absent", async () => {
    installFetchMock(Response.json({ usage: { rolling: { percent: 5 } } }));

    const usage = await fetchOpenCodeGoUsage(
      undefined,
      { "opencode-go": { key: "go-token" } },
      1000
    );

    expect(usage.renewsAt ?? null).toBeNull();
  });
});
