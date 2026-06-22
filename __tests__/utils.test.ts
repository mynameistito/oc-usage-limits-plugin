import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clampPercent,
  fetchJson,
  isRecord,
  readJsonFile,
  resolveEnvReference,
} from "@/utils.ts";

const originalFetch = globalThis.fetch;
type FetchMock = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const installFetchMock = (response: Response) => {
  const fetchMock = mock<FetchMock>(() => Promise.resolve(response));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.OC_USAGE_LIMITS_TEST_KEY;
  mock.restore();
});

describe("utility helpers", () => {
  test("clamps finite percentages and treats non-finite values as zero", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("detects plain records", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ nested: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("object")).toBe(false);
  });

  test("reads JSONC with line comments, block comments, quoted slashes, and trailing commas", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "oc-usage-limits-"));
    const filePath = path.join(directory, "config.jsonc");

    try {
      await writeFile(
        filePath,
        String.raw`{
          // provider config
          "url": "https://example.com//kept",
          "quoted": "value // kept",
          "nested": {
            "enabled": true,
          },
          /* block comment */
          "items": [1, 2,],
        }`,
        "utf-8"
      );

      await expect(readJsonFile(filePath)).resolves.toEqual({
        items: [1, 2],
        nested: { enabled: true },
        quoted: "value // kept",
        url: "https://example.com//kept",
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resolves environment variable references only when the full value matches", () => {
    process.env.OC_USAGE_LIMITS_TEST_KEY = "secret";

    expect(resolveEnvReference("{env:OC_USAGE_LIMITS_TEST_KEY}")).toBe(
      "secret"
    );
    expect(resolveEnvReference("  {env:OC_USAGE_LIMITS_TEST_KEY}  ")).toBe(
      "secret"
    );
    expect(resolveEnvReference("prefix-{env:OC_USAGE_LIMITS_TEST_KEY}")).toBe(
      "prefix-{env:OC_USAGE_LIMITS_TEST_KEY}"
    );
    const missingValue = process.env.OC_USAGE_LIMITS_MISSING_KEY;
    expect(resolveEnvReference(missingValue)).toBeUndefined();
  });

  test("fetches and parses JSON with a timeout signal", async () => {
    const fetchMock = installFetchMock(
      new Response('{"ok":true}', { status: 200 })
    );

    await expect(
      fetchJson("https://example.com", { method: "GET" }, 50)
    ).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate limited"],
    [500, "HTTP 500"],
  ] as const)(
    "maps HTTP %i responses to useful errors",
    async (status, message) => {
      installFetchMock(new Response("{}", { status }));

      await expect(
        fetchJson("https://example.com", { method: "GET" }, 50)
      ).rejects.toThrow(message);
    }
  );

  test("rejects successful responses with invalid JSON", async () => {
    installFetchMock(new Response("not json", { status: 200 }));

    await expect(
      fetchJson("https://example.com", { method: "GET" }, 50)
    ).rejects.toThrow("invalid JSON");
  });
});
