import { Schema } from "effect";

import { safeCause } from "@/errors-shared.ts";

/** Failure while reading an existing plugin config file. */
export class ConfigReadError extends Schema.TaggedErrorClass<ConfigReadError>()(
  "ConfigReadError",
  {
    ...safeCause,
    operation: Schema.Literal("read-config"),
    path: Schema.String,
  }
) {
  override get message(): string {
    return `Unable to read usage-limits config at ${this.path}`;
  }
}
