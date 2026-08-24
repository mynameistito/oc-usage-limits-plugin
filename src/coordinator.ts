import { Effect, Result } from "effect";

import { DEFAULT_CONFIG } from "@/config.ts";
import { MissingProviderCredentialsError } from "@/errors.ts";
import type { ProviderError } from "@/errors.ts";
import { getProviderConfigs } from "@/providers.ts";
import { defaultLabelFor } from "@/providers/index.ts";
import type {
  OpenCodeAuth,
  ProviderConfigMap,
  ProviderDisplayConfig,
  ProviderID,
  ProviderState,
  ProviderUsage,
  ResolvedUsageLimitsConfig,
} from "@/types.ts";

export interface CoordinatorSnapshot {
  readonly states: readonly ProviderState[];
  readonly providerDisplays: Readonly<
    Partial<Record<ProviderID, ProviderDisplayConfig>>
  >;
  readonly showErrors: boolean;
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

const errorMessage = (error: Error): string =>
  error instanceof Error ? error.message : "usage unavailable";

const errorKind = (error: Error): "missing_credentials" | undefined =>
  error instanceof MissingProviderCredentialsError ? error.kind : undefined;

const loadingState = (
  id: ProviderID,
  config: ProviderConfigMap[ProviderID]
): ProviderState => ({
  id,
  label: config.label ?? defaultLabelFor(id),
  status: "loading",
});

const providerDisplaysFor = (
  providers: readonly (readonly [ProviderID, ProviderConfigMap[ProviderID]])[]
): Partial<Record<ProviderID, ProviderDisplayConfig>> =>
  Object.fromEntries(
    providers.map(([id, provider]) => [
      id,
      {
        footerWindow: provider.footerWindow ?? "auto",
        showFooterBar: provider.showFooterBar ?? true,
        showSidebarBar: provider.showSidebarBar ?? true,
        sidebarWindow: provider.sidebarWindow ?? "all",
      },
    ])
  );

export const usageCoordinator = (
  dependencies: UsageCoordinatorDependencies
): Effect.Effect<void> =>
  Effect.gen(function* coordinatorLoop() {
    const lastSuccess = new Map<ProviderID, ProviderUsage>();
    while (true) {
      const configResult = yield* dependencies.loadConfig;
      const config = Result.isFailure(configResult)
        ? DEFAULT_CONFIG
        : configResult.success;

      const intervalMs = intervalMilliseconds(config.refreshIntervalSeconds);
      const providers = config.enabled ? getProviderConfigs(config) : [];
      yield* dependencies.publish({
        lastRefreshAt: null,
        providerDisplays: providerDisplaysFor(providers),
        showErrors: config.showErrors,
        states: providers.map(([id, provider]) => loadingState(id, provider)),
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
                  return { ...state, previous };
                }
                return state;
              })
            )
          ),
          { concurrency: "unbounded" }
        );
        const now = yield* dependencies.now;
        const staleAfterMs = intervalMs * 2;
        yield* dependencies.publish({
          lastRefreshAt: now,
          providerDisplays: providerDisplaysFor(providers),
          showErrors: config.showErrors,
          states: terminalStates.map((state) =>
            state.status === "ready"
              ? {
                  ...state,
                  stale:
                    now.getTime() - state.data.capturedAt.getTime() >
                    staleAfterMs,
                }
              : state
          ),
        });
      } else {
        yield* dependencies.publish({
          lastRefreshAt: null,
          providerDisplays: {},
          showErrors: config.showErrors,
          states: [],
        });
      }

      yield* dependencies.sleep(intervalMs);
    }
  });
