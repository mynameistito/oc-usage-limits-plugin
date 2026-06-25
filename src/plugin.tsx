/* @jsxImportSource @opentui/solid */
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";

import {
  BottomUsage,
  CompactStatusLine,
  UsageLimitsPanel,
} from "@/components.tsx";
import { loadConfig, loadOpenCodeAuth } from "@/config.ts";
import { fetchProvider, getProviderConfigs } from "@/providers.ts";
import { defaultLabelFor } from "@/providers/index.ts";
import { currentProviderID, usageForProvider } from "@/session.ts";
import type { ProviderID, ProviderState, ProviderUsage } from "@/types.ts";

/**
 * OpenCode TUI plugin entry point.
 *
 * The plugin periodically loads configuration, fetches enabled provider usage,
 * stores the latest successful result for stale/error fallback, and registers UI
 * slots for both the sidebar panel and prompt-footer indicator.
 *
 * @param api - OpenCode TUI plugin API supplied at plugin initialization.
 */
export const tui: TuiPlugin = async (api) => {
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
    const config = await loadConfig();
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

    const openCodeAuth = await loadOpenCodeAuth();
    const nextStates = await Promise.all(
      providers.map(async ([id, provider]): Promise<ProviderState> => {
        const label = provider.label ?? defaultLabelFor(id);
        try {
          const data = await fetchProvider(
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
              id,
              label,
              message,
              previous: previousData,
              status: "error",
            };
          }
          return { id, label, message, status: "error" };
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
          stale: Date.now() - state.data.capturedAt.getTime() > staleAfterMs,
        };
      })
    );
    setLastRefreshAt(new Date());
  };

  await refresh();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    timer = setTimeout(
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
    if (timer) {
      clearTimeout(timer);
    }
    lastSuccess = new Map();
  });

  api.slots.register({
    order: 101,
    slots: {
      home_bottom(ctx) {
        return (
          <CompactStatusLine states={states()} theme={ctx.theme.current} />
        );
      },
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
