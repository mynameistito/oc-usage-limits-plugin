import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import { shouldRenderProviderState } from "@/components.tsx";
import type { ProviderState, ProviderUsage } from "@/types.ts";
import { parseUsagePercentage, percentageQuota } from "@/usage.ts";

const providerUsage = (): ProviderUsage => ({
  capturedAt: new Date("2026-07-02T12:00:00.000Z"),
  id: "synthetic",
  label: "Synthetic",
  windows: [
    {
      kind: "rolling",
      label: "5h",
      quota: percentageQuota(Result.getOrThrow(parseUsagePercentage(0))),
      resetsAt: null,
    },
  ],
});

describe("sidebar provider visibility", () => {
  test("hides missing credential errors without cached usage", () => {
    const state: ProviderState = {
      errorKind: "missing_credentials",
      id: "synthetic",
      label: "Synthetic",
      message: "missing Synthetic key",
      status: "error",
    };

    expect(shouldRenderProviderState(state, true)).toBe(false);
  });

  test("keeps non-credential errors visible when error display is enabled", () => {
    const state: ProviderState = {
      id: "synthetic",
      label: "Synthetic",
      message: "invalid Synthetic usage",
      status: "error",
    };

    expect(shouldRenderProviderState(state, true)).toBe(true);
    expect(shouldRenderProviderState(state, false)).toBe(false);
  });

  test("keeps cached usage visible when a refresh hits missing credentials", () => {
    const state: ProviderState = {
      errorKind: "missing_credentials",
      id: "synthetic",
      label: "Synthetic",
      message: "missing Synthetic key",
      previous: providerUsage(),
      status: "error",
    };

    expect(shouldRenderProviderState(state, true)).toBe(true);
    expect(shouldRenderProviderState(state, false)).toBe(true);
  });

  test("hides disabled providers", () => {
    const state: ProviderState = {
      id: "synthetic",
      label: "Synthetic",
      status: "disabled",
    };

    expect(shouldRenderProviderState(state, true)).toBe(false);
  });
});
