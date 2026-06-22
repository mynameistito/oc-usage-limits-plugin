import { describe, expect, test } from "bun:test";

import {
  bottomWindowMainText,
  limitLabelForWindow,
  windowMainText,
  windowResetText,
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
      "5h: 42%"
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
      " resets now"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 1 }))).toBe(
      " resets 1m"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 3600 }))).toBe(
      " resets 1h"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 5460 }))).toBe(
      " resets 1h 31m"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 86_400 }))).toBe(
      " resets 1d"
    );
    expect(windowResetText(usageWindow({ resetAfterSeconds: 176_400 }))).toBe(
      " resets 2d 1h"
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
});
