import { describe, expect, test } from "bun:test";

import {
  ProviderCommandError,
  ProviderRateLimitError,
  ProviderResponseDecodeError,
  ProviderTimeoutError,
  ProviderTransportError,
} from "@/errors.ts";
import type { ProviderError } from "@/errors.ts";

const errorTag = (error: ProviderError): string => error._tag;

describe("provider boundary errors", () => {
  test("carry stable provider and operation context", () => {
    const errors: readonly ProviderError[] = [
      new ProviderTransportError({
        operation: "fetch-usage",
        providerID: "codex",
      }),
      new ProviderTimeoutError({
        operation: "fetch-usage",
        providerID: "zai",
        timeoutMs: 1000,
      }),
      new ProviderRateLimitError({
        operation: "fetch-usage",
        providerID: "synthetic",
        retryAfterMs: 5000,
      }),
      new ProviderResponseDecodeError({
        operation: "decode-response",
        providerID: "minimax",
      }),
      new ProviderCommandError({
        exitCode: 1,
        operation: "run-command",
        providerID: "qwen",
      }),
    ];

    expect(errors.map(errorTag)).toEqual([
      "ProviderTransportError",
      "ProviderTimeoutError",
      "ProviderRateLimitError",
      "ProviderResponseDecodeError",
      "ProviderCommandError",
    ]);
    expect(errors.map(({ providerID }) => providerID)).toEqual([
      "codex",
      "zai",
      "synthetic",
      "minimax",
      "qwen",
    ]);
  });

  test("stores only classified safe causes", () => {
    const error = new ProviderTransportError({
      cause: "network",
      operation: "fetch-usage",
      providerID: "codex",
    });

    expect(error.cause).toBe("network");
    expect(String(error)).not.toContain("responseBody");
  });
});
