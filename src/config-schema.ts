import { Effect, Redacted, Result, Schema } from "effect";

import { ConfigDecodeError } from "@/errors.ts";
import type { OpenCodeAuth, ResolvedUsageLimitsConfig } from "@/types.ts";
import { isRecord } from "@/utils.ts";
import type { JsonValue } from "@/utils.ts";

const defaultKey = <S extends Schema.Top>(schema: S, value: S["Encoded"]) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const secret = Schema.RedactedFromValue(Schema.String, {
  disallowEncode: true,
  label: "credential",
});

const usageWindowKinds = [
  "rolling",
  "daily",
  "weekly",
  "monthly",
  "credits",
  "other",
] as const;

const commonProviderFields = {
  enabled: Schema.optionalKey(Schema.Boolean),
  footerWindow: defaultKey(
    Schema.Literals([
      "auto",
      "rolling",
      "daily",
      "weekly",
      "monthly",
      "credits",
      "other",
    ]),
    "auto"
  ),
  label: Schema.optionalKey(Schema.String),
  showFooterBar: defaultKey(Schema.Boolean, true),
  showSidebarBar: defaultKey(Schema.Boolean, true),
  sidebarWindow: defaultKey(
    Schema.Literals(["all", ...usageWindowKinds]),
    "all"
  ),
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
});

const decodeConfig = Schema.decodeUnknownResult(configSchema, {
  errors: "all",
  onExcessProperty: "error",
});
const decodeCredential = Schema.decodeUnknownResult(secret);

type CredentialInput = JsonValue | Redacted.Redacted<string> | undefined;
type CredentialValue = string | Redacted.Redacted<string> | null | undefined;

const parseCredential = (input: CredentialInput) => {
  const result = decodeCredential(input);
  return Result.isSuccess(result) ? result.success : undefined;
};

const parseAuthEntry = (input: CredentialInput) => {
  if (!isRecord(input)) {
    return;
  }
  const apiKey = parseCredential(input.apiKey);
  const key = parseCredential(input.key);
  if (!(apiKey || key)) {
    return;
  }
  const result: Record<string, Redacted.Redacted<string>> = {};
  if (apiKey) {
    result.apiKey = apiKey;
  }
  if (key) {
    result.key = key;
  }
  return result;
};

const parseOpenAIEntry = (input: CredentialInput) => {
  if (!isRecord(input)) {
    return;
  }
  const access = parseCredential(input.access);
  const accountId = parseCredential(input.accountId);
  if (!(access || accountId)) {
    return;
  }
  const result: Record<string, Redacted.Redacted<string>> = {};
  if (access) {
    result.access = access;
  }
  if (accountId) {
    result.accountId = accountId;
  }
  return result;
};

/** Parses unknown plugin config into a fully resolved immutable value. */
export const parseUsageLimitsConfig = (
  input: JsonValue
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
  const config = { ...result.success };
  delete config.$schema;
  return Result.succeed(config);
};

/** Best-effort parser for recognized OpenCode auth fields. */
export const parseOpenCodeAuth = (input: JsonValue): OpenCodeAuth => {
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

  const result: OpenCodeAuth = {};
  if (minimax) {
    result.minimax = minimax;
  }
  if (minimaxCodingPlan) {
    result["minimax-coding-plan"] = minimaxCodingPlan;
  }
  if (minimaxTokenPlan) {
    result["minimax-token-plan"] = minimaxTokenPlan;
  }
  if (openai) {
    result.openai = openai;
  }
  if (synthetic) {
    result.synthetic = synthetic;
  }
  if (zai) {
    result.zai = zai;
  }
  if (zaiCodingPlan) {
    result["zai-coding-plan"] = zaiCodingPlan;
  }
  if (openCodeGo) {
    result["opencode-go"] = openCodeGo;
  }
  if (opencode) {
    result.opencode = opencode;
  }
  return result;
};

/** Reveals a credential only at an adapter boundary that needs the raw value. */
export const credentialValue = (
  credential: CredentialValue
): string | undefined => {
  const value = Redacted.isRedacted(credential)
    ? Redacted.value(credential)
    : credential;
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
};
