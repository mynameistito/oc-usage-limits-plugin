import { Schema } from "effect";

import { providerContext, safeCause } from "@/errors-shared.ts";

/** Provider returned a payload that could not be decoded safely. */
export class ProviderResponseDecodeError extends Schema.TaggedErrorClass<ProviderResponseDecodeError>()(
  "ProviderResponseDecodeError",
  {
    ...providerContext,
    ...safeCause,
  }
) {
  override get message(): string {
    const labels = {
      codex: "Codex",
      minimax: "MiniMax",
      "opencode-go": "OpenCode GO",
      qwen: "Qwen",
      synthetic: "Synthetic",
      zai: "ZAI",
    } as const;
    return `invalid ${labels[this.providerID]} usage`;
  }
}
