import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import solid from "ultracite/oxlint/solid";
import antiSlop from "ultracite/oxlint/anti-slop";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";

export default defineConfig({
  extends: [core, solid, antiSlop, selectJsPlugins(["github", "sonarjs"])],
  ignorePatterns: core.ignorePatterns,
});
