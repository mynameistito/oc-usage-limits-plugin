import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import {
  countQuota,
  parseUsageCount,
  parseUsagePercentage,
  parseUsageResetInstant,
} from "@/usage.ts";
import type { Percentage, QuotaCount } from "@/usage.ts";

type IsAssignable<From, To> = From extends To ? true : false;
const plainNumberIsPercentage: IsAssignable<number, Percentage> = false;
const plainNumberIsQuotaCount: IsAssignable<number, QuotaCount> = false;

describe("usage domain invariants", () => {
  test("keeps refined numeric types nominal", () => {
    expect(plainNumberIsPercentage).toBe(false);
    expect(plainNumberIsQuotaCount).toBe(false);
  });
  test.each([0, 42.5, 100])("accepts finite percentage %s", (value) => {
    expect(Result.isSuccess(parseUsagePercentage(value))).toBe(true);
  });

  test.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid percentage %s",
    (value) => {
      expect(Result.isFailure(parseUsagePercentage(value))).toBe(true);
    }
  );

  test("accepts only finite non-negative counts", () => {
    expect(Result.isSuccess(parseUsageCount(0))).toBe(true);
    expect(Result.isSuccess(parseUsageCount(12.5))).toBe(true);
    expect(Result.isFailure(parseUsageCount(-1))).toBe(true);
    expect(Result.isFailure(parseUsageCount(Number.POSITIVE_INFINITY))).toBe(
      true
    );
  });

  test("rejects count quotas whose current value exceeds the total", () => {
    const current = Result.getOrThrow(parseUsageCount(20));
    const total = Result.getOrThrow(parseUsageCount(10));
    const used = Result.getOrThrow(parseUsagePercentage(100));

    expect(() => countQuota(current, total, used)).toThrow(
      "quota current count cannot exceed total count"
    );
  });

  test("accepts only valid Date reset instants", () => {
    expect(
      Result.isSuccess(
        parseUsageResetInstant(new Date("2026-08-14T12:00:00.000Z"))
      )
    ).toBe(true);
    expect(
      Result.isFailure(parseUsageResetInstant(new Date("invalid date")))
    ).toBe(true);
    expect(Result.isFailure(parseUsageResetInstant("2026-08-14"))).toBe(true);
  });
});
