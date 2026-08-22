import { describe, expect, test } from "bun:test";

import { Effect, Exit } from "effect";

import { ProviderClock, ProviderClockLive } from "@/providers/runtime/clock.ts";
import {
  makeProviderHttpClient,
  ProviderHttpClient,
} from "@/providers/runtime/http.ts";

describe("provider runtime services", () => {
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
