import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: [
      "@opencode-ai/plugin",
      "@opencode-ai/plugin/tui",
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
