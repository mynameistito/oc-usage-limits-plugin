import { Context, Effect, Layer } from "effect";

import {
  ProviderRateLimitError,
  ProviderResponseDecodeError,
  ProviderTimeoutError,
  ProviderTransportError,
} from "@/errors.ts";
import type { ProviderID } from "@/types.ts";

/* eslint-disable no-await-in-loop, no-empty-function, no-nested-ternary, prefer-await-to-then */

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** A bounded provider JSON request. */
export interface ProviderHttpRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET";
  readonly providerID: ProviderID;
  readonly timeoutMs: number;
  readonly url: string;
}

/** Fetch-compatible function accepted by the live HTTP service constructor. */
export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/** Bounded, interruptible JSON HTTP transport with provider-safe failures. */
export class ProviderHttpClient extends Context.Service<
  ProviderHttpClient,
  {
    readonly requestJson: (
      request: ProviderHttpRequest
    ) => Effect.Effect<
      unknown,
      | ProviderTransportError
      | ProviderTimeoutError
      | ProviderRateLimitError
      | ProviderResponseDecodeError
    >;
  }
>()("oc-usage-limits/ProviderHttpClient") {}

const retryAfterMilliseconds = (response: Response): number | undefined => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
};

const readBoundedBody = async (
  response: Response,
  signal: AbortSignal
): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new RangeError("response limit exceeded");
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RangeError("response limit exceeded");
      }
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

/** Constructs a bounded HTTP layer over a fetch implementation. */
export const makeProviderHttpClient = (fetchImplementation: ProviderFetch) =>
  Layer.succeed(ProviderHttpClient, {
    requestJson: (request) => {
      const operation = Effect.tryPromise({
        catch: (error) => {
          if (
            error instanceof ProviderRateLimitError ||
            error instanceof ProviderTransportError ||
            error instanceof ProviderResponseDecodeError
          ) {
            return error;
          }
          return error instanceof RangeError
            ? new ProviderResponseDecodeError({
                cause: "output-limit",
                operation: "decode-response",
                providerID: request.providerID,
              })
            : new ProviderTransportError({
                cause: "network",
                operation: "fetch-usage",
                providerID: request.providerID,
              });
        },
        try: async (signal) => {
          const response = await fetchImplementation(request.url, {
            headers: request.headers,
            method: request.method,
            signal,
          });
          if (response.status === 429) {
            throw new ProviderRateLimitError({
              operation: "fetch-usage",
              providerID: request.providerID,
              retryAfterMs: retryAfterMilliseconds(response),
            });
          }
          if (!response.ok) {
            throw new ProviderTransportError({
              cause:
                response.status === 401
                  ? "unauthorized"
                  : response.status === 403
                    ? "forbidden"
                    : "http",
              operation: "fetch-usage",
              providerID: request.providerID,
              status: response.status,
            });
          }
          const body = await readBoundedBody(response, signal);
          try {
            return JSON.parse(new TextDecoder().decode(body)) as unknown;
          } catch {
            throw new ProviderResponseDecodeError({
              cause: "decode",
              operation: "decode-response",
              providerID: request.providerID,
            });
          }
        },
      });

      return operation.pipe(
        Effect.timeoutOrElse({
          duration: request.timeoutMs,
          orElse: () =>
            Effect.fail(
              new ProviderTimeoutError({
                cause: "timeout",
                operation: "fetch-usage",
                providerID: request.providerID,
                timeoutMs: request.timeoutMs,
              })
            ),
        })
      );
    },
  });

/** Live bounded JSON HTTP layer. */
export const ProviderHttpClientLive = makeProviderHttpClient((input, init) =>
  globalThis.fetch(input, init)
);
