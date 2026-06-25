import { describe, expect, test } from "bun:test";

import {
  defaultLabelFor,
  pluginProviderForOpenCode,
  PROVIDER_ORDER,
  PROVIDER_REGISTRY,
} from "@/providers/registry.ts";

describe("provider registry", () => {
  test("defines every provider in display order", () => {
    for (const id of PROVIDER_ORDER) {
      expect(PROVIDER_REGISTRY[id]).toBeDefined();
      expect(PROVIDER_REGISTRY[id].defaultLabel).toBe(defaultLabelFor(id));
    }
  });

  test("maps OpenCode session providers to plugin providers", () => {
    expect(pluginProviderForOpenCode("openai")).toBe("codex");
    expect(pluginProviderForOpenCode("zai-coding-plan")).toBe("zai");
    expect(pluginProviderForOpenCode("anthropic")).toBeNull();
  });
});
