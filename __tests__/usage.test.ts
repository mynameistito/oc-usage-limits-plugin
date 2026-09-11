import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import {
  countQuota,
  nextRenewalInstant,
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

const at = (iso: string): Date => new Date(iso);

describe("nextRenewalInstant", () => {
  test("returns the configured absolute renewal instant when in the future", () => {
    const now = at("2026-09-10T12:00:00.000Z");
    expect(
      nextRenewalInstant(
        { renewsAt: "2026-10-05T09:00:00.000Z" },
        now
      )?.toISOString()
    ).toBe("2026-10-05T09:00:00.000Z");
  });

  test("returns null for past, invalid, or missing renewals", () => {
    const now = at("2026-09-10T12:00:00.000Z");
    expect(
      nextRenewalInstant({ renewsAt: "2026-09-01T00:00:00.000Z" }, now)
    ).toBeNull();
    expect(nextRenewalInstant({ renewsAt: "not-a-date" }, now)).toBeNull();
    expect(nextRenewalInstant({}, now)).toBeNull();
    expect(nextRenewalInstant(undefined, now)).toBeNull();
  });

  test("computes the next occurrence of the renewal day this month", () => {
    const now = at("2026-09-10T12:00:00.000Z");
    const renewal = nextRenewalInstant({ renewsOnDay: 14 }, now);
    expect(renewal).not.toBeNull();
    expect(renewal?.getFullYear()).toBe(2026);
    expect(renewal?.getMonth()).toBe(8);
    expect(renewal?.getDate()).toBe(14);
    expect(renewal?.getHours()).toBe(0);
    expect(renewal?.getTime()).toBeGreaterThan(now.getTime());
  });

  test("rolls to next month when the renewal day already passed", () => {
    const renewal = nextRenewalInstant(
      { renewsOnDay: 5 },
      at("2026-09-10T12:00:00.000Z")
    );
    expect(renewal?.getMonth()).toBe(9);
    expect(renewal?.getDate()).toBe(5);
  });

  test("clamps to the last day of short months", () => {
    const renewal = nextRenewalInstant(
      { renewsOnDay: 31 },
      at("2027-02-01T12:00:00.000Z")
    );
    expect(renewal?.getMonth()).toBe(1);
    expect(renewal?.getDate()).toBe(28);
  });

  test("rolls to next month when today is the renewal day after midnight", () => {
    const renewal = nextRenewalInstant(
      { renewsOnDay: 10 },
      at("2026-09-10T12:00:00.000Z")
    );
    expect(renewal?.getMonth()).toBe(9);
    expect(renewal?.getDate()).toBe(10);
  });

  test("prefers the absolute instant over the recurring day", () => {
    const renewal = nextRenewalInstant(
      { renewsAt: "2026-09-20T00:00:00.000Z", renewsOnDay: 21 },
      at("2026-09-10T12:00:00.000Z")
    );
    expect(renewal?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  test("falls back to the recurring day when the absolute instant passed", () => {
    const renewal = nextRenewalInstant(
      { renewsAt: "2026-09-01T00:00:00.000Z", renewsOnDay: 20 },
      at("2026-09-10T12:00:00.000Z")
    );
    expect(renewal?.getDate()).toBe(20);
  });
});

describe("nextRenewalInstant time carryover", () => {
  test("carries the absolute instant time-of-day into the recurring fallback", () => {
    const renewal = nextRenewalInstant(
      { renewsAt: "2026-08-17T23:06:56", renewsOnDay: 17 },
      at("2026-09-10T12:00:00.000Z")
    );
    expect(renewal?.getMonth()).toBe(8);
    expect(renewal?.getDate()).toBe(17);
    expect(renewal?.getHours()).toBe(23);
    expect(renewal?.getMinutes()).toBe(6);
    expect(renewal?.getSeconds()).toBe(56);
  });

  test("keeps midnight for recurring days without an absolute instant", () => {
    const renewal = nextRenewalInstant(
      { renewsOnDay: 17 },
      at("2026-09-10T12:00:00.000Z")
    );
    expect(renewal?.getDate()).toBe(17);
    expect(renewal?.getHours()).toBe(0);
    expect(renewal?.getMinutes()).toBe(0);
  });
});
