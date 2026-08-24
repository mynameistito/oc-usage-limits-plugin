import { Clock, Context, Effect, Layer } from "effect";

import { resetInstantOrNull } from "@/usage.ts";
import type { ResetInstant } from "@/usage.ts";

/** Deterministic wall-clock operations used by provider normalization. */
export class ProviderClock extends Context.Service<
  ProviderClock,
  {
    readonly after: (
      milliseconds: number
    ) => Effect.Effect<ResetInstant | null>;
    readonly now: Effect.Effect<Date>;
  }
>()("oc-usage-limits/ProviderClock") {}

/** Provider clock backed by Effect's interruptible, testable clock. */
export const ProviderClockLive = Layer.succeed(ProviderClock, {
  after: (milliseconds) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) =>
        Number.isFinite(milliseconds) && milliseconds >= 0
          ? resetInstantOrNull(new Date(now + milliseconds))
          : null
      )
    ),
  now: Clock.currentTimeMillis.pipe(
    Effect.map((milliseconds) => new Date(milliseconds))
  ),
});
