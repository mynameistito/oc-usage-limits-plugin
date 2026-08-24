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

/** Parses an unknown value into a finite percentage. */
export const parseUsagePercentage = (
  value: JsonValue
): Result.Result<Percentage, Schema.SchemaError> => parsePercentage(value);

/** Parses an unknown value into a non-negative quota count. */
export const parseUsageCount = (
  value: JsonValue
): Result.Result<QuotaCount, Schema.SchemaError> => parseQuotaCount(value);

/** Parses an unknown value into a valid absolute reset instant. */
export const parseUsageResetInstant = (
  value: JsonValue | Date
): Result.Result<ResetInstant, Schema.SchemaError> => parseResetInstant(value);

/** Returns a valid reset instant or `null` for absent/invalid provider values. */
export const resetInstantOrNull = (
  value: JsonValue | Date
): ResetInstant | null => {
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

/** Returns the display percentage for a quota, or `null` when unknown. */
export const quotaUsedPercent = (quota: UsageQuota): Percentage | null =>
  quota._tag === "Unknown" ? null : quota.usedPercent;
