import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: [
      "@opencode-ai/plugin",
      "@opencode-ai/plugin/tui",
      "@opencode-ai/plugin/v2/effect",
      "@opencode-ai/plugin/v2/effect/integration",
      "@opencode-ai/plugin/v2/effect/plugin",
      "@opencode-ai/plugin/v2/promise",
      "@opentui/core",
      "@opentui/solid",
      "@opentui/solid/jsx-runtime",
      "solid-js",
      "solid-js/web",
    ],
  },
  dts: true,
  entry: ["src/index.ts"],
  format: "esm",
});
