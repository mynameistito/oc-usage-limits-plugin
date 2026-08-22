import { Schema } from "effect";

/* eslint-disable max-classes-per-file -- Tagged boundary failures are one cohesive, discoverable error vocabulary. */

const ProviderIDSchema = Schema.Literals([
  "codex",
  "zai",
  "synthetic",
  "minimax",
  "qwen",
]);
const credentialMessages = {
  codex: "missing Codex auth",
  minimax: "missing MiniMax key",
  qwen: "missing Qwen credentials",
  synthetic: "missing Synthetic key",
  zai: "missing ZAI key",
} as const;
const ProviderOperationSchema = Schema.Literals([
  "decode-response",
  "fetch-usage",
  "read-auth",
  "run-command",
]);
const NonNegativeFiniteSchema = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0)
);

const safeCause = {
  cause: Schema.optionalKey(
    Schema.Literals([
      "command",
      "decode",
      "filesystem",
      "network",
      "rate-limit",
      "schema",
      "syntax",
      "timeout",
      "unknown",
    ])
  ),
};
const providerContext = {
  operation: ProviderOperationSchema,
  providerID: ProviderIDSchema,
};

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

/** Failure while parsing JSONC or decoding plugin config fields. */
export class ConfigDecodeError extends Schema.TaggedErrorClass<ConfigDecodeError>()(
  "ConfigDecodeError",
  {
    ...safeCause,
    operation: Schema.Literals(["parse-jsonc", "parse-config"]),
  }
) {}

/** Expected provider error raised when no usable credentials are configured. */
export class MissingProviderCredentialsError extends Schema.TaggedErrorClass<MissingProviderCredentialsError>()(
  "MissingProviderCredentialsError",
  {
    operation: ProviderOperationSchema,
    providerID: ProviderIDSchema,
  }
) {
  readonly kind = "missing_credentials" as const;

  override get message(): string {
    return credentialMessages[this.providerID];
  }
}

/** Provider transport failure without unsafe response content. */
export class ProviderTransportError extends Schema.TaggedErrorClass<ProviderTransportError>()(
  "ProviderTransportError",
  { ...providerContext, ...safeCause }
) {}

/** Provider operation exceeded its configured timeout. */
export class ProviderTimeoutError extends Schema.TaggedErrorClass<ProviderTimeoutError>()(
  "ProviderTimeoutError",
  { ...providerContext, ...safeCause, timeoutMs: NonNegativeFiniteSchema }
) {}

/** Provider rejected a request because its rate limit was reached. */
export class ProviderRateLimitError extends Schema.TaggedErrorClass<ProviderRateLimitError>()(
  "ProviderRateLimitError",
  {
    ...providerContext,
    retryAfterMs: Schema.optionalKey(NonNegativeFiniteSchema),
  }
) {}

/** Provider returned a payload that could not be decoded safely. */
export class ProviderResponseDecodeError extends Schema.TaggedErrorClass<ProviderResponseDecodeError>()(
  "ProviderResponseDecodeError",
  { ...providerContext, ...safeCause }
) {}

/** Provider subprocess command failed without exposing stdout or stderr. */
export class ProviderCommandError extends Schema.TaggedErrorClass<ProviderCommandError>()(
  "ProviderCommandError",
  {
    ...providerContext,
    ...safeCause,
    exitCode: Schema.optionalKey(Schema.Int),
  }
) {}

/** Expected provider failures defined here for boundary adoption in Plan 004. */
export type ProviderError =
  | MissingProviderCredentialsError
  | ProviderTransportError
  | ProviderTimeoutError
  | ProviderRateLimitError
  | ProviderResponseDecodeError
  | ProviderCommandError;
