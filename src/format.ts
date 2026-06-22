import type { UsageWindow } from "@/types.ts";

/**
 * Formats a positive duration in seconds into the compact label used by the TUI.
 *
 * Values that are missing, invalid, or already elapsed are displayed as `now`.
 * Positive values are rounded up to the next minute so near-future resets never
 * appear as zero minutes remaining.
 *
 * @param seconds - Duration, in seconds, until the event occurs.
 * @returns A short human-readable duration such as `3m`, `2h 15m`, or `1d 4h`.
 */
const duration = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "now";
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) {
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }

  const days = Math.floor(hours / 24);
  const hourRemainder = hours % 24;
  return hourRemainder === 0 ? `${days}d` : `${days}d ${hourRemainder}h`;
};

/**
 * Formats a nullable usage percentage for display.
 *
 * @param value - The percentage to render, or `null` when the provider did not
 *   report a percentage.
 * @returns A rounded usage string, or `? used` when usage is unknown.
 */
const formatPercent = (value: number | null): string =>
  value === null ? "? used" : `${Math.round(value)}% used`;

/**
 * Builds the primary line of text for a usage window in the sidebar panel.
 *
 * @param window - The provider usage window to summarize.
 * @returns A label and percentage pair such as `daily: 42% used`.
 */
export const windowMainText = (window: UsageWindow): string =>
  `${window.label}: ${formatPercent(window.usedPercent)}`;

/**
 * Builds the compact prompt-footer text for the active provider's primary window.
 *
 * The prompt footer is intentionally fixed to the familiar `5h` label used by
 * OpenAI/Codex-style limits, even when the selected provider exposes a different
 * internal window label.
 *
 * @param window - The active provider usage window to summarize.
 * @returns A compact percentage label such as `5h: 42% used`.
 */
export const bottomWindowMainText = (window: UsageWindow): string =>
  `5h: ${formatPercent(window.usedPercent)}`;

/**
 * Formats the reset suffix for a usage window.
 *
 * @param window - The usage window whose reset time should be rendered.
 * @returns A leading-space suffix such as ` resets 12m`, or an empty string when
 *   the provider did not report a reset countdown.
 */
export const windowResetText = (window: UsageWindow): string =>
  window.resetAfterSeconds === null
    ? ""
    : ` resets ${duration(window.resetAfterSeconds)}`;

/**
 * Converts a provider-reported rolling-window size into a stable display label.
 *
 * Provider APIs can return slightly imprecise window lengths, so expected
 * windows are matched within a 5% tolerance before falling back to the caller's
 * label.
 *
 * @param seconds - The provider-reported limit window length in seconds.
 * @param fallback - Label to use when the window does not match a known size.
 * @returns A normalized label such as `5h`, `daily`, `weekly`, or `monthly`.
 */
export const limitLabelForWindow = (
  seconds: number,
  fallback: string
): string => {
  const minutes = Math.ceil(seconds / 60);
  const roughly = (expected: number) =>
    minutes >= expected * 0.95 && minutes <= expected * 1.05;
  const hour = 60;
  const day = 24 * hour;

  if (roughly(5 * hour)) {
    return "5h";
  }
  if (roughly(day)) {
    return "daily";
  }
  if (roughly(7 * day)) {
    return "weekly";
  }
  if (roughly(30 * day)) {
    return "monthly";
  }
  return fallback;
};
