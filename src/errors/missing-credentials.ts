import { Schema } from "effect";

import {
  credentialMessages,
  ProviderIDSchema,
  ProviderOperationSchema,
} from "@/errors-shared.ts";

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
