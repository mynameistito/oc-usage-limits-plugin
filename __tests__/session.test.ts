import { describe, expect, test } from "bun:test";

import { currentProviderID, usageForProvider } from "@/session.ts";
import type { ProviderState, UsageWindow } from "@/types.ts";

const window = (label: string, usedPercent = 25): UsageWindow => ({
  label,
  remainingPercent: 100 - usedPercent,
  resetAfterSeconds: 60,
  resetsAt: new Date("2026-06-23T12:00:00.000Z"),
  usedPercent,
});

describe("session helpers", () => {
  test("finds the most recent provider id from top-level or model message data", () => {
    expect(
      currentProviderID([
        { providerID: "openai" },
        { model: { providerID: "zai-coding-plan" } },
      ])
    ).toBe("zai-coding-plan");

    expect(currentProviderID([{ model: { providerID: "openai" } }])).toBe(
      "openai"
    );
  });

  test("ignores invalid message shapes", () => {
    expect(
      currentProviderID([null, [], { model: null }, { providerID: 1 }])
    ).toBeUndefined();
  });

  test("selects Codex usage for OpenAI sessions and prefers the 5h window", () => {
    const states: ProviderState[] = [
      {
        data: {
          capturedAt: new Date(),
          id: "codex",
          label: "codex",
          windows: [window("daily"), window("5h", 75)],
        },
        id: "codex",
        label: "codex",
        stale: false,
        status: "ready",
      },
    ];

    expect(usageForProvider(states, "openai")?.usedPercent).toBe(75);
  });

  test("selects ZAI token usage and falls back to previous data from error states", () => {
    const states: ProviderState[] = [
      {
        id: "zai",
        label: "ZAI",
        message: "failed",
        previous: {
          capturedAt: new Date(),
          id: "zai",
          label: "ZAI",
          windows: [window("MCP"), window("tokens", 88)],
        },
        status: "error",
      },
    ];

    expect(usageForProvider(states, "zai-coding-plan")?.label).toBe("tokens");
    expect(usageForProvider(states, "zai-coding-plan")?.usedPercent).toBe(88);
  });

  test("returns null for unknown providers or unavailable data", () => {
    expect(usageForProvider([], "anthropic")).toBeNull();
    expect(
      usageForProvider(
        [{ id: "codex", label: "codex", status: "loading" }],
        "openai"
      )
    ).toBeNull();
  });
});
