/* @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";

import type { Context } from "@opencode-ai/plugin/tui/context";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { Deferred, Effect, Result } from "effect";

import type { UsageTheme } from "@/components.tsx";
import { ConfigDecodeError } from "@/errors.ts";
import type { ProviderError } from "@/errors.ts";
import { createUsageLimitsPlugin } from "@/plugin.tsx";
import type { UsageLimitsTuiDependencies } from "@/plugin.tsx";
import type {
  OpenCodeAuth,
  ProviderConfig,
  ProviderID,
  ProviderUsage,
  ResolvedUsageLimitsConfig,
} from "@/types.ts";
import { parseUsagePercentage, percentageQuota } from "@/usage.ts";

const NOW = new Date("2026-08-14T12:34:00.000Z");
const color = RGBA.fromValues(1, 2, 3, 255);
// SAFETY: The proxy supplies the RGBA value for every theme color while
// retaining the one numeric theme property used by OpenTUI.
const themeValue = new Proxy(
  { thinkingOpacity: 0.6 },
  {
    get: (target, key) =>
      key === "thinkingOpacity" ? target.thinkingOpacity : color,
  }
);
// SAFETY: The host test only reads the proxy's numeric opacity and color values.
const asUsageTheme = <T,>(value: T): UsageTheme => value as UsageTheme;
const theme = asUsageTheme(themeValue);

interface UsageLimitsSlotContext {
  sessionID?: string;
  mode?: "normal" | "shell";
}

type CharacterizedSlots = Record<
  "sidebar.content" | "prompt.footer.status",
  (context: UsageLimitsSlotContext) => JSX.Element | null
>;

interface HarnessState {
  config: ResolvedUsageLimitsConfig;
  configError: ConfigDecodeError | null;
  fetchError: Error | null;
}

const DEFAULT_SLOT: UsageLimitsSlotContext = {
  mode: "normal",
  sessionID: "session-1",
};

interface ScheduledRefresh {
  callback: () => Promise<void>;
  cancelled: boolean;
  delayMs: number;
}

const config = (
  overrides: Partial<ResolvedUsageLimitsConfig> = {}
): ResolvedUsageLimitsConfig => ({
  enabled: true,
  providers: { codex: { enabled: true, label: "Codex Work" } },
  refreshIntervalSeconds: 20,
  requestTimeoutMs: 5000,
  showErrors: true,
  ...overrides,
});

const usage = <ID extends ProviderID>(id: ID): ProviderUsage<ID> => ({
  capturedAt: NOW,
  id,
  label: "Codex Work",
  windows: [
    {
      kind: "rolling",
      label: "5h",
      quota: percentageQuota(Result.getOrThrow(parseUsagePercentage(42))),
      resetsAt: new Date("2026-08-14T13:34:00.000Z"),
    },
  ],
});

const createHarness = (initialConfig = config()) => {
  const scheduled: ScheduledRefresh[] = [];
  const fetches: ProviderID[] = [];
  const auth: OpenCodeAuth = {};
  const state: HarnessState = {
    config: initialConfig,
    configError: null,
    fetchError: null,
  };
  let dispose: (() => void) | undefined;
  let slotDisposals = 0;
  let registered: Partial<CharacterizedSlots> | undefined;

  const dependencies: UsageLimitsTuiDependencies = {
    fetchProvider: <ID extends ProviderID>(
      id: ID,
      _providerConfig: ProviderConfig | undefined,
      _openCodeAuth: OpenCodeAuth,
      _timeoutMs: number
    ) => {
      fetches.push(id);
      if (state.fetchError) {
        // SAFETY: The harness only assigns ordinary Error values here; the
        // provider seam classifies them as ProviderError for this fixture.
        return Effect.fail(state.fetchError as ProviderError);
      }
      return Effect.succeed(usage(id));
    },
    loadConfig: () =>
      Promise.resolve(
        state.configError
          ? Result.fail(state.configError)
          : Result.succeed(state.config)
      ),
    loadOpenCodeAuth: () => Promise.resolve(auth),
    now: () => NOW,
    sleep: (delayMs) =>
      Effect.gen(function* sleep() {
        const deferred = yield* Deferred.make<boolean>();
        const scheduledRefresh: ScheduledRefresh = {
          callback: async () => {
            await Effect.runPromise(Deferred.succeed(deferred, true));
          },
          cancelled: false,
          delayMs,
        };
        scheduled.push(scheduledRefresh);
        yield* Effect.ensuring(
          Deferred.await(deferred).pipe(Effect.asVoid),
          Effect.sync(() => {
            scheduledRefresh.cancelled = true;
          })
        );
      }),
  };

  const partialApi = {
    data: { session: { message: { list: () => [{ providerID: "openai" }] } } },
    theme,
    ui: {
      slot: (claim: {
        append: "sidebar.content" | "prompt.footer.status";
        render: CharacterizedSlots[typeof claim.append];
      }) => {
        registered = { ...registered, [claim.append]: claim.render };
        return () => {
          slotDisposals += 1;
        };
      },
    },
  };

  // SAFETY: The adapter implements the focused v2 host seam used by this test.
  return {
    context: partialApi,
    dependencies,
    fetches,
    getDispose: () => dispose,
    getRegistered: () => registered,
    getSlotDisposals: () => slotDisposals,
    scheduled,
    setDispose: (cleanup: () => void) => {
      dispose = cleanup;
    },
    state,
  };
};

const renderSlot = async (
  registered: CharacterizedSlots,
  name: "prompt.footer.status" | "sidebar.content",
  slot: UsageLimitsSlotContext = DEFAULT_SLOT
): Promise<string> => {
  const setup = await testRender(() => registered[name](slot), {
    height: 12,
    width: 80,
  });
  try {
    await setup.flush();
    return setup.captureCharFrame();
  } finally {
    setup.renderer.destroy();
  }
};

// SAFETY: The focused fixture implements the host context seam used here.
const asHostContext = <T,>(value: T): Context => value as Context;

const initialize = async (harness: ReturnType<typeof createHarness>) => {
  harness.setDispose(
    // SAFETY: partialApi implements the focused Context seam exercised here.
    createUsageLimitsPlugin(harness.dependencies)(
      asHostContext(harness.context)
    )
  );
  await Bun.sleep(0);
  const registered = harness.getRegistered();
  if (!registered) {
    throw new Error("plugin did not register slots");
  }
  if (!registered["sidebar.content"] || !registered["prompt.footer.status"]) {
    throw new Error("plugin did not register both slots");
  }
  // SAFETY: initialize verifies both required slots before this cast.
  return registered as CharacterizedSlots;
};

describe("usage-limits TUI lifecycle", () => {
  test("registers both slots with initial successful state", async () => {
    const harness = createHarness();
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual(["codex"]);
    expect(harness.scheduled[0]?.delayMs).toBe(20_000);
    expect(await renderSlot(registered, "sidebar.content")).toContain(
      "Codex Work"
    );
    expect(await renderSlot(registered, "sidebar.content")).toContain(
      "Updated 12:34"
    );
    expect(await renderSlot(registered, "prompt.footer.status")).toContain(
      "42%"
    );
  });

  test("retains the previous successful state when a provider fails", async () => {
    const harness = createHarness();
    const registered = await initialize(harness);
    harness.state.fetchError = new Error("provider unavailable");

    await harness.scheduled[0]?.callback();
    await Bun.sleep(0);

    const sidebar = await renderSlot(registered, "sidebar.content");
    expect(sidebar).toContain("Codex Work cached");
    expect(sidebar).toContain("provider unavailable");
    expect(await renderSlot(registered, "prompt.footer.status")).toContain(
      "42%"
    );
  });

  test("keeps both slots empty when the plugin is disabled", async () => {
    const harness = createHarness(config({ enabled: false }));
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual([]);
    expect(await renderSlot(registered, "sidebar.content")).not.toContain(
      "Usage Limits"
    );
    expect(await renderSlot(registered, "prompt.footer.status")).not.toContain(
      "%"
    );
  });

  test("hides only both graphical bars without stopping provider refreshes", async () => {
    const harness = createHarness(
      config({
        providers: {
          codex: {
            enabled: true,
            showFooterBar: false,
            showSidebarBar: false,
          },
        },
      })
    );
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual(["codex"]);
    expect(await renderSlot(registered, "sidebar.content")).toContain("Codex");
    expect(await renderSlot(registered, "sidebar.content")).toContain(
      "42% used"
    );
    expect(await renderSlot(registered, "sidebar.content")).not.toContain(
      "[█████░░░░░░░]"
    );
    expect(await renderSlot(registered, "prompt.footer.status")).toContain(
      "42%"
    );
    expect(await renderSlot(registered, "prompt.footer.status")).not.toContain(
      "[████░░░░░░░░]"
    );
  });

  test.each([
    [
      { providers: { codex: { enabled: true, showSidebarBar: false } } },
      "sidebar.content",
      "42% used",
    ],
    [
      { providers: { codex: { enabled: true, showFooterBar: false } } },
      "prompt.footer.status",
      "42%",
    ],
  ])("hides only the configured %s bar", async (overrides, slot, text) => {
    const harness = createHarness(config(overrides));
    const registered = await initialize(harness);

    // SAFETY: The table contains only the two registered slot names.
    const rendered = await renderSlot(
      registered,
      slot as keyof CharacterizedSlots
    );
    expect(rendered).toContain(text);
    expect(rendered).not.toContain(
      slot === "sidebar.content" ? "[█████░░░░░░░]" : "[████░░░░░░░░]"
    );
  });

  test("does not render footer usage for shell mode or missing sessions", async () => {
    const harness = createHarness();
    const registered = await initialize(harness);

    expect(
      await renderSlot(registered, "prompt.footer.status", {
        mode: "shell",
        sessionID: "session-1",
      })
    ).not.toContain("42%");
    expect(
      await renderSlot(registered, "prompt.footer.status", {
        mode: "normal",
      })
    ).not.toContain("42%");
  });

  test("uses safe defaults when typed config parsing fails", async () => {
    const harness = createHarness();
    harness.state.configError = new ConfigDecodeError({
      cause: "schema",
      operation: "parse-config",
    });
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual([]);
    expect(harness.scheduled[0]?.delayMs).toBe(60_000);
    expect(await renderSlot(registered, "sidebar.content")).not.toContain(
      "Usage Limits"
    );
  });

  test("uses a changed interval for the next scheduled refresh", async () => {
    const harness = createHarness();
    await initialize(harness);
    harness.state.config = config({ refreshIntervalSeconds: 45 });

    await harness.scheduled[0]?.callback();
    await Bun.sleep(0);

    expect(harness.scheduled.map(({ delayMs }) => delayMs)).toEqual([
      20_000, 45_000,
    ]);
  });

  test("disposal cancels the pending refresh", async () => {
    const harness = createHarness();
    await initialize(harness);
    const dispose = harness.getDispose();
    if (!dispose) {
      throw new Error("plugin did not register disposal");
    }

    dispose();
    await Bun.sleep(0);

    expect(harness.scheduled[0]?.cancelled).toBe(true);
    expect(harness.getSlotDisposals()).toBe(2);
    expect(harness.fetches).toEqual(["codex"]);
  });
});
