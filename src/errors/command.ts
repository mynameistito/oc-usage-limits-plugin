import { Schema } from "effect";

import { providerContext, safeCause } from "@/errors-shared.ts";

/** Provider subprocess command failed without exposing stdout or stderr. */
export class ProviderCommandError extends Schema.TaggedErrorClass<ProviderCommandError>()(
  "ProviderCommandError",
  {
    ...providerContext,
    ...safeCause,
    exitCode: Schema.optionalKey(Schema.Int),
  }
) {
  override get message(): string {
    return this.exitCode === undefined
      ? "provider command failed"
      : `provider command failed (exit code ${this.exitCode})`;
  }
}
