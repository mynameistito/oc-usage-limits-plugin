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
