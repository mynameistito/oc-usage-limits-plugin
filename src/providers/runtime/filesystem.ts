import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Context, Effect, Layer } from "effect";

import {
  ProviderResponseDecodeError,
  ProviderTransportError,
} from "@/errors.ts";
import type { ProviderID } from "@/types.ts";

const MAX_AUTH_FILE_BYTES = 1024 * 1024;

const expandHome = (value: string): string =>
  value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(homedir(), value.slice(2))
    : value;

/** Context supplied when reading provider-owned credential files. */
export interface ProviderFileInput {
  readonly path: string;
  readonly providerID: ProviderID;
}

/** Bounded provider credential-file access and JSON decoding. */
export class ProviderFileSystem extends Context.Service<
  ProviderFileSystem,
  {
    readonly readJson: (
      input: ProviderFileInput
    ) => Effect.Effect<
      unknown,
      ProviderTransportError | ProviderResponseDecodeError
    >;
    readonly readText: (
      input: ProviderFileInput
    ) => Effect.Effect<string, ProviderTransportError>;
  }
>()("oc-usage-limits/ProviderFileSystem") {}

const readText = (
  input: ProviderFileInput
): Effect.Effect<string, ProviderTransportError> =>
  Effect.tryPromise({
    catch: () =>
      new ProviderTransportError({
        cause: "filesystem",
        operation: "read-auth",
        providerID: input.providerID,
      }),
    try: async () => {
      const file = await open(expandHome(input.path), "r");
      try {
        const stats = await file.stat();
        if (stats.size > MAX_AUTH_FILE_BYTES) {
          return null;
        }

        const buffer = Buffer.alloc(MAX_AUTH_FILE_BYTES + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0);
        return bytesRead > MAX_AUTH_FILE_BYTES
          ? null
          : buffer.subarray(0, bytesRead).toString("utf-8");
      } finally {
        await file.close();
      }
    },
  }).pipe(
    Effect.flatMap((text) =>
      text === null
        ? Effect.fail(
            new ProviderTransportError({
              cause: "output-limit",
              operation: "read-auth",
              providerID: input.providerID,
            })
          )
        : Effect.succeed(text)
    )
  );

/** Live bounded provider filesystem layer. */
export const ProviderFileSystemLive = Layer.succeed(ProviderFileSystem, {
  readJson: (input) =>
    readText(input).pipe(
      Effect.flatMap((text) =>
        Effect.try({
          catch: () =>
            new ProviderResponseDecodeError({
              cause: "syntax",
              operation: "read-auth",
              providerID: input.providerID,
            }),
          try: (): unknown => JSON.parse(text),
        })
      )
    ),
  readText,
});
