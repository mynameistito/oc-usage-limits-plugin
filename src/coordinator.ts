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
  FooterWindow,
  SidebarWindow,
} from "@/types.ts";

export interface CoordinatorSnapshot {
  readonly states: readonly ProviderState[];
  readonly show: boolean;
  readonly showErrors: boolean;
  readonly showFooter: boolean;
  readonly showSidebar: boolean;
  readonly sidebarWindow: SidebarWindow;
  readonly footerWindows: Readonly<Partial<Record<ProviderID, FooterWindow>>>;
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

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "usage unavailable";

const errorKind = (error: unknown): "missing_credentials" | undefined =>
  error instanceof MissingProviderCredentialsError ? error.kind : undefined;

const loadingState = (
  id: ProviderID,
  config: ProviderConfigMap[ProviderID]
): ProviderState => ({
  id,
  label: config.label ?? defaultLabelFor(id),
  status: "loading",
});

export const usageCoordinator = (
  dependencies: UsageCoordinatorDependencies
): Effect.Effect<void> =>
  Effect.gen(function* coordinatorLoop() {
    const lastSuccess = new Map<ProviderID, ProviderUsage>();
    let intervalMs = intervalMilliseconds(
      DEFAULT_CONFIG.refreshIntervalSeconds
    );

    while (true) {
      const configResult = yield* dependencies.loadConfig;
      const config = Result.isFailure(configResult)
        ? DEFAULT_CONFIG
        : configResult.success;

      intervalMs = intervalMilliseconds(config.refreshIntervalSeconds);
      const providers = config.enabled ? getProviderConfigs(config) : [];
      yield* dependencies.publish({
        footerWindows: Object.fromEntries(
          providers.map(([id, provider]) => [
            id,
            provider.footerWindow ?? "auto",
          ])
        ),
        lastRefreshAt: null,
        show: config.show,
        showErrors: config.showErrors,
        showFooter: config.showFooter,
        showSidebar: config.showSidebar,
        sidebarWindow: config.sidebarWindow,
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
                return {
                  errorKind: errorKind(result.error),
                  id,
                  label,
                  message: errorMessage(result.error),
                  ...(previous ? { previous } : {}),
                  status: "error",
                };
              })
            )
          ),
          { concurrency: "unbounded" }
        );
        const now = yield* dependencies.now;
        const staleAfterMs = intervalMs * 2;
        yield* dependencies.publish({
          footerWindows: Object.fromEntries(
            providers.map(([id, provider]) => [
              id,
              provider.footerWindow ?? "auto",
            ])
          ),
          lastRefreshAt: now,
          show: config.show,
          showErrors: config.showErrors,
          showFooter: config.showFooter,
          showSidebar: config.showSidebar,
          sidebarWindow: config.sidebarWindow,
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
          footerWindows: {},
          lastRefreshAt: null,
          show: config.show,
          showErrors: config.showErrors,
          showFooter: config.showFooter,
          showSidebar: config.showSidebar,
          sidebarWindow: config.sidebarWindow,
          states: [],
        });
      }

      yield* dependencies.sleep(intervalMs);
    }
  });
