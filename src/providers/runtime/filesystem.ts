import { readFile } from "node:fs/promises";
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
    try: () => readFile(expandHome(input.path), "utf-8"),
  }).pipe(
    Effect.flatMap((text) =>
      Buffer.byteLength(text, "utf-8") <= MAX_AUTH_FILE_BYTES
        ? Effect.succeed(text)
        : Effect.fail(
            new ProviderTransportError({
              cause: "output-limit",
              operation: "read-auth",
              providerID: input.providerID,
            })
          )
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
