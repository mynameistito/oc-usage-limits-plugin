import type { ProviderCommandError } from "@/errors/command.ts";
import type { MissingProviderCredentialsError } from "@/errors/missing-credentials.ts";
import type { ProviderRateLimitError } from "@/errors/rate-limit.ts";
import type { ProviderResponseDecodeError } from "@/errors/response-decode.ts";
import type { ProviderTimeoutError } from "@/errors/timeout.ts";
import type { ProviderTransportError } from "@/errors/transport.ts";

export { ConfigDecodeError } from "@/errors/config-decode.ts";
export { ConfigReadError } from "@/errors/config-read.ts";
export { ProviderCommandError } from "@/errors/command.ts";
export { MissingProviderCredentialsError } from "@/errors/missing-credentials.ts";
export { ProviderRateLimitError } from "@/errors/rate-limit.ts";
export { ProviderResponseDecodeError } from "@/errors/response-decode.ts";
export { ProviderTimeoutError } from "@/errors/timeout.ts";
export { ProviderTransportError } from "@/errors/transport.ts";

/** Expected provider failures defined here for boundary adoption in Plan 004. */
export type ProviderError =
  | MissingProviderCredentialsError
  | ProviderTransportError
  | ProviderTimeoutError
  | ProviderRateLimitError
  | ProviderResponseDecodeError
  | ProviderCommandError;
