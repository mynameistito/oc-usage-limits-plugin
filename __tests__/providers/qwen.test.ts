import { describe, expect, test } from "bun:test";

import { createQwenProvider } from "@/providers/qwen.ts";
import type { QwenCommandRunner } from "@/providers/qwen.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

const commandError = (input: {
  code?: number | string;
  stderr?: string;
  stdout?: string;
}): Error => Object.assign(new Error("command failed"), input);

const safeErrorGraph = (error: Error | null): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause instanceof Error ? safeErrorGraph(error.cause) : "";
  return `${error.name}:${error.message}:${cause}`;
};

const asError = <T>(value: T): Error =>
  value instanceof Error ? value : new Error(String(value));

interface RunnerHarness {
  calls: string[][];
  runner: QwenCommandRunner;
}

const createRunner = (
  auth: string | Error,
  usage: string | Error = ""
): RunnerHarness => {
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
          label: "credits",
          quota: {
            current: 750,
            remainingPercent: 25,
            total: 1000,
            usedPercent: 75,
          },
        },
      ],
    });
    expect(usage.windows[0]?.resetsAt?.toISOString()).toBe(
      "2026-08-14T13:00:01.000Z"
    );
  });

  test("reports an unavailable CLI without exposing subprocess diagnostics", async () => {
    const secret = "stderr-secret-like-value";
    const { runner } = createRunner(
      commandError({ code: "ENOENT", stderr: secret, stdout: secret })
    );

    try {
      await fetchUsage(runner);
      throw new Error("expected Qwen CLI failure");
    } catch (error) {
      expect(safeErrorGraph(asError(error))).toContain(
        "qwencloud CLI not available (qwencloud CLI failed)"
      );
      expect(safeErrorGraph(asError(error))).not.toContain(secret);
    }
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
      "Failed to parse qwencloud usage response",
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

  test("redacts malformed usage output from parse failures", async () => {
    const fragment = "malformed-output-secret-fragment";
    const { runner } = createRunner(
      JSON.stringify({ authenticated: true }),
      `{"token_plan":"${fragment}`
    );

    try {
      await fetchUsage(runner);
      throw new Error("expected malformed Qwen usage failure");
    } catch (error) {
      expect(safeErrorGraph(asError(error))).toContain(
        "Failed to parse qwencloud usage response"
      );
      expect(safeErrorGraph(asError(error))).not.toContain(fragment);
    }
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
    const secret = "stdout-secret-like-value";
    const { runner } = createRunner(
      JSON.stringify({ authenticated: true }),
      commandError({ code: 1, stderr: secret, stdout: secret })
    );

    try {
      await fetchUsage(runner);
      throw new Error("expected Qwen usage command failure");
    } catch (error) {
      expect(safeErrorGraph(asError(error))).toContain(
        "qwencloud usage query failed (qwencloud CLI exit code 1)"
      );
      expect(safeErrorGraph(asError(error))).toContain(
        "qwencloud CLI exit code 1"
      );
      expect(safeErrorGraph(asError(error))).not.toContain(secret);
    }
  });

  test.each([-1, Number.POSITIVE_INFINITY])(
    "rejects invalid required usage percentage %s",
    async (usedPct) => {
      const { runner } = createRunner(
        JSON.stringify({ authenticated: true }),
        JSON.stringify({ token_plan: { subscribed: true, usedPct } })
      );

      await expect(fetchUsage(runner)).rejects.toThrow("invalid Qwen usage");
    }
  );

  test("downgrades invalid optional counts to percentage usage", async () => {
    const { runner } = createRunner(
      JSON.stringify({ authenticated: true }),
      JSON.stringify({
        token_plan: {
          remainingCredits: -1,
          subscribed: true,
          totalCredits: Number.POSITIVE_INFINITY,
          usedPct: 25,
        },
      })
    );

    const usage = await fetchUsage(runner);
    expect(usage.windows[0]?.quota._tag).toBe("Percentage");
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
