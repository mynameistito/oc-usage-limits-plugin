/* @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";

import type {
  TuiDispose,
  TuiPluginApi,
  TuiSlotContext,
} from "@opencode-ai/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { JSX } from "@opentui/solid";
import { Deferred, Effect, Result } from "effect";

import { ConfigDecodeError } from "@/errors.ts";
import type { ProviderError } from "@/errors.ts";
import { createUsageLimitsTui } from "@/plugin.tsx";
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
const context = {
  theme: {
    current: new Proxy(
      { thinkingOpacity: 0.6 },
      { get: (target, key) => target[key as keyof typeof target] ?? color }
    ),
  },
} as TuiSlotContext;

interface CharacterizedSlots {
  order?: number;
  slots: {
    session_prompt_right: (
      context: TuiSlotContext,
      props: { session_id: string }
    ) => JSX.Element;
    sidebar_content: (
      context: TuiSlotContext,
      props: { session_id: string }
    ) => JSX.Element;
  };
}

// SAFETY: The test adapter implements every TuiPluginApi member consumed here.
const asTuiPluginApi = <T,>(value: T): TuiPluginApi => value as TuiPluginApi;

interface ScheduledRefresh {
  callback: () => Promise<void>;
  cancelled: boolean;
  delayMs: number;
}

const config = (
  overrides: Partial<ResolvedUsageLimitsConfig> = {}
): ResolvedUsageLimitsConfig => ({
  enabled: true,
  providers: {
    codex: {
      enabled: true,
      footerWindow: "auto",
      label: "Codex Work",
      showFooterBar: true,
      showSidebarBar: true,
      sidebarWindow: "all",
    },
  },
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
  interface HarnessState {
    config: ResolvedUsageLimitsConfig;
    configError: ConfigDecodeError | null;
    fetchError: Error | null;
  }
  const state: HarnessState = {
    config: initialConfig,
    configError: null,
    fetchError: null,
  };
  let dispose: TuiDispose | null = null;
  let registered: CharacterizedSlots | undefined;

  const dependencies: UsageLimitsTuiDependencies = {
    fetchProvider: <ID extends ProviderID>(
      id: ID,
      _providerConfig: ProviderConfig | undefined,
      _openCodeAuth: OpenCodeAuth,
      _timeoutMs: number
    ) => {
      fetches.push(id);
      if (state.fetchError) {
        // SAFETY: The harness stores the provider error shape in fetchError.
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
    lifecycle: {
      onDispose: (...args: [TuiDispose]) => {
        const [callback] = args;
        dispose = callback;
        return () => {
          dispose = null;
        };
      },
      signal: new AbortController().signal,
    },
    slots: {
      register: (plugin: CharacterizedSlots) => {
        registered = plugin;
        return "usage-limits-test";
      },
    },
    state: {
      session: { messages: () => [{ providerID: "openai" }] },
    },
  };

  // SAFETY: The plugin only reads lifecycle, slots, and session.messages from
  // this focused test adapter; each used member has the production API shape.
  const api = asTuiPluginApi(partialApi);

  return {
    api,
    dependencies,
    fetches,
    getDispose: () => dispose,
    getRegistered: () => registered,
    scheduled,
    state,
  };
};

const renderSlot = async (
  registered: CharacterizedSlots,
  name: "session_prompt_right" | "sidebar_content"
): Promise<string> => {
  const setup = await testRender(
    () => registered.slots[name](context, { session_id: "session-1" }),
    { height: 12, width: 80 }
  );
  try {
    await setup.flush();
    return setup.captureCharFrame();
  } finally {
    setup.renderer.destroy();
  }
};

const initialize = async (harness: ReturnType<typeof createHarness>) => {
  await createUsageLimitsTui(harness.dependencies)(
    harness.api,
    undefined,
    // SAFETY: Plugin metadata is not read by this plugin.
    {} as Parameters<ReturnType<typeof createUsageLimitsTui>>[2]
  );
  await Bun.sleep(0);
  const registered = harness.getRegistered();
  if (!registered) {
    throw new Error("plugin did not register slots");
  }
  return registered;
};

describe("usage-limits TUI lifecycle", () => {
  test("registers both slots with initial successful state", async () => {
    const harness = createHarness();
    const registered = await initialize(harness);

    expect(registered.order).toBe(101);
    expect(harness.fetches).toEqual(["codex"]);
    expect(harness.scheduled[0]?.delayMs).toBe(20_000);
    expect(await renderSlot(registered, "sidebar_content")).toContain(
      "Codex Work"
    );
    expect(await renderSlot(registered, "sidebar_content")).toContain(
      "Updated 12:34"
    );
    expect(await renderSlot(registered, "session_prompt_right")).toContain(
      "42%"
    );
  });

  test("retains the previous successful state when a provider fails", async () => {
    const harness = createHarness();
    const registered = await initialize(harness);
    harness.state.fetchError = new Error("provider unavailable");

    await harness.scheduled[0]?.callback();
    await Bun.sleep(0);

    const sidebar = await renderSlot(registered, "sidebar_content");
    expect(sidebar).toContain("Codex Work cached");
    expect(sidebar).toContain("provider unavailable");
    expect(await renderSlot(registered, "session_prompt_right")).toContain(
      "42%"
    );
  });

  test("keeps both slots empty when the plugin is disabled", async () => {
    const harness = createHarness(config({ enabled: false }));
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual([]);
    expect(await renderSlot(registered, "sidebar_content")).not.toContain(
      "Usage Limits"
    );
    expect(await renderSlot(registered, "session_prompt_right")).not.toContain(
      "%"
    );
  });

  test("hides a provider's displays without stopping its refreshes", async () => {
    const harness = createHarness(
      config({
        providers: {
          codex: {
            enabled: true,
            label: "Codex Work",
            showFooterBar: false,
            showSidebarBar: false,
          },
        },
      })
    );
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual(["codex"]);
    expect(await renderSlot(registered, "sidebar_content")).not.toContain(
      "Usage Limits"
    );
    expect(await renderSlot(registered, "session_prompt_right")).not.toContain(
      "%"
    );
  });

  test("filters sidebar windows per provider", async () => {
    const harness = createHarness(
      config({
        providers: {
          codex: {
            enabled: true,
            label: "Codex Work",
            sidebarWindow: "daily",
          },
        },
      })
    );
    const registered = await initialize(harness);
    const sidebar = await renderSlot(registered, "sidebar_content");

    expect(sidebar).not.toContain("5h");
  });

  test.each([
    [
      "sidebar",
      {
        providers: {
          codex: { enabled: true, label: "Codex Work", showSidebarBar: false },
        },
      },
      "sidebar_content",
      "session_prompt_right",
    ],
    [
      "footer",
      {
        providers: {
          codex: { enabled: true, label: "Codex Work", showFooterBar: false },
        },
      },
      "session_prompt_right",
      "sidebar_content",
    ],
  ] as const)(
    "supports an independent %s visibility toggle",
    async (_name, overrides, hiddenSlot, visibleSlot) => {
      const harness = createHarness(config(overrides));
      const registered = await initialize(harness);

      expect(await renderSlot(registered, hiddenSlot)).not.toContain("42%");
      expect(await renderSlot(registered, visibleSlot)).toContain(
        visibleSlot === "sidebar_content" ? "Codex Work" : "42%"
      );
    }
  );

  test("uses safe defaults when typed config parsing fails", async () => {
    const harness = createHarness();
    harness.state.configError = new ConfigDecodeError({
      cause: "schema",
      operation: "parse-config",
    });
    const registered = await initialize(harness);

    expect(harness.fetches).toEqual([]);
    expect(harness.scheduled[0]?.delayMs).toBe(60_000);
    expect(await renderSlot(registered, "sidebar_content")).not.toContain(
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

    await dispose();

    expect(harness.scheduled[0]?.cancelled).toBe(true);
    expect(harness.fetches).toEqual(["codex"]);
  });
});
