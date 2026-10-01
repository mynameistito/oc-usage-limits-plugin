import { Effect, Result } from "effect";

import { DEFAULT_CONFIG } from "@/config.ts";
import { MissingProviderCredentialsError } from "@/errors.ts";
import type { ProviderError } from "@/errors.ts";
import { getProviderConfigs } from "@/providers.ts";
import { defaultLabelFor } from "@/providers/index.ts";
import type {
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderID,
  ProviderState,
  ProviderUsage,
  ResolvedUsageLimitsConfig,
  ProviderDisplaySettings,
} from "@/types.ts";

export interface CoordinatorSnapshot {
  readonly states: readonly ProviderState[];
  readonly showErrors: boolean;
  readonly display: Readonly<
    Partial<Record<ProviderID, ProviderDisplaySettings>>
  >;
  readonly lastRefreshAt: Date | null;
}

export interface UsageCoordinatorDependencies {
  readonly loadConfig: Effect.Effect<
    Result.Result<ResolvedUsageLimitsConfig, unknown>
  >;
  readonly loadOpenCodeAuth: Effect.Effect<OpenCodeAuth>;
  readonly fetchProvider: <ID extends ProviderID>(
    id: ID,
    config: ProviderConfigMap[ID] | undefined,
    auth: OpenCodeAuth,
    timeoutMs: number
  ) => Effect.Effect<ProviderUsage<ID>, ProviderError>;
  readonly now: Effect.Effect<Date>;
  readonly sleep: (milliseconds: number) => Effect.Effect<void>;
  readonly publish: (snapshot: CoordinatorSnapshot) => Effect.Effect<void>;
}

const intervalMilliseconds = (seconds: number): number =>
  Math.max(15, seconds) * 1000;

const errorMessage = (error: Error | ProviderError): string =>
  error instanceof Error ? error.message : "usage unavailable";

const errorKind = (
  error: Error | ProviderError
): "missing_credentials" | undefined =>
  error instanceof MissingProviderCredentialsError ? error.kind : undefined;

const loadingState = (
  id: ProviderID,
  config: ProviderConfigMap[ProviderID]
): ProviderState => ({
  id,
  label: config.label ?? defaultLabelFor(id),
  status: "loading",
});

const displaySettings = (
  provider: ProviderConfigMap[ProviderID]
): ProviderDisplaySettings => ({
  footerWindow: provider.footerWindow ?? "auto",
  showFooterBar: provider.showFooterBar ?? true,
  showSidebarBar: provider.showSidebarBar ?? true,
  sidebarWindow: provider.sidebarWindow ?? "all",
});

export const usageCoordinator = (
  dependencies: UsageCoordinatorDependencies
): Effect.Effect<void> =>
  Effect.gen(function* coordinatorLoop() {
    const lastSuccess = new Map<ProviderID, ProviderUsage>();
    const lastStates = new Map<ProviderID, ProviderState>();
    let lastRefreshAt: Date | null = null;
    let intervalMs: number;

    while (true) {
      const configResult = yield* dependencies.loadConfig;
      const config = Result.isFailure(configResult)
        ? DEFAULT_CONFIG
        : configResult.success;

      intervalMs = intervalMilliseconds(config.refreshIntervalSeconds);
      const providers = config.enabled ? getProviderConfigs(config) : [];
      const providerIDs = new Set(providers.map(([id]) => id));
      for (const id of lastStates.keys()) {
        if (!providerIDs.has(id)) {
          lastStates.delete(id);
          lastSuccess.delete(id);
        }
      }
      yield* dependencies.publish({
        display: Object.fromEntries(
          providers.map(([id, provider]) => [id, displaySettings(provider)])
        ),
        lastRefreshAt,
        showErrors: config.showErrors,
        states: providers.map(
          ([id, provider]) => lastStates.get(id) ?? loadingState(id, provider)
        ),
      });

      if (providers.length > 0) {
        const auth = yield* dependencies.loadOpenCodeAuth;
        const terminalStates = yield* Effect.all(
          providers.map(([id, provider]) =>
            Effect.match(
              dependencies.fetchProvider(
                id,
                provider,
                auth,
                config.requestTimeoutMs
              ),
              {
                onFailure: (error) => ({ error }),
                onSuccess: (data) => ({ data }),
              }
            ).pipe(
              Effect.map((result): ProviderState => {
                const label = provider.label ?? defaultLabelFor(id);
                if ("data" in result) {
                  lastSuccess.set(id, result.data);
                  return {
                    data: result.data,
                    id,
                    label,
                    stale: false,
                    status: "ready",
                  };
                }
                const previous = lastSuccess.get(id);
                const state: ProviderState = {
                  errorKind: errorKind(result.error),
                  id,
                  label,
                  message: errorMessage(result.error),
                  status: "error",
                };
                if (previous) {
                  state.previous = previous;
                }
                return state;
              })
            )
          ),
          { concurrency: "unbounded" }
        );
        const now = yield* dependencies.now;
        lastRefreshAt = now;
        const staleAfterMs = intervalMs * 2;
        const states = terminalStates.map((state) =>
          state.status === "ready"
            ? {
                ...state,
                stale:
                  now.getTime() - state.data.capturedAt.getTime() >
                  staleAfterMs,
              }
            : state
        );
        for (const state of states) {
          lastStates.set(state.id, state);
        }
        yield* dependencies.publish({
          display: Object.fromEntries(
            providers.map(([id, provider]) => [id, displaySettings(provider)])
          ),
          lastRefreshAt: now,
          showErrors: config.showErrors,
          states,
        });
      } else {
        lastRefreshAt = null;
        yield* dependencies.publish({
          display: {},
          lastRefreshAt: null,
          showErrors: config.showErrors,
          states: [],
        });
      }

      yield* dependencies.sleep(intervalMs);
    }
  });
