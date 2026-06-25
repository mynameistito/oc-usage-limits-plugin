import { describe, expect, test } from "bun:test";

import { fetchProvider, getProviderConfigs } from "@/providers.ts";
import {
  defaultLabelFor,
  pluginProviderForOpenCode,
  PROVIDER_ORDER,
  PROVIDER_REGISTRY,
  PROVIDERS,
} from "@/providers/index.ts";

import { installFetchMock } from "./helpers.ts";

describe("provider manifest", () => {
  test("defines every provider in display order", () => {
    expect(PROVIDER_ORDER).toEqual(PROVIDERS.map((provider) => provider.id));

    for (const provider of PROVIDERS) {
      expect(PROVIDER_REGISTRY[provider.id]).toBe(provider);
      expect(defaultLabelFor(provider.id)).toEqual(provider.defaultLabel);
    }
  });

  test("maps OpenCode session providers to plugin providers", () => {
    expect(pluginProviderForOpenCode("openai")).toBe("codex");
    expect(pluginProviderForOpenCode("zai-coding-plan")).toBe("zai");
    expect(pluginProviderForOpenCode("minimax-coding-plan")).toBe("minimax");
    expect(pluginProviderForOpenCode("minimax")).toBe("minimax");
    expect(pluginProviderForOpenCode("anthropic")).toBeNull();
  });

  test("returns enabled providers in display order", () => {
    expect(
      getProviderConfigs({
        enabled: true,
        providers: {
          codex: { enabled: true, label: "Codex" },
          minimax: { enabled: true, label: "MiniMax" },
          zai: { enabled: false, label: "ZAI" },
        },
        refreshIntervalSeconds: 60,
        requestTimeoutMs: 1000,
        showErrors: true,
      })
    ).toEqual([
      ["codex", { enabled: true, label: "Codex" }],
      ["minimax", { enabled: true, label: "MiniMax" }],
    ]);
  });

  test("dispatches provider fetches by id", async () => {
    installFetchMock(
      Response.json({
        plan_type: "plus",
        rate_limit: {},
        rate_limit_reset_credits: { available_count: 3 },
      })
    );

    await expect(
      fetchProvider(
        "codex",
        { enabled: true },
        { openai: { access: "token", accountId: "account" } },
        1000
      )
    ).resolves.toMatchObject({ id: "codex" });
  });

  test("rejects unknown provider ids", () => {
    expect(() =>
      fetchProvider(
        "unknown" as never,
        { apiKey: "key", enabled: true },
        {},
        1000
      )
    ).toThrow("unknown provider: unknown");
  });
});
