/* @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid";
import { Effect, Fiber } from "effect";
import { createSignal } from "solid-js";

import { BottomUsage, UsageLimitsPanel } from "@/components.tsx";
import type { UsageTheme } from "@/components.tsx";
import { loadConfig, loadOpenCodeAuth } from "@/config.ts";
import { usageCoordinator } from "@/coordinator.ts";
import type { ProviderError } from "@/errors.ts";
import { fetchProviderEffect } from "@/providers.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import { currentProviderID, usageForProvider } from "@/session.ts";
import type {
  ProviderID,
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderState,
  ProviderUsage,
} from "@/types.ts";

export interface UsageLimitsSlotContext {
  sessionID?: string;
  mode?: "normal" | "shell";
}

type UsageLimitsSlot = (context: UsageLimitsSlotContext) => JSX.Element | null;

export interface UsageLimitsPluginContext {
  ui: {
    slot: (claim: {
      append: "sidebar.content" | "prompt.footer.status";
      render: UsageLimitsSlot;
    }) => () => void;
  };
  theme: UsageTheme;
  data: {
    session: {
      message: {
        list: (sessionID: string) => readonly unknown[];
      };
    };
  };
}

export interface UsageLimitsPlugin {
  id: string;
  setup: (context: UsageLimitsPluginContext) => () => void;
}

/** Runtime dependencies used by the usage-limits TUI lifecycle. */
export interface UsageLimitsTuiDependencies {
  /** Fetches one configured provider's usage. */
  fetchProvider: <ID extends ProviderID>(
    id: ID,
    config: ProviderConfigMap[ID] | undefined,
    openCodeAuth: OpenCodeAuth,
    timeoutMs: number
  ) => Effect.Effect<ProviderUsage<ID>, ProviderError>;
  /** Loads the fully resolved plugin configuration. */
  loadConfig: () => Promise<Awaited<ReturnType<typeof loadConfig>>>;
  /** Loads shared OpenCode provider authentication. */
  loadOpenCodeAuth: () => Promise<OpenCodeAuth>;
  /** Returns the current wall-clock time. */
  now: () => Date;
  /** Suspends the coordinator until its next refresh. */
  sleep?: (milliseconds: number) => Effect.Effect<void>;
}

const productionDependencies: UsageLimitsTuiDependencies = {
  fetchProvider: (id, config, auth, timeoutMs) =>
    fetchProviderEffect(id, config, auth, timeoutMs).pipe(
      Effect.provide(ProviderRuntimeLive)
    ),
  loadConfig,
  loadOpenCodeAuth,
  now: () => new Date(),
};

/**
 * Creates the OpenCode TUI plugin with explicit runtime dependencies.
 *
 * The plugin periodically loads configuration, fetches enabled provider usage,
 * stores the latest successful result for stale/error fallback, and registers UI
 * slots for both the sidebar panel and prompt-footer indicator.
 *
 * @param dependencies - Runtime loaders, provider fetcher, scheduler, and clock.
 * @returns The configured OpenCode v2 plugin setup function.
 */
export const createUsageLimitsPlugin =
  (dependencies: UsageLimitsTuiDependencies) =>
  (context: UsageLimitsPluginContext): (() => void) => {
    const [states, setStates] = createSignal<ProviderState[]>([]);
    const [showErrors, setShowErrors] = createSignal(true);
    const [lastRefreshAt, setLastRefreshAt] = createSignal<Date | null>(null);
    const disposeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <UsageLimitsPanel
          showErrors={showErrors()}
          states={states()}
          theme={context.theme}
          lastRefreshAt={lastRefreshAt()}
        />
      ),
    });
    const disposeFooter = context.ui.slot({
      append: "prompt.footer.status",
      render: (slot) => {
        if (!slot.sessionID || slot.mode === "shell") {
          return null;
        }
        const providerID = currentProviderID(
          context.data.session.message.list(slot.sessionID)
        );
        return (
          <BottomUsage
            theme={context.theme}
            window={usageForProvider(states(), providerID)}
          />
        );
      },
    });

    const coordinator = usageCoordinator({
      fetchProvider: dependencies.fetchProvider,
      loadConfig: Effect.tryPromise(dependencies.loadConfig),
      loadOpenCodeAuth: Effect.tryPromise(dependencies.loadOpenCodeAuth),
      now: Effect.sync(dependencies.now),
      publish: (snapshot) =>
        Effect.sync(() => {
          setShowErrors(snapshot.showErrors);
          setStates([...snapshot.states]);
          setLastRefreshAt(snapshot.lastRefreshAt);
        }),
      sleep: (milliseconds) =>
        dependencies.sleep?.(milliseconds) ?? Effect.sleep(milliseconds),
    });
    const fiber = Effect.runFork(Effect.scoped(coordinator));
    return () => {
      disposeSidebar();
      disposeFooter();
      Effect.runFork(Fiber.interrupt(fiber));
    };
  };

/** OpenCode v2 plugin setup using production runtime dependencies. */
export const setupUsageLimitsPlugin = createUsageLimitsPlugin(
  productionDependencies
);
