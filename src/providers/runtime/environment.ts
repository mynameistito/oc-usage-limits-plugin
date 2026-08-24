import { Context, Layer, Redacted, Schema } from "effect";

import type { JsonValue } from "@/utils.ts";

const environmentReference = /^\{env:(?<name>[^}]+)\}$/iu;
type CredentialInput = JsonValue | Redacted.Redacted<string> | undefined;

const nonEmptySecret = (
  value: CredentialInput
): Redacted.Redacted<string> | undefined => {
  const revealed = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  if (!Schema.is(Schema.String)(revealed)) {
    return undefined;
  }
  const trimmed = revealed.trim();
  return trimmed === "" ? undefined : Redacted.make(trimmed);
};

/** Credential parsing and environment lookup without exposing secret values. */
export class ProviderEnvironment extends Context.Service<
  ProviderEnvironment,
  {
    readonly credential: (
      value: CredentialInput
    ) => Redacted.Redacted<string> | undefined;
    readonly resolveCredential: (
      value: CredentialInput
    ) => Redacted.Redacted<string> | undefined;
  }
>()("oc-usage-limits/ProviderEnvironment") {}

/** Constructs an environment service over a specific environment map. */
const makeProviderEnvironment = (
  environment: Readonly<Record<string, string | undefined>>
): ProviderEnvironment["Service"] => ({
  credential: nonEmptySecret,
  resolveCredential: (value) => {
    const credential = nonEmptySecret(value);
    if (!credential) {
      return;
    }
    const raw = Redacted.value(credential);
    const match = environmentReference.exec(raw);
    return match?.groups?.name
      ? nonEmptySecret(environment[match.groups.name])
      : credential;
  },
});

/** Live credential environment layer. */
export const ProviderEnvironmentLive = Layer.succeed(
  ProviderEnvironment,
  makeProviderEnvironment(process.env)
);
