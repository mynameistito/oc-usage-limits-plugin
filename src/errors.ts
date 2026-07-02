import type { ProviderID } from "@/types.ts";

/** Expected provider error raised when no usable credentials are configured. */
export class MissingProviderCredentialsError extends Error {
  readonly kind = "missing_credentials" as const;
  readonly providerID: ProviderID;

  constructor(providerID: ProviderID, message: string) {
    super(message);
    this.name = "MissingProviderCredentialsError";
    this.providerID = providerID;
  }
}
