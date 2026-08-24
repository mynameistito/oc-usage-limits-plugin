import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import {
  fetchProvider,
  fetchProviderEffect,
  getProviderConfigs,
} from "@/providers.ts";
import { codexProvider } from "@/providers/codex.ts";
import type { ProviderDefinition } from "@/providers/definition.ts";
import {
  defaultLabelFor,
  pluginProviderForOpenCode,
  PROVIDER_ORDER,
  PROVIDER_REGISTRY,
  PROVIDERS,
} from "@/providers/index.ts";
import { ProviderRuntimeLive } from "@/providers/runtime/index.ts";
import type { ProviderUsage } from "@/types.ts";

import { installFetchMock } from "./helpers.ts";

describe("provider manifest", () => {
  test("binds each fetch result to its definition ID", () => {
    const definition: ProviderDefinition<"codex"> = codexProvider;
    const fetch: typeof definition.fetch = definition.fetch;

    expect(fetch).toBe(codexProvider.fetch);
  });
  test("defines every provider in display order", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual([
      ...PROVIDER_ORDER,
    ]);

    for (const id of PROVIDER_ORDER) {
      expect(PROVIDER_REGISTRY[id].id).toBe(id);
      expect(defaultLabelFor(id)).toEqual(PROVIDER_REGISTRY[id].defaultLabel);
    }
  });

  test("maps OpenCode session providers to plugin providers", () => {
    expect(pluginProviderForOpenCode("openai")).toBe("codex");
    expect(pluginProviderForOpenCode("zai-coding-plan")).toBe("zai");
    expect(pluginProviderForOpenCode("minimax-coding-plan")).toBe("minimax");
    expect(pluginProviderForOpenCode("minimax")).toBe("minimax");
    expect(pluginProviderForOpenCode("bailian-token-plan-personal")).toBe(
      "qwen"
    );
    expect(pluginProviderForOpenCode("qwen")).toBe("qwen");
    expect(pluginProviderForOpenCode("opencode-go")).toBe("opencode-go");
    expect(pluginProviderForOpenCode("anthropic")).toBeNull();
  });

  test("returns enabled providers in display order", () => {
    expect(
      getProviderConfigs({
        enabled: true,
        providers: {
          codex: { enabled: true, label: "Codex" },
          minimax: { enabled: true, label: "MiniMax" },
          qwen: { enabled: true, label: "Qwen" },
          synthetic: { enabled: true, label: "Synthetic" },
          zai: { enabled: false, label: "ZAI" },
        },
        refreshIntervalSeconds: 60,
        requestTimeoutMs: 1000,
        showErrors: true,
      })
    ).toEqual([
      ["codex", { enabled: true, label: "Codex" }],
      ["synthetic", { enabled: true, label: "Synthetic" }],
      ["minimax", { enabled: true, label: "MiniMax" }],
      ["qwen", { enabled: true, label: "Qwen" }],
    ]);
  });

  test("dispatches provider fetches by id", async () => {
    installFetchMock(
      Response.json({
        plan_type: "plus",
        rate_limit: { primary_window: { used_percent: 0 } },
        rate_limit_reset_credits: { available_count: 3 },
      })
    );

    const result: Promise<ProviderUsage<"codex">> = Effect.runPromise(
      fetchProviderEffect(
        "codex",
        { enabled: true },
        { openai: { access: "token", accountId: "account" } },
        1000
      ).pipe(Effect.provide(ProviderRuntimeLive))
    );
    await expect(result).resolves.toMatchObject({ id: "codex" });
  });

  test("rejects unknown provider ids", () => {
    // SAFETY: This deliberately exercises the runtime unknown-ID branch.
    expect(() =>
      fetchProvider("unknown" as never, undefined, {}, 1000)
    ).toThrow("unknown provider: unknown");
  });
});
