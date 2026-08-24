import { Effect, Redacted, Result, Schema } from "effect";

import { ConfigDecodeError } from "@/errors.ts";
import type { OpenCodeAuth, ResolvedUsageLimitsConfig } from "@/types.ts";
import { isRecord } from "@/utils.ts";

const defaultKey = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const secret = Schema.RedactedFromValue(Schema.String, {
  disallowEncode: true,
  label: "credential",
});

const commonProviderFields = {
  enabled: Schema.optionalKey(Schema.Boolean),
  label: Schema.optionalKey(Schema.String),
};

/** Schema for Codex provider configuration. */
export const codexProviderConfigSchema = Schema.Struct({
  ...commonProviderFields,
  apiKey: Schema.optionalKey(secret),
  authPath: Schema.optionalKey(Schema.String),
  authorizationScheme: Schema.optionalKey(Schema.Literals(["raw", "bearer"])),
  baseUrl: Schema.optionalKey(Schema.String),
});

/** Schema for ZAI provider configuration. */
export const zaiProviderConfigSchema = Schema.Struct({
  ...commonProviderFields,
  apiKey: Schema.optionalKey(secret),
  authPath: Schema.optionalKey(Schema.String),
  authorizationScheme: Schema.optionalKey(Schema.Literals(["raw", "bearer"])),
});

/** Schema for Synthetic provider configuration. */
export const syntheticProviderConfigSchema = Schema.Struct({
  ...commonProviderFields,
  apiKey: Schema.optionalKey(secret),
  authPath: Schema.optionalKey(Schema.String),
  baseUrl: Schema.optionalKey(Schema.String),
});

/** Schema for MiniMax provider configuration. */
export const minimaxProviderConfigSchema = Schema.Struct({
  ...commonProviderFields,
  apiKey: Schema.optionalKey(secret),
  authPath: Schema.optionalKey(Schema.String),
  baseUrl: Schema.optionalKey(Schema.String),
});

/** Schema for Qwen provider configuration. */
export const qwenProviderConfigSchema = Schema.Struct(commonProviderFields);

/** Schema for OpenCode GO provider configuration. */
export const openCodeGoProviderConfigSchema = Schema.Struct({
  ...commonProviderFields,
  apiKey: Schema.optionalKey(secret),
  authPath: Schema.optionalKey(Schema.String),
  baseUrl: Schema.optionalKey(Schema.String),
});

const providersSchema = Schema.Struct({
  codex: Schema.optionalKey(codexProviderConfigSchema),
  minimax: Schema.optionalKey(minimaxProviderConfigSchema),
  "opencode-go": Schema.optionalKey(openCodeGoProviderConfigSchema),
  qwen: Schema.optionalKey(qwenProviderConfigSchema),
  synthetic: Schema.optionalKey(syntheticProviderConfigSchema),
  zai: Schema.optionalKey(zaiProviderConfigSchema),
});

const configSchema = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  enabled: defaultKey(Schema.Boolean, true),
  providers: defaultKey(providersSchema, {}),
  refreshIntervalSeconds: defaultKey(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(15)),
    60
  ),
  requestTimeoutMs: defaultKey(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1000)),
    10_000
  ),
  showErrors: defaultKey(Schema.Boolean, true),
  showFooter: defaultKey(Schema.Boolean, true),
  showSidebar: defaultKey(Schema.Boolean, true),
});

const decodeConfig = Schema.decodeUnknownResult(configSchema, {
  errors: "all",
  onExcessProperty: "error",
});
const decodeCredential = Schema.decodeUnknownResult(secret);

const parseCredential = (input: unknown) => {
  const result = decodeCredential(input);
  return Result.isSuccess(result) ? result.success : undefined;
};

const parseAuthEntry = (input: unknown) => {
  if (!isRecord(input)) {
    return;
  }
  const apiKey = parseCredential(input.apiKey);
  const key = parseCredential(input.key);
  return apiKey || key
    ? { ...(apiKey ? { apiKey } : {}), ...(key ? { key } : {}) }
    : undefined;
};

const parseOpenAIEntry = (input: unknown) => {
  if (!isRecord(input)) {
    return;
  }
  const access = parseCredential(input.access);
  const accountId = parseCredential(input.accountId);
  return access || accountId
    ? { ...(access ? { access } : {}), ...(accountId ? { accountId } : {}) }
    : undefined;
};

/** Parses unknown plugin config into a fully resolved immutable value. */
export const parseUsageLimitsConfig = (
  input: unknown
): Result.Result<ResolvedUsageLimitsConfig, ConfigDecodeError> => {
  const result = decodeConfig(input);
  if (Result.isFailure(result)) {
    return Result.fail(
      new ConfigDecodeError({
        cause: "schema",
        operation: "parse-config",
      })
    );
  }
  const { $schema: _schema, ...config } = result.success;
  return Result.succeed(config);
};

/** Best-effort parser for recognized OpenCode auth fields. */
export const parseOpenCodeAuth = (input: unknown): OpenCodeAuth => {
  if (!isRecord(input)) {
    return {};
  }

  const minimax = parseAuthEntry(input.minimax);
  const minimaxCodingPlan = parseAuthEntry(input["minimax-coding-plan"]);
  const minimaxTokenPlan = parseAuthEntry(input["minimax-token-plan"]);
  const openai = parseOpenAIEntry(input.openai);
  const synthetic = parseAuthEntry(input.synthetic);
  const zai = parseAuthEntry(input.zai);
  const zaiCodingPlan = parseAuthEntry(input["zai-coding-plan"]);
  const openCodeGo = parseAuthEntry(input["opencode-go"]);
  const opencode = parseAuthEntry(input.opencode);

  return {
    ...(minimax ? { minimax } : {}),
    ...(minimaxCodingPlan ? { "minimax-coding-plan": minimaxCodingPlan } : {}),
    ...(minimaxTokenPlan ? { "minimax-token-plan": minimaxTokenPlan } : {}),
    ...(openai ? { openai } : {}),
    ...(synthetic ? { synthetic } : {}),
    ...(zai ? { zai } : {}),
    ...(zaiCodingPlan ? { "zai-coding-plan": zaiCodingPlan } : {}),
    ...(openCodeGo ? { "opencode-go": openCodeGo } : {}),
    ...(opencode ? { opencode } : {}),
  };
};

/** Reveals a credential only at an adapter boundary that needs the raw value. */
export const credentialValue = (credential: unknown): string | undefined => {
  const value = Redacted.isRedacted(credential)
    ? Redacted.value(credential)
    : credential;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};
