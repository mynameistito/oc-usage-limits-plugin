import { createRequire } from "node:module";

const expectedId = "mynameistito.usage-limits";
const entrypoint = new URL("../dist/index.mjs", import.meta.url);

try {
  createRequire(entrypoint).resolve("effect");
} catch {
  console.error(
    "Package smoke test failed: Effect did not resolve from the built entrypoint"
  );
  process.exit(1);
}

// SAFETY: The package entrypoint is checked immediately below before use.
interface PackagePlugin {
  readonly id?: string;
  readonly setup?: (...args: never[]) => void | Promise<void>;
}
// SAFETY: The package entrypoint is checked immediately below before use.
const module = (await import(entrypoint.href)) as { default?: PackagePlugin };
const plugin = module.default ?? null;

const hasExpectedId = (value: PackagePlugin | null | undefined): boolean =>
  value !== null &&
  value !== undefined &&
  "id" in value &&
  value.id === expectedId;
const hasSetup = (
  value: PackagePlugin | null | undefined
): value is PackagePlugin & { readonly setup: PackagePlugin["setup"] } =>
  value !== null && value !== undefined && value.setup !== undefined;
const isPlugin = hasExpectedId(plugin) && hasSetup(plugin);
if (!isPlugin) {
  console.error(
    `Package smoke test failed: expected default export ${expectedId} with callable setup`
  );
  process.exit(1);
}

console.log(`Package smoke test passed: ${expectedId}`);
