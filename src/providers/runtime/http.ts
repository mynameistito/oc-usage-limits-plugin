import { Context, Effect, Layer } from "effect";

import {
  ProviderRateLimitError,
  ProviderResponseDecodeError,
  ProviderTimeoutError,
  ProviderTransportError,
} from "@/errors.ts";
import type { ProviderID } from "@/types.ts";
import type { JsonValue } from "@/utils.ts";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_OPERATION = "fetch-usage";

type ProviderHttpError =
  | ProviderRateLimitError
  | ProviderResponseDecodeError
  | ProviderTimeoutError
  | ProviderTransportError;

const cancelReader = async (
  reader: ReadableStreamDefaultReader<Uint8Array>
) => {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best-effort when the request is already complete.
  }
};

const cancelBody = async (response: Response) => {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort when the request is already complete.
  }
};

const readChunks = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: Uint8Array[],
  length: number
): Promise<number> => {
  const result = await reader.read();
  if (result.done) {
    return length;
  }
  const nextLength = length + result.value.byteLength;
  if (nextLength > MAX_RESPONSE_BYTES) {
    await reader.cancel();
    throw new RangeError("response limit exceeded");
  }
  chunks.push(result.value);
  return readChunks(reader, chunks, nextLength);
};

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
    ) => Effect.Effect<JsonValue, ProviderHttpError>;
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
    await cancelBody(response);
    throw new RangeError("response limit exceeded");
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void cancelReader(reader);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    length = await readChunks(reader, chunks, length);
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
                operation: FETCH_OPERATION,
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
              operation: FETCH_OPERATION,
              providerID: request.providerID,
              retryAfterMs: retryAfterMilliseconds(response),
            });
          }
          if (!response.ok) {
            let cause: "forbidden" | "http" | "unauthorized" = "http";
            if (response.status === 401) {
              cause = "unauthorized";
            } else if (response.status === 403) {
              cause = "forbidden";
            }
            throw new ProviderTransportError({
              cause,
              operation: "fetch-usage",
              providerID: request.providerID,
              status: response.status,
            });
          }
          const body = await readBoundedBody(response, signal);
          try {
            // SAFETY: The transport only accepts JSON values at this boundary.
            return JSON.parse(new TextDecoder().decode(body)) as JsonValue;
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
                operation: FETCH_OPERATION,
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
