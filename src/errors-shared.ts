import { Schema } from "effect";

export const ProviderIDSchema = Schema.Literals([
  "codex",
  "zai",
  "synthetic",
  "minimax",
  "qwen",
  "opencode-go",
]);

export const credentialMessages = {
  codex: "missing Codex auth",
  minimax: "missing MiniMax key",
  "opencode-go": "missing OpenCode GO key",
  qwen: "missing Qwen credentials",
  synthetic: "missing Synthetic key",
  zai: "missing ZAI key",
} as const;

export const ProviderOperationSchema = Schema.Literals([
  "decode-response",
  "fetch-usage",
  "read-auth",
  "run-command",
]);

export const NonNegativeFiniteSchema = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0)
);

export const safeCause = {
  cause: Schema.optionalKey(
    Schema.Literals([
      "command",
      "decode",
      "filesystem",
      "forbidden",
      "http",
      "network",
      "output-limit",
      "rate-limit",
      "schema",
      "syntax",
      "timeout",
      "unauthorized",
      "unknown",
    ])
  ),
};

export const providerContext = {
  operation: ProviderOperationSchema,
  providerID: ProviderIDSchema,
};
