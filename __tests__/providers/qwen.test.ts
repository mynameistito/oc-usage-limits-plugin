import { describe, expect, test } from "bun:test";

import { createQwenProvider } from "@/providers/qwen.ts";
import type { QwenCommandRunner } from "@/providers/qwen.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

const commandError = (input: {
  code?: number | string;
  stdout?: string;
}): Error => Object.assign(new Error("command failed"), input);

const createRunner = (
  auth: string | Error,
  usage: string | Error = ""
): { calls: string[][]; runner: QwenCommandRunner } => {
  const calls: string[][] = [];
  const runner: QwenCommandRunner = (_cli, args) => {
    calls.push(args);
    const result = args[0] === "auth" ? auth : usage;
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    return Promise.resolve(result);
  };
  return { calls, runner };
};

const fetchUsage = (runner: QwenCommandRunner, label?: string) =>
  createQwenProvider({ commandRunner: runner, now: () => NOW }).fetch(
    label ? { label } : undefined,
    {},
    4321
  );

describe("Qwen provider", () => {
  test("returns authenticated usage with reset dates and calculated counts", async () => {
    const { calls, runner } = createRunner(
      JSON.stringify({ authenticated: true, server_verified: true }),
      JSON.stringify({
        token_plan: {
          planName: "Plus",
          remainingCredits: 250,
          resetDate: "2026-08-14T13:00:01.000Z",
          subscribed: true,
          totalCredits: 1000,
          usedPct: 75,
        },
      })
    );

    const usage = await fetchUsage(runner);

    expect(calls).toEqual([
      ["auth", "status", "--format", "json"],
      ["usage", "summary", "--format", "json"],
    ]);
    expect(usage).toMatchObject({
      capturedAt: NOW,
      id: "qwen",
      label: "Plus",
      windows: [
        {
          current: 750,
          label: "credits",
          remainingPercent: 25,
          resetAfterSeconds: 3601,
          total: 1000,
          usedPercent: 75,
        },
      ],
    });
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(
      "2026-08-14T13:00:01.000Z"
    );
  });

  test("reports an unavailable CLI without exposing subprocess diagnostics", async () => {
    const { runner } = createRunner(commandError({ code: "ENOENT" }));

    await expect(fetchUsage(runner)).rejects.toThrow(
      "qwencloud CLI not available (qwencloud CLI failed)"
    );
  });

  test("accepts unauthenticated JSON from a non-zero auth command", async () => {
    const { runner } = createRunner(
      commandError({
        code: 2,
        stdout: JSON.stringify({ authenticated: false }),
      })
    );

    await expect(fetchUsage(runner)).rejects.toThrow(
      "Not authenticated. Run: qwencloud auth login"
    );
  });

  test.each([
    ["malformed auth JSON", "{", "", "Failed to parse qwencloud auth status"],
    [
      "malformed usage JSON",
      JSON.stringify({ authenticated: true }),
      "{",
      "JSON Parse error",
    ],
    [
      "partial usage JSON",
      JSON.stringify({ authenticated: true }),
      JSON.stringify({ token_plan: { subscribed: true } }),
      "invalid Qwen usage",
    ],
  ])("rejects %s", async (_name, auth, usage, message) => {
    const { runner } = createRunner(auth, usage);

    await expect(fetchUsage(runner)).rejects.toThrow(message);
  });

  test("reports accounts without a subscription", async () => {
    const { runner } = createRunner(
      JSON.stringify({ authenticated: true }),
      JSON.stringify({ token_plan: { subscribed: false } })
    );

    await expect(fetchUsage(runner)).rejects.toThrow(
      "No subscription detected. Verify at home.qwencloud.com/billing"
    );
  });

  test("classifies a non-zero usage exit as a usage query failure", async () => {
    const { runner } = createRunner(
      JSON.stringify({ authenticated: true }),
      commandError({ code: 1, stdout: "internal details" })
    );

    await expect(fetchUsage(runner)).rejects.toThrow(
      "qwencloud usage query failed (qwencloud CLI exit code 1)"
    );
  });

  test("classifies an auth timeout as CLI unavailability", async () => {
    const { runner } = createRunner(commandError({ code: "ETIMEDOUT" }));

    await expect(fetchUsage(runner)).rejects.toThrow(
      "qwencloud CLI not available (qwencloud CLI failed)"
    );
  });

  test("uses a configured provider label", async () => {
    const { runner } = createRunner(
      JSON.stringify({ authenticated: true }),
      JSON.stringify({
        token_plan: { planName: "Plus", subscribed: true, usedPct: 10 },
      })
    );

    const usage = await fetchUsage(runner, "Work Qwen");
    expect(usage.label).toBe("Work Qwen");
  });
});
