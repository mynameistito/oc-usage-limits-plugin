const expectedId = "mynameistito.usage-limits";
const entrypoint = new URL("../dist/index.mjs", import.meta.url).href;
const module = (await import(entrypoint)) as { default?: unknown };
const plugin = module.default;

if (
  typeof plugin !== "object" ||
  plugin === null ||
  !("id" in plugin) ||
  plugin.id !== expectedId ||
  !("tui" in plugin) ||
  typeof plugin.tui !== "function"
) {
  console.error(
    `Package smoke test failed: expected default export ${expectedId} with callable tui`
  );
  process.exit(1);
}

console.log(`Package smoke test passed: ${expectedId}`);
