import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";
import solid from "ultracite/oxlint/solid";

export default defineConfig({
  extends: [core, solid, antiSlop, selectJsPlugins(["github", "sonarjs"])],
  ignorePatterns: core.ignorePatterns,
});
