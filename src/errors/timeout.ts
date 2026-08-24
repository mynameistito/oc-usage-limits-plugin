import { Schema } from "effect";

import {
  NonNegativeFiniteSchema,
  providerContext,
  safeCause,
} from "@/errors-shared.ts";

/** Provider operation exceeded its configured timeout. */
export class ProviderTimeoutError extends Schema.TaggedErrorClass<ProviderTimeoutError>()(
  "ProviderTimeoutError",
  { ...providerContext, ...safeCause, timeoutMs: NonNegativeFiniteSchema }
) {
  override get message(): string {
    return `provider operation timed out after ${this.timeoutMs}ms`;
  }
}
