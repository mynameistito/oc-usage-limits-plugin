import { Schema } from "effect";

import { providerContext, safeCause } from "@/errors-shared.ts";

/** Provider transport failure without unsafe response content. */
export class ProviderTransportError extends Schema.TaggedErrorClass<ProviderTransportError>()(
  "ProviderTransportError",
  {
    ...providerContext,
    ...safeCause,
    status: Schema.optionalKey(Schema.Int),
  }
) {
  override get message(): string {
    if (this.cause === "unauthorized") {
      return "provider credentials were rejected";
    }
    if (this.cause === "forbidden") {
      return "provider access was forbidden";
    }
    return this.status === undefined
      ? "provider request failed"
      : `provider request failed (HTTP ${this.status})`;
  }
}
