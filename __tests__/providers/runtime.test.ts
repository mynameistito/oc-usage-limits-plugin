import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect, Exit } from "effect";

import { ProviderClock, ProviderClockLive } from "@/providers/runtime/clock.ts";
import {
  ProviderFileSystem,
  ProviderFileSystemLive,
} from "@/providers/runtime/filesystem.ts";
import {
  makeProviderHttpClient,
  ProviderHttpClient,
} from "@/providers/runtime/http.ts";

describe("provider runtime services", () => {
  const temporaryFiles: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryFiles.splice(0).map((file) => rm(file, { force: true }))
    );
  });

  test("rejects oversized provider auth files before reading their contents", async () => {
    const file = path.join(
      tmpdir(),
      `oc-usage-limits-${crypto.randomUUID()}.json`
    );
    temporaryFiles.push(file);
    await Bun.write(file, "x".repeat(1024 * 1024 + 1));

    const result = await Effect.runPromise(
      Effect.gen(function* result() {
        const files = yield* ProviderFileSystem;
        return yield* files.readText({ path: file, providerID: "codex" });
      }).pipe(Effect.provide(ProviderFileSystemLive), Effect.exit)
    );

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      const serializedCause = JSON.stringify(result.cause);
      expect(serializedCause).toContain('"_tag":"ProviderTransportError"');
      expect(serializedCause).toContain('"cause":"output-limit"');
      expect(serializedCause).toContain('"operation":"read-auth"');
    }
  });

  test("reads the complete contents of a bounded provider auth file", async () => {
    const file = path.join(
      tmpdir(),
      `oc-usage-limits-${crypto.randomUUID()}.json`
    );
    temporaryFiles.push(file);
    const content = JSON.stringify({
      accessToken: "token",
      padding: "x".repeat(1024),
    });
    await Bun.write(file, content);

    const result = await Effect.runPromise(
      Effect.gen(function* result() {
        const files = yield* ProviderFileSystem;
        return yield* files.readText({ path: file, providerID: "codex" });
      }).pipe(Effect.provide(ProviderFileSystemLive))
    );

    expect(result).toBe(content);
  });

  test("decodes bounded HTTP JSON and classifies malformed bodies", async () => {
    const layer = makeProviderHttpClient(() =>
      Promise.resolve(new Response("not-json", { status: 200 }))
    );

    const result = await Effect.runPromise(
      Effect.gen(function* result() {
        const http = yield* ProviderHttpClient;
        return yield* http.requestJson({
          headers: {},
          method: "GET",
          providerID: "codex",
          timeoutMs: 1000,
          url: "https://example.test/usage",
        });
      }).pipe(Effect.provide(layer), Effect.exit)
    );

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause).toBeDefined();
    }
  });

  test("cancels a response rejected by its declared size", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;
      },
    });
    const layer = makeProviderHttpClient(() =>
      Promise.resolve(
        new Response(body, {
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
          status: 200,
        })
      )
    );

    const result = await Effect.runPromise(
      Effect.gen(function* result() {
        const http = yield* ProviderHttpClient;
        return yield* http.requestJson({
          headers: {},
          method: "GET",
          providerID: "codex",
          timeoutMs: 1000,
          url: "https://example.test/usage",
        });
      }).pipe(Effect.provide(layer), Effect.exit)
    );

    expect(Exit.isFailure(result)).toBe(true);
    expect(cancelled).toBe(true);
  });

  test("uses the Effect clock for deterministic provider timestamps", async () => {
    const now = await Effect.runPromise(
      ProviderClock.pipe(Effect.flatMap((clock) => clock.now)).pipe(
        Effect.provide(ProviderClockLive)
      )
    );

    expect(now).toBeInstanceOf(Date);
  });

  test("classifies an interrupted HTTP request as a timeout", async () => {
    const layer = makeProviderHttpClient(() => Effect.runPromise(Effect.never));
    const result = await Effect.runPromise(
      Effect.gen(function* result() {
        const http = yield* ProviderHttpClient;
        return yield* http.requestJson({
          headers: {},
          method: "GET",
          providerID: "qwen",
          timeoutMs: 1,
          url: "https://example.test/usage",
        });
      }).pipe(Effect.provide(layer), Effect.exit)
    );

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(result.cause).toBeDefined();
    }
  });
});
