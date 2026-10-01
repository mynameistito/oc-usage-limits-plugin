import { describe, expect, test } from "bun:test";

import { Deferred, Effect, Fiber, Result } from "effect";

import { usageCoordinator } from "@/coordinator.ts";
import type { CoordinatorSnapshot } from "@/coordinator.ts";
import type { ProviderError } from "@/errors.ts";
import type {
  OpenCodeAuth,
  ProviderID,
  ProviderUsage,
  ResolvedUsageLimitsConfig,
} from "@/types.ts";

const config: ResolvedUsageLimitsConfig = {
  enabled: true,
  providers: {
    codex: { enabled: true },
    zai: { enabled: true },
  },
  refreshIntervalSeconds: 15,
  requestTimeoutMs: 1000,
  showErrors: true,
};

const usage = (id: ProviderID): ProviderUsage => ({
  capturedAt: new Date("2026-08-14T12:00:00.000Z"),
  id,
  label: id,
  windows: [],
});

const dependencies = (
  fetchProvider: (id: ProviderID) => Effect.Effect<ProviderUsage, ProviderError>
) => {
  const snapshots: CoordinatorSnapshot[] = [];
  const sleeps: Deferred.Deferred<boolean>[] = [];
  return {
    dependencies: {
      fetchProvider: <ID extends ProviderID>(id: ID) =>
        // SAFETY: The fixture delegates to a provider mock with the generic contract.
        fetchProvider(id) as Effect.Effect<ProviderUsage<ID>, ProviderError>,
      loadConfig: Effect.succeed(Result.succeed(config)),
      // SAFETY: Empty auth is a valid fixture for the coordinator.
      loadOpenCodeAuth: Effect.succeed({} as OpenCodeAuth),
      now: Effect.succeed(new Date("2026-08-14T12:01:00.000Z")),
      publish: (snapshot: CoordinatorSnapshot) =>
        Effect.sync(() => {
          snapshots.push(snapshot);
        }),
      sleep: () =>
        Effect.gen(function* sleep() {
          const deferred = yield* Deferred.make<boolean>();
          sleeps.push(deferred);
          yield* Deferred.await(deferred).pipe(Effect.asVoid);
        }),
    },
    sleeps,
    snapshots,
  };
};

describe("usage coordinator", () => {
  test("publishes loading before concurrent providers reach terminal state", async () => {
    const gates = new Map<ProviderID, Deferred.Deferred<boolean>>();
    const harness = dependencies((id) =>
      Effect.gen(function* providerWork() {
        const gate = yield* Deferred.make<boolean>();
        gates.set(id, gate);
        yield* Deferred.await(gate).pipe(Effect.asVoid);
        return usage(id);
      })
    );
    const fiber = Effect.runFork(
      Effect.scoped(usageCoordinator(harness.dependencies))
    );

    await Bun.sleep(0);
    expect(harness.snapshots[0]?.states.map((state) => state.status)).toEqual([
      "loading",
      "loading",
    ]);
    expect(gates.size).toBe(2);

    const codexGate = gates.get("codex");
    if (!codexGate) {
      throw new Error("codex gate was not created");
    }
    await Effect.runPromise(Deferred.succeed(codexGate, true));
    await Bun.sleep(0);
    expect(harness.snapshots).toHaveLength(1);
    const zaiGate = gates.get("zai");
    if (!zaiGate) {
      throw new Error("zai gate was not created");
    }
    await Effect.runPromise(Deferred.succeed(zaiGate, true));
    await Bun.sleep(0);
    expect(harness.snapshots[1]?.states.map((state) => state.status)).toEqual([
      "ready",
      "ready",
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("keeps the previous snapshot visible while refreshing", async () => {
    const secondFetch = await Effect.runPromise(Deferred.make<boolean>());
    let fetchCount = 0;
    const harness = dependencies(() => {
      fetchCount += 1;
      return fetchCount <= 2
        ? Effect.succeed(usage("codex"))
        : Deferred.await(secondFetch).pipe(Effect.as(usage("codex")));
    });
    const fiber = Effect.runFork(
      Effect.scoped(usageCoordinator(harness.dependencies))
    );

    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(harness.snapshots[1]?.lastRefreshAt).toEqual(
      new Date("2026-08-14T12:01:00.000Z")
    );

    const [firstSleep] = harness.sleeps;
    if (!firstSleep) {
      throw new Error("first refresh sleep was not created");
    }
    await Effect.runPromise(Deferred.succeed(firstSleep, true));
    await Bun.sleep(0);

    expect(harness.snapshots[2]?.states.map((state) => state.status)).toEqual([
      "ready",
      "ready",
    ]);
    expect(harness.snapshots[2]?.lastRefreshAt).toEqual(
      new Date("2026-08-14T12:01:00.000Z")
    );

    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("clears cached provider state when a provider is disabled", async () => {
    const disabledCodexConfig: ResolvedUsageLimitsConfig = {
      ...config,
      providers: {
        ...config.providers,
        codex: { enabled: false },
      },
    };
    const configs = [config, disabledCodexConfig, config];
    let configIndex = 0;
    const harness = dependencies((id) => Effect.succeed(usage(id)));
    const coordinatorDependencies = {
      ...harness.dependencies,
      loadConfig: Effect.sync(() => {
        const currentConfig =
          configs[Math.min(configIndex, configs.length - 1)];
        configIndex += 1;
        if (!currentConfig) {
          throw new Error("coordinator config sequence is empty");
        }
        return Result.succeed(currentConfig);
      }),
    };
    const fiber = Effect.runFork(
      Effect.scoped(usageCoordinator(coordinatorDependencies))
    );

    await Bun.sleep(0);
    await Bun.sleep(0);
    const [firstSleep] = harness.sleeps;
    if (!firstSleep) {
      throw new Error("first refresh sleep was not created");
    }
    await Effect.runPromise(Deferred.succeed(firstSleep, true));
    await Bun.sleep(0);
    await Bun.sleep(0);

    const [secondSleep] = harness.sleeps.slice(1);
    if (!secondSleep) {
      throw new Error("second refresh sleep was not created");
    }
    await Effect.runPromise(Deferred.succeed(secondSleep, true));
    await Bun.sleep(0);

    expect(
      harness.snapshots[4]?.states.map((state) => [state.id, state.status])
    ).toEqual([
      ["codex", "loading"],
      ["zai", "ready"],
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("interrupts active provider work without publishing after disposal", async () => {
    const gate = await Effect.runPromise(Deferred.make<boolean>());
    const harness = dependencies(() =>
      Deferred.await(gate).pipe(Effect.as(usage("codex")))
    );
    const fiber = Effect.runFork(
      Effect.scoped(usageCoordinator(harness.dependencies))
    );

    await Bun.sleep(0);
    expect(
      harness.snapshots.map((snapshot) =>
        snapshot.states.map((state) => state.status)
      )
    ).toEqual([["loading", "loading"]]);
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(Deferred.succeed(gate, true));
    await Bun.sleep(0);
    expect(harness.snapshots).toHaveLength(1);
  });
});
