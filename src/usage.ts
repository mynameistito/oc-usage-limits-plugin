import { Result, Schema } from "effect";

import type { JsonValue } from "@/utils.ts";

/** Stable semantic kinds for provider quota windows. */
export type UsageWindowKind =
  | "rolling"
  | "daily"
  | "weekly"
  | "monthly"
  | "credits"
  | "other";

export const usageWindowMatchesKind = (
  kind: UsageWindowKind,
  window: { readonly kind: UsageWindowKind; readonly label: string }
): boolean =>
  window.kind === kind || (kind === "rolling" && window.label === "5h");

/** A finite percentage in the inclusive range `0..100`. */
export type Percentage = typeof PercentageSchema.Type;

/** A finite, non-negative quota count. */
export type QuotaCount = typeof QuotaCountSchema.Type;

/** A valid absolute reset instant. */
export type ResetInstant = typeof ResetInstantSchema.Type;

/** Explicit quota forms exposed by a usage window. */
export type UsageQuota =
  | {
      readonly _tag: "Percentage";
      readonly remainingPercent: Percentage;
      readonly usedPercent: Percentage;
    }
  | {
      readonly _tag: "Count";
      readonly current: QuotaCount;
      readonly remainingPercent: Percentage;
      readonly total: QuotaCount;
      readonly usedPercent: Percentage;
    }
  | { readonly _tag: "Unknown" };

/** Schema for finite percentages in the inclusive range `0..100`. */
const PercentageSchema = Schema.Finite.check(
  Schema.isBetween({ maximum: 100, minimum: 0 })
).pipe(Schema.brand("Percentage"));

/** Schema for finite, non-negative quota counts. */
const QuotaCountSchema = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0)
).pipe(Schema.brand("QuotaCount"));

/** Schema for valid absolute reset instants. */
const ResetInstantSchema = Schema.DateValid;

const parsePercentage = Schema.decodeUnknownResult(PercentageSchema);
const parseQuotaCount = Schema.decodeUnknownResult(QuotaCountSchema);
const parseResetInstant = Schema.decodeUnknownResult(ResetInstantSchema);
type UsageInput = JsonValue | Date | undefined;

/** Parses an unknown value into a finite percentage. */
export const parseUsagePercentage = (value: UsageInput) =>
  parsePercentage(value);

/** Parses an unknown value into a non-negative quota count. */
export const parseUsageCount = (value: UsageInput) => parseQuotaCount(value);

/** Parses an unknown value into a valid absolute reset instant. */
export const parseUsageResetInstant = (value: UsageInput) =>
  parseResetInstant(value);

/** Returns a valid reset instant or `null` for absent/invalid provider values. */
export const resetInstantOrNull = (value: UsageInput): ResetInstant | null => {
  const result = parseResetInstant(value);
  return Result.isFailure(result) ? null : result.success;
};

/** Creates a percentage quota from an already normalized used percentage. */
export const percentageQuota = (usedPercent: Percentage): UsageQuota => {
  const parsedUsed = PercentageSchema.make(usedPercent);
  return {
    _tag: "Percentage",
    remainingPercent: PercentageSchema.make(100 - parsedUsed),
    usedPercent: parsedUsed,
  };
};

/** Creates a count quota with its normalized percentage projection. */
export const countQuota = (
  current: QuotaCount,
  total: QuotaCount,
  usedPercent: Percentage
): UsageQuota => {
  const parsedCurrent = QuotaCountSchema.make(current);
  const parsedTotal = QuotaCountSchema.make(total);
  const parsedUsed = PercentageSchema.make(usedPercent);
  if (parsedCurrent > parsedTotal) {
    throw new RangeError("quota current count cannot exceed total count");
  }
  return {
    _tag: "Count",
    current: parsedCurrent,
    remainingPercent: PercentageSchema.make(100 - parsedUsed),
    total: parsedTotal,
    usedPercent: parsedUsed,
  };
};

/** Quota form used when a provider cannot report meaningful usage. */
export const unknownQuota: UsageQuota = { _tag: "Unknown" };

/** Renewal configuration accepted from every provider config block. */
export interface RenewalConfig {
  /** Absolute renewal instant (ISO date). Hidden once it has passed. */
  readonly renewsAt?: string;
  /** Recurring day of the month (1-31) on which the subscription renews. */
  readonly renewsOnDay?: number;
}

/**
 * Resolves the next subscription renewal instant from provider configuration.
 *
 * An absolute `renewsAt` wins while it is still in the future. Otherwise a
 * recurring `renewsOnDay` resolves to the next occurrence of that day of month,
 * clamped to the target month's length. When a past `renewsAt` accompanies the
 * recurring day, its local time-of-day is carried over so the countdown keeps
 * the subscription's exact renewal moment without further maintenance. Missing
 * configuration yields `null` so the UI can hide the renewal line.
 *
 * @param config - Renewal configuration from the provider config block.
 * @param now - Current instant used to resolve the next occurrence.
 * @returns The branded renewal instant, or `null` when it cannot be determined.
 */
export const nextRenewalInstant = (
  config: RenewalConfig | undefined,
  now: Date
): ResetInstant | null => {
  const absolute = resetInstantOrNull(
    config?.renewsAt ? new Date(config.renewsAt) : null
  );
  if (absolute && absolute.getTime() > now.getTime()) {
    return absolute;
  }

  const day = config?.renewsOnDay;
  if (day === undefined || !Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }

  const candidateFor = (base: Date): Date =>
    new Date(
      base.getFullYear(),
      base.getMonth(),
      Math.min(
        day,
        new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
      ),
      0,
      0,
      0,
      0
    );

  let candidate = candidateFor(now);
  if (candidate.getTime() <= now.getTime()) {
    candidate = candidateFor(
      new Date(now.getFullYear(), now.getMonth() + 1, 1)
    );
  }
  if (absolute) {
    candidate = new Date(
      candidate.getFullYear(),
      candidate.getMonth(),
      candidate.getDate(),
      absolute.getHours(),
      absolute.getMinutes(),
      absolute.getSeconds(),
      absolute.getMilliseconds()
    );
  }
  return resetInstantOrNull(candidate);
};

/** Returns the display percentage for a quota, or `null` when unknown. */
export const quotaUsedPercent = (quota: UsageQuota): Percentage | null =>
  quota._tag === "Unknown" ? null : quota.usedPercent;
