import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import {
  bottomWindowMainText,
  formatTimestamp,
  formatTokenCount,
  limitLabelForWindow,
  percentBar,
  tokenCountText,
  windowMainText,
  windowResetText,
  windowResetTime,
} from "@/format.ts";
import type { UsageWindow } from "@/types.ts";
import type { UsageQuota } from "@/usage.ts";
import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  percentageQuota,
} from "@/usage.ts";

const NOW = new Date("2026-06-23T11:00:00.000Z");
const percentage = (usedPercent: number | null): UsageQuota =>
  usedPercent === null
    ? { _tag: "Unknown" }
    : percentageQuota(Result.getOrThrow(parseUsagePercentage(usedPercent)));
const usageWindow = (overrides: Partial<UsageWindow> = {}): UsageWindow => ({
  kind: "rolling",
  label: "5h",
  quota: percentage(42),
  resetsAt: new Date("2026-06-23T12:00:00.000Z"),
  ...overrides,
});

describe("format helpers", () => {
  test("formats usage window main labels", () => {
    expect(windowMainText(usageWindow())).toBe("5h: 42%");
    expect(bottomWindowMainText(usageWindow({ label: "daily" }))).toBe(
      "daily 42%"
    );
  });

  test("uses a placeholder for unknown percentages", () => {
    expect(windowMainText(usageWindow({ quota: percentage(null) }))).toBe(
      "5h: ?"
    );
  });

  test("rounds percentages to the nearest integer", () => {
    expect(windowMainText(usageWindow({ quota: percentage(42.49) }))).toBe(
      "5h: 42%"
    );
    expect(windowMainText(usageWindow({ quota: percentage(42.5) }))).toBe(
      "5h: 43%"
    );
  });

  test.each([
    [null, ""],
    [0, " · now"],
    [1, " · 1m"],
    [3600, " · 1h"],
    [5400, " · 1.5h"],
    [5460, " · 1h 31m"],
    [86_400, " · 1d"],
    [176_400, " · 2d 1h"],
  ] as const)("formats a %s second reset duration", (seconds, expected) => {
    const resetsAt =
      seconds === null ? null : new Date(NOW.getTime() + seconds * 1000);
    expect(windowResetText(usageWindow({ resetsAt }), NOW)).toBe(expected);
  });

  test("maps known limit windows with tolerance", () => {
    expect(limitLabelForWindow(5 * 60 * 60, "fallback")).toBe("5h");
    expect(
      limitLabelForWindow(Math.floor(24 * 60 * 60 * 0.96), "fallback")
    ).toBe("daily");
    expect(limitLabelForWindow(7 * 24 * 60 * 60, "fallback")).toBe("weekly");
    expect(limitLabelForWindow(30 * 24 * 60 * 60, "fallback")).toBe("monthly");
    expect(limitLabelForWindow(42, "fallback")).toBe("fallback");
  });

  test("renders percent bar with filled and empty blocks", () => {
    expect(percentBar(42, 12)).toBe("[█████░░░░░░░]");
    expect(percentBar(75, 8)).toBe("[██████░░]");
    expect(percentBar(null, 12)).toBe("[░░░░░░░░░░░░]");
    expect(percentBar(0, 12)).toBe("[░░░░░░░░░░░░]");
    expect(percentBar(100, 12)).toBe("[████████████]");
  });

  test("formats token counts with K/M suffixes", () => {
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(1500)).toBe("1.5K");
    expect(formatTokenCount(15_000)).toBe("15K");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatTokenCount(15_000_000)).toBe("15M");
  });

  test("formats timestamp as HH:MM", () => {
    expect(formatTimestamp(new Date(2026, 5, 25, 14, 32))).toBe("14:32");
    expect(formatTimestamp(new Date(2026, 5, 25, 9, 5))).toBe("09:05");
    expect(formatTimestamp(new Date(2026, 5, 25, 0, 0))).toBe("00:00");
  });

  test("renders token count text only for count quotas", () => {
    expect(
      tokenCountText(
        usageWindow({
          quota: countQuota(
            Result.getOrThrow(parseUsageCount(1500)),
            Result.getOrThrow(parseUsageCount(15_000)),
            Result.getOrThrow(parseUsagePercentage(10))
          ),
        })
      )
    ).toBe(" (1.5K/15K)");
    expect(tokenCountText(usageWindow())).toBe("");
  });

  test("formats absolute reset time", () => {
    expect(
      windowResetTime(usageWindow({ resetsAt: new Date(2026, 5, 23, 23, 59) }))
    ).toBe(" 23:59");
    expect(windowResetTime(usageWindow({ resetsAt: null }))).toBe("");
  });
});
