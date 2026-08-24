import { Schema } from "effect";

import { NonNegativeFiniteSchema, providerContext } from "@/errors-shared.ts";

/** Provider rejected a request because its rate limit was reached. */
export class ProviderRateLimitError extends Schema.TaggedErrorClass<ProviderRateLimitError>()(
  "ProviderRateLimitError",
  {
    ...providerContext,
    retryAfterMs: Schema.optionalKey(NonNegativeFiniteSchema),
  }
) {
  override get message(): string {
    return this.retryAfterMs === undefined
      ? "provider rate limit reached"
      : `provider rate limit reached; retry after ${this.retryAfterMs}ms`;
  }
}
