import { describe, expect, test } from "bun:test";

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

const usageWindow = (overrides: Partial<UsageWindow> = {}): UsageWindow => ({
  label: "5h",
  remainingPercent: 58,
  resetAfterSeconds: 3600,
  resetsAt: new Date("2026-06-23T12:00:00.000Z"),
  usedPercent: 42,
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
    expect(windowMainText(usageWindow({ usedPercent: null }))).toBe("5h: ?");
  });

  test("rounds percentages to the nearest integer", () => {
    expect(windowMainText(usageWindow({ usedPercent: 42.49 }))).toBe("5h: 42%");
    expect(windowMainText(usageWindow({ usedPercent: 42.5 }))).toBe("5h: 43%");
  });

  test("formats reset durations across minute, hour, and day boundaries", () => {
    expect(windowResetText(usageWindow({ resetAfterSeconds: null }))).toBe("");
    expect(windowResetText(usageWindow({ resetAfterSeconds: 0 }))).toBe(
      " · now"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 1 }))).toBe(
      " · 1m"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 3600 }))).toBe(
      " · 1h"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 5400 }))).toBe(
      " · 1.5h"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 5460 }))).toBe(
      " · 1h 31m"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 86_400 }))).toBe(
      " · 1d"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 176_400 }))).toBe(
      " · 2d 1h"
    );
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
    expect(formatTimestamp(new Date(2026, 5, 25, 14, 32, 0, 0))).toBe("14:32");
    expect(formatTimestamp(new Date(2026, 5, 25, 9, 5, 0, 0))).toBe("09:05");
    expect(formatTimestamp(new Date(2026, 5, 25, 0, 0, 0, 0))).toBe("00:00");
  });

  test("renders token count text when window has current and total", () => {
    expect(tokenCountText(usageWindow({ current: 1500, total: 15_000 }))).toBe(
      " (1.5K/15K)"
    );
    expect(tokenCountText(usageWindow({ current: 500, total: 1000 }))).toBe(
      " (500/1K)"
    );
    expect(
      tokenCountText(usageWindow({ current: undefined, total: 1000 }))
    ).toBe("");
    expect(
      tokenCountText(usageWindow({ current: 1500, total: undefined }))
    ).toBe("");
  });

  test("formats absolute reset time when window has resetsAt", () => {
    expect(
      windowResetTime(
        usageWindow({ resetsAt: new Date("2026-06-23T12:00:00.000Z") })
      )
    ).toBe(" 12:00");
    expect(
      windowResetTime(
        usageWindow({ resetsAt: new Date("2026-06-23T23:59:00.000Z") })
      )
    ).toBe(" 23:59");
    expect(windowResetTime(usageWindow({ resetsAt: null }))).toBe("");
  });
});
