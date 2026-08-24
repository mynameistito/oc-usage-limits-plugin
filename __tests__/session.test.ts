import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import { currentProviderID, usageForProvider } from "@/session.ts";
import type { ProviderState, UsageWindow } from "@/types.ts";
import {
  parseUsagePercentage,
  percentageQuota,
  quotaUsedPercent,
} from "@/usage.ts";

const window = (label: string, usedPercent = 25): UsageWindow => ({
  kind: label === "weekly" ? "weekly" : "rolling",
  label,
  quota: percentageQuota(Result.getOrThrow(parseUsagePercentage(usedPercent))),
  resetsAt: new Date("2026-06-23T12:00:00.000Z"),
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

  test("finds provider ids from v2 session message info", () => {
    expect(
      currentProviderID([
        {
          info: {
            model: { modelID: "gpt", providerID: "openai" },
            type: "user",
          },
        },
        {
          info: {
            modelID: "glm",
            providerID: "zai-coding-plan",
            type: "assistant",
          },
        },
      ])
    ).toBe("zai-coding-plan");

    expect(
      currentProviderID([
        {
          info: {
            model: { modelID: "gpt", providerID: "openai" },
            type: "user",
          },
        },
      ])
    ).toBe("openai");
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
          label: "Codex",
          windows: [window("daily"), window("5h", 75)],
        },
        id: "codex",
        label: "Codex",
        stale: false,
        status: "ready",
      },
    ];

    const usage = usageForProvider(states, "openai");
    expect(Number(usage ? quotaUsedPercent(usage.quota) : null)).toBe(75);
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
          windows: [window("MCP"), window("5h", 88)],
        },
        status: "error",
      },
    ];

    expect(usageForProvider(states, "zai-coding-plan")?.label).toBe("5h");
    const usage = usageForProvider(states, "zai-coding-plan");
    expect(Number(usage ? quotaUsedPercent(usage.quota) : null)).toBe(88);
  });

  test("selects MiniMax usage for minimax-coding-plan sessions", () => {
    const states: ProviderState[] = [
      {
        data: {
          capturedAt: new Date(),
          id: "minimax",
          label: "MiniMax",
          windows: [window("5h", 88)],
        },
        id: "minimax",
        label: "MiniMax",
        stale: false,
        status: "ready",
      },
    ];

    expect(usageForProvider(states, "minimax-coding-plan")?.label).toBe("5h");
    const usage = usageForProvider(states, "minimax-coding-plan");
    expect(Number(usage ? quotaUsedPercent(usage.quota) : null)).toBe(88);
  });

  test("selects a requested footer window and falls back to auto", () => {
    const states: ProviderState[] = [
      {
        data: {
          capturedAt: new Date(),
          id: "codex",
          label: "Codex",
          windows: [window("5h", 75), window("weekly", 88)],
        },
        id: "codex",
        label: "Codex",
        stale: false,
        status: "ready",
      },
    ];

    expect(
      usageForProvider(states, "openai", {
        codex: {
          footerWindow: "weekly",
          showFooterBar: true,
          showSidebarBar: true,
          sidebarWindow: "all",
        },
      })?.label
    ).toBe("weekly");
    expect(
      usageForProvider(states, "openai", {
        codex: {
          footerWindow: "monthly",
          showFooterBar: true,
          showSidebarBar: true,
          sidebarWindow: "all",
        },
      })?.label
    ).toBe("5h");
  });

  test("selects footer usage when its bar is hidden", () => {
    const states: ProviderState[] = [
      {
        data: {
          capturedAt: new Date(),
          id: "codex",
          label: "Codex",
          windows: [window("5h", 75)],
        },
        id: "codex",
        label: "Codex",
        stale: false,
        status: "ready",
      },
    ];

    expect(
      usageForProvider(states, "openai", {
        codex: {
          footerWindow: "auto",
          showFooterBar: false,
          showSidebarBar: true,
          sidebarWindow: "all",
        },
      })?.label
    ).toBe("5h");
  });

  test("returns null for unknown providers or unavailable data", () => {
    expect(usageForProvider([], "anthropic")).toBeNull();
    expect(
      usageForProvider(
        [{ id: "codex", label: "Codex", status: "loading" }],
        "openai"
      )
    ).toBeNull();
  });

  test("retains the documented first-provider fallback when the session provider is unavailable", () => {
    const states: ProviderState[] = [
      {
        data: {
          capturedAt: new Date(),
          id: "codex",
          label: "Codex",
          windows: [window("5h")],
        },
        id: "codex",
        label: "Codex",
        stale: false,
        status: "ready",
      },
    ];

    expect(usageForProvider(states, "anthropic")?.label).toBe("5h");
  });
});
