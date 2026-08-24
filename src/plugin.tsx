/* @jsxImportSource @opentui/solid */
import type { Context } from "@opencode-ai/plugin/tui/context";
import { Effect, Fiber } from "effect";
import { createSignal } from "solid-js";

import { BottomUsage, UsageLimitsPanel } from "@/components.tsx";
import { loadConfig, loadOpenCodeAuth } from "@/config.ts";
import { usageCoordinator } from "@/coordinator.ts";
import type { ProviderError } from "@/errors.ts";
import { fetchProviderEffect } from "@/providers.ts";
import { pluginProviderForOpenCode } from "@/providers/index.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import { currentProviderID, usageForProvider } from "@/session.ts";
import type {
  ProviderID,
  ProviderDisplayConfig,
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderState,
  ProviderUsage,
} from "@/types.ts";

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
  (context: Context): (() => void) => {
    const [states, setStates] = createSignal<ProviderState[]>([]);
    const [providerDisplays, setProviderDisplays] = createSignal<
      Readonly<Partial<Record<ProviderID, ProviderDisplayConfig>>>
    >({});
    const [showErrors, setShowErrors] = createSignal(true);
    const [lastRefreshAt, setLastRefreshAt] = createSignal<Date | null>(null);
    const disposeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <UsageLimitsPanel
          providerDisplays={providerDisplays()}
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
        const usageProviderID = providerID
          ? pluginProviderForOpenCode(providerID)
          : null;
        return (
          <BottomUsage
            theme={context.theme}
            showBar={
              usageProviderID
                ? providerDisplays()[usageProviderID]?.showFooterBar !== false
                : true
            }
            window={usageForProvider(states(), providerID, providerDisplays())}
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
          setProviderDisplays(snapshot.providerDisplays);
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
