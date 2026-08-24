/* @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { Effect, Fiber } from "effect";
import { createSignal } from "solid-js";

import { BottomUsage, UsageLimitsPanel } from "@/components.tsx";
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
  FooterWindow,
  SidebarWindow,
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
 * @returns The configured OpenCode TUI plugin.
 */
export const createUsageLimitsTui =
  (dependencies: UsageLimitsTuiDependencies): TuiPlugin =>
  (api) => {
    const [states, setStates] = createSignal<ProviderState[]>([]);
    const [showErrors, setShowErrors] = createSignal(true);
    const [showSidebar, setShowSidebar] = createSignal(true);
    const [showFooter, setShowFooter] = createSignal(true);
    const [show, setShow] = createSignal(true);
    const [sidebarWindow, setSidebarWindow] =
      createSignal<SidebarWindow>("all");
    const [footerWindows, setFooterWindows] = createSignal<
      Readonly<Partial<Record<ProviderID, FooterWindow>>>
    >({});
    const [lastRefreshAt, setLastRefreshAt] = createSignal<Date | null>(null);
    api.slots.register({
      order: 101,
      slots: {
        session_prompt_right(ctx, props) {
          const providerID = currentProviderID(
            api.state.session.messages(props.session_id)
          );
          return show() && showFooter() ? (
            <BottomUsage
              theme={ctx.theme.current}
              window={usageForProvider(states(), providerID, footerWindows())}
            />
          ) : null;
        },
        sidebar_content(ctx) {
          return show() && showSidebar() ? (
            <UsageLimitsPanel
              sidebarWindow={sidebarWindow()}
              showErrors={showErrors()}
              states={states()}
              theme={ctx.theme.current}
              lastRefreshAt={lastRefreshAt()}
            />
          ) : null;
        },
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
          setShow(snapshot.show);
          setShowSidebar(snapshot.showSidebar);
          setShowFooter(snapshot.showFooter);
          setSidebarWindow(snapshot.sidebarWindow);
          setFooterWindows(snapshot.footerWindows);
          setStates([...snapshot.states]);
          setLastRefreshAt(snapshot.lastRefreshAt);
        }),
      sleep: (milliseconds) =>
        dependencies.sleep?.(milliseconds) ?? Effect.sleep(milliseconds),
    });
    const fiber = Effect.runFork(Effect.scoped(coordinator));
    api.lifecycle.onDispose(() => Effect.runPromise(Fiber.interrupt(fiber)));
    return Promise.resolve();
  };

/** OpenCode TUI plugin entry point using production runtime dependencies. */
export const tui: TuiPlugin = createUsageLimitsTui(productionDependencies);
