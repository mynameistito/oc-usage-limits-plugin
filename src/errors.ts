/* oxlint-disable eslint/max-classes-per-file -- Tagged boundary failures are one cohesive, discoverable error vocabulary. */

import { Schema } from "effect";

/* eslint-disable class-methods-use-this, no-nested-ternary */

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
      "forbidden",
      "http",
      "network",
      "output-limit",
      "rate-limit",
      "schema",
      "syntax",
      "timeout",
      "unauthorized",
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

/** Provider operation exceeded its configured timeout. */
export class ProviderTimeoutError extends Schema.TaggedErrorClass<ProviderTimeoutError>()(
  "ProviderTimeoutError",
  { ...providerContext, ...safeCause, timeoutMs: NonNegativeFiniteSchema }
) {
  override get message(): string {
    return "provider operation timed out";
  }
}

/** Provider rejected a request because its rate limit was reached. */
export class ProviderRateLimitError extends Schema.TaggedErrorClass<ProviderRateLimitError>()(
  "ProviderRateLimitError",
  {
    ...providerContext,
    retryAfterMs: Schema.optionalKey(NonNegativeFiniteSchema),
  }
) {
  override get message(): string {
    return "provider rate limit reached";
  }
}

/** Provider returned a payload that could not be decoded safely. */
export class ProviderResponseDecodeError extends Schema.TaggedErrorClass<ProviderResponseDecodeError>()(
  "ProviderResponseDecodeError",
  { ...providerContext, ...safeCause }
) {
  override get message(): string {
    return `invalid ${this.providerID === "minimax" ? "MiniMax" : this.providerID === "zai" ? "ZAI" : this.providerID === "synthetic" ? "Synthetic" : this.providerID === "codex" ? "Codex" : "Qwen"} usage`;
  }
}

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

/** Expected provider failures defined here for boundary adoption in Plan 004. */
export type ProviderError =
  | MissingProviderCredentialsError
  | ProviderTransportError
  | ProviderTimeoutError
  | ProviderRateLimitError
  | ProviderResponseDecodeError
  | ProviderCommandError;
