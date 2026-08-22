/* @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { Effect, Result } from "effect";
import { createSignal } from "solid-js";

import { BottomUsage, UsageLimitsPanel } from "@/components.tsx";
import { DEFAULT_CONFIG, loadConfig, loadOpenCodeAuth } from "@/config.ts";
import { MissingProviderCredentialsError } from "@/errors.ts";
import { fetchProviderEffect, getProviderConfigs } from "@/providers.ts";
import { defaultLabelFor } from "@/providers/index.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import { currentProviderID, usageForProvider } from "@/session.ts";
import type {
  ProviderID,
  ProviderState,
  ProviderUsage,
  OpenCodeAuth,
  ProviderConfigMap,
} from "@/types.ts";

/** Runtime dependencies used by the usage-limits TUI lifecycle. */
export interface UsageLimitsTuiDependencies {
  /** Fetches one configured provider's usage. */
  fetchProvider: <ID extends ProviderID>(
    id: ID,
    config: ProviderConfigMap[ID] | undefined,
    openCodeAuth: OpenCodeAuth,
    timeoutMs: number
  ) => Promise<ProviderUsage<ID>>;
  /** Loads the fully resolved plugin configuration. */
  loadConfig: typeof loadConfig;
  /** Loads shared OpenCode provider authentication. */
  loadOpenCodeAuth: typeof loadOpenCodeAuth;
  /** Returns the current wall-clock time. */
  now: () => Date;
  /** Schedules work and returns a cancellation function. */
  schedule: (callback: () => Promise<void>, delayMs: number) => () => void;
}

const productionDependencies: UsageLimitsTuiDependencies = {
  fetchProvider: (id, config, auth, timeoutMs) =>
    Effect.runPromise(
      fetchProviderEffect(id, config, auth, timeoutMs).pipe(
        Effect.provide(ProviderRuntimeLive)
      )
    ),
  loadConfig,
  loadOpenCodeAuth,
  now: () => new Date(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
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
  async (api) => {
    const [states, setStates] = createSignal<ProviderState[]>([]);
    const [showErrors, setShowErrors] = createSignal(true);
    const [lastRefreshAt, setLastRefreshAt] = createSignal<Date | null>(null);
    let lastSuccess = new Map<ProviderID, ProviderUsage>();
    let refreshIntervalSeconds = 60;

    /**
     * Refreshes configuration and usage data for every enabled provider.
     *
     * Existing ready or error states are kept visible while new requests are in
     * flight. Failed refreshes retain the last successful usage payload so the UI
     * can still show stale usage alongside the error message.
     */
    const refresh = async () => {
      const configResult = await dependencies.loadConfig();
      // Plan 005 will render typed config failures. Keep the current safe
      // fallback at this coordinator boundary until that UI path exists.
      const config = Result.isFailure(configResult)
        ? DEFAULT_CONFIG
        : configResult.success;
      setShowErrors(config.showErrors);
      ({ refreshIntervalSeconds } = config);

      if (!config.enabled) {
        setStates([]);
        return;
      }

      const effectiveRefreshIntervalSeconds = Math.max(
        15,
        refreshIntervalSeconds
      );

      const providers = getProviderConfigs(config);
      const previous = new Map(states().map((state) => [state.id, state]));
      setStates(
        providers.map(([id, provider]) => {
          const label = provider.label ?? defaultLabelFor(id);
          const current = previous.get(id);
          if (current?.status === "ready" || current?.status === "error") {
            return current;
          }
          return { id, label, status: "loading" as const };
        })
      );

      const openCodeAuth = await dependencies.loadOpenCodeAuth();
      const nextStates = await Promise.all(
        providers.map(async ([id, provider]): Promise<ProviderState> => {
          const label = provider.label ?? defaultLabelFor(id);
          try {
            const data = await dependencies.fetchProvider(
              id,
              provider,
              openCodeAuth,
              config.requestTimeoutMs
            );
            lastSuccess.set(id, data);
            return { data, id, label, stale: false, status: "ready" };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "usage unavailable";
            const previousData = lastSuccess.get(id);
            if (previousData) {
              return {
                errorKind:
                  error instanceof MissingProviderCredentialsError
                    ? error.kind
                    : undefined,
                id,
                label,
                message,
                previous: previousData,
                status: "error",
              };
            }
            return {
              errorKind:
                error instanceof MissingProviderCredentialsError
                  ? error.kind
                  : undefined,
              id,
              label,
              message,
              status: "error",
            };
          }
        })
      );

      const staleAfterMs = effectiveRefreshIntervalSeconds * 2 * 1000;
      setStates(
        nextStates.map((state) => {
          if (state.status !== "ready") {
            return state;
          }
          return {
            ...state,
            stale:
              dependencies.now().getTime() - state.data.capturedAt.getTime() >
              staleAfterMs,
          };
        })
      );
      setLastRefreshAt(dependencies.now());
    };

    await refresh();
    let disposed = false;
    let cancelScheduledRefresh: (() => void) | undefined;
    const scheduleRefresh = () => {
      cancelScheduledRefresh = dependencies.schedule(
        async () => {
          await refresh();
          if (!disposed) {
            scheduleRefresh();
          }
        },
        Math.max(15, refreshIntervalSeconds) * 1000
      );
    };
    scheduleRefresh();

    api.lifecycle.onDispose(() => {
      disposed = true;
      cancelScheduledRefresh?.();
      lastSuccess = new Map();
    });

    api.slots.register({
      order: 101,
      slots: {
        session_prompt_right(ctx, props) {
          const providerID = currentProviderID(
            api.state.session.messages(props.session_id)
          );
          return (
            <BottomUsage
              theme={ctx.theme.current}
              window={usageForProvider(states(), providerID)}
            />
          );
        },
        sidebar_content(ctx) {
          return (
            <UsageLimitsPanel
              showErrors={showErrors()}
              states={states()}
              theme={ctx.theme.current}
              lastRefreshAt={lastRefreshAt()}
            />
          );
        },
      },
    });
  };

/** OpenCode TUI plugin entry point using production runtime dependencies. */
export const tui: TuiPlugin = createUsageLimitsTui(productionDependencies);
