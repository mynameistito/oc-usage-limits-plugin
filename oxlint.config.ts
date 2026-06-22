import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import solid from "ultracite/oxlint/solid";

export default defineConfig({
  extends: [core, solid],
  ignorePatterns: core.ignorePatterns,
});
