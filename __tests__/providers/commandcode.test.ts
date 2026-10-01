import { afterEach, describe, expect, test } from "bun:test";

import { fetchCommandCodeUsage } from "@/providers/commandcode.ts";

const originalFetch = globalThis.fetch;

const WHOAMI_URL = "https://api.commandcode.ai/alpha/whoami?limits=1";
const CREDITS_URL = "https://api.commandcode.ai/alpha/billing/credits";
const SUMMARY_URL = "https://api.commandcode.ai/alpha/usage/summary";

// SAFETY: The mock implements the subset of fetch used by these tests.
const asFetch = <T>(value: T): typeof fetch => value as typeof fetch;

const installResponses = (
  responses: readonly Response[]
): readonly string[] => {
  const seen: string[] = [];
  let index = 0;
  globalThis.fetch = asFetch((input: string | URL | Request) => {
    seen.push(String(input));
    const response = responses[index] ?? new Response(null, { status: 502 });
    index += 1;
    return Promise.resolve(response);
  });
  return seen;
};

/** A personal-account `/alpha/whoami` response, when `orgId` is omitted. */
const whoamiBody = (orgId?: string): Response =>
  Response.json(
    orgId === undefined
      ? { success: true, user: { id: "user_fixture", name: "fixture-user" } }
      : {
          org: { id: orgId, login: "fixture-org" },
          success: true,
          user: { id: "user_fixture" },
        }
  );

/** A `/alpha/whoami` response that nests the organization under `data`. */
const nestedWhoamiBody = (orgId: string): Response =>
  Response.json({ data: { organization: { id: orgId } }, success: true });

const creditsBody = (fiveHourUsed: number, weeklyUsed: number): Response =>
  Response.json({
    credits: {
      creditThreshold: 0,
      freeCredits: 0,
      monthlyCredits: 70,
      purchasedCredits: 5,
    },
    windowLimits: {
      exceeded: null,
      fiveHour: {
        cap: 14,
        exceeded: false,
        resetAt: 1_789_810_659_226,
        used: fiveHourUsed,
      },
      limited: true,
      weekly: {
        cap: 35,
        exceeded: false,
        resetAt: 1_790_397_459_226,
        used: weeklyUsed,
      },
    },
  });

const overCapBody = (): Response =>
  Response.json({
    credits: {
      creditThreshold: 0,
      freeCredits: 0,
      monthlyCredits: 70,
      purchasedCredits: 5,
    },
    windowLimits: {
      exceeded: null,
      fiveHour: {
        cap: 14,
        exceeded: true,
        resetAt: 1_789_810_659_226,
        used: 20,
      },
      limited: true,
      weekly: {
        cap: 35,
        exceeded: false,
        resetAt: 1_790_397_459_226,
        used: 7,
      },
    },
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Command Code provider", () => {
  test("parses 5h, weekly, and derived monthly windows", async () => {
    const seen = installResponses([
      whoamiBody(),
      creditsBody(7, 7),
      Response.json({ totalCost: 5, totalCredits: 5 }),
    ]);

    const usage = await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    );

    expect(seen).toEqual([WHOAMI_URL, CREDITS_URL, SUMMARY_URL]);
    expect(usage).toMatchObject({
      id: "commandcode",
      label: "Command Code",
    });
    expect(usage.windows).toMatchObject([
      { kind: "rolling", label: "5h", quota: { usedPercent: 50 } },
      { kind: "weekly", label: "weekly", quota: { usedPercent: 20 } },
      { kind: "monthly", label: "monthly", quota: { usedPercent: 6.25 } },
    ]);
    expect(usage.windows[0]?.resetsAt?.getTime()).toBe(1_789_810_659_226);
    expect(usage.windows[2]?.resetsAt).toBeNull();
  });

  test("scopes billing and usage requests to the whoami organization", async () => {
    const seen = installResponses([
      whoamiBody("org_fixture"),
      creditsBody(7, 7),
      Response.json({ totalCredits: 5 }),
    ]);

    await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    );

    expect(seen).toEqual([
      WHOAMI_URL,
      `${CREDITS_URL}?orgId=org_fixture`,
      `${SUMMARY_URL}?orgId=org_fixture`,
    ]);
  });

  test("scopes requests to an organization nested under data", async () => {
    const seen = installResponses([
      nestedWhoamiBody("org_nested"),
      creditsBody(7, 7),
      Response.json({ totalCredits: 5 }),
    ]);

    await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    );

    expect(seen[1]).toBe(`${CREDITS_URL}?orgId=org_nested`);
    expect(seen[2]).toBe(`${SUMMARY_URL}?orgId=org_nested`);
  });

  test("omits the org scope for a personal account", async () => {
    const seen = installResponses([
      whoamiBody(),
      creditsBody(7, 7),
      Response.json({ totalCredits: 5 }),
    ]);

    await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    );

    expect(seen).toEqual([WHOAMI_URL, CREDITS_URL, SUMMARY_URL]);
  });

  test("clamps an exhausted bucket to 100% instead of dropping it", async () => {
    installResponses([
      whoamiBody(),
      overCapBody(),
      Response.json({ totalCredits: 5 }),
    ]);

    const usage = await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    );

    expect(usage.windows[0]).toMatchObject({
      kind: "rolling",
      quota: { usedPercent: 100 },
    });
  });

  test("keeps an unknown monthly quota when the summary request fails", async () => {
    installResponses([
      whoamiBody(),
      creditsBody(1, 1),
      new Response(null, { status: 500 }),
    ]);

    const usage = await fetchCommandCodeUsage(
      undefined,
      { commandcode: { key: "cc-token" } },
      1000
    );

    expect(usage.windows).toMatchObject([
      { kind: "rolling" },
      { kind: "weekly" },
      { kind: "monthly", quota: { _tag: "Unknown" } },
    ]);
  });

  test("supports a literal API key without OpenCode auth", async () => {
    const seen = installResponses([whoamiBody(), creditsBody(1, 1)]);

    await fetchCommandCodeUsage({ apiKey: "literal-token" }, {}, 1000);

    expect(seen[0]).toBe(WHOAMI_URL);
    expect(seen[1]).toBe(CREDITS_URL);
  });

  test("fails the refresh when whoami fails instead of reading unscoped", async () => {
    const seen = installResponses([new Response(null, { status: 500 })]);

    await expect(
      fetchCommandCodeUsage(
        undefined,
        { commandcode: { key: "cc-token" } },
        1000
      )
    ).rejects.toThrow();
    expect(seen).toEqual([WHOAMI_URL]);
  });

  test("rejects missing credentials and malformed responses", async () => {
    await expect(fetchCommandCodeUsage(undefined, {}, 1000)).rejects.toThrow(
      "missing Command Code key"
    );

    installResponses([whoamiBody(), Response.json({ credits: {} })]);
    await expect(
      fetchCommandCodeUsage(undefined, { commandcode: { key: "key" } }, 1000)
    ).rejects.toThrow("invalid Command Code usage");
  });

  test("withholds OpenCode auth from a custom port on the official host", async () => {
    const seen = installResponses([whoamiBody(), creditsBody(1, 1)]);

    await expect(
      fetchCommandCodeUsage(
        { baseUrl: "https://api.commandcode.ai:8443" },
        { commandcode: { key: "cc-token" } },
        1000
      )
    ).rejects.toThrow("missing Command Code key");
    expect(seen).toEqual([]);
  });
});
