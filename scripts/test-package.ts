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

const module = (await import(entrypoint.href)) as { default?: unknown };
const plugin = module.default;

if (
  typeof plugin !== "object" ||
  plugin === null ||
  !("id" in plugin) ||
  plugin.id !== expectedId ||
  !("setup" in plugin) ||
  typeof plugin.setup !== "function"
) {
  console.error(
    `Package smoke test failed: expected default export ${expectedId} with callable setup`
  );
  process.exit(1);
}

console.log(`Package smoke test passed: ${expectedId}`);
