import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const expectedId = "mynameistito.usage-limits";
const entrypoint = new URL("../dist/index.mjs", import.meta.url);
const require = createRequire(entrypoint);

const readManifest = async (path: string | URL): Promise<PackageManifest> =>
  JSON.parse(await readFile(path, "utf-8"));

const packageManifest = await readManifest(
  new URL("../package.json", import.meta.url)
);
const openTuiSolidManifest = await readManifest(
  require.resolve("@opentui/solid/package.json")
);
const packageSolidVersion = packageManifest.peerDependencies?.["solid-js"];
const openTuiSolidVersion = openTuiSolidManifest.peerDependencies?.["solid-js"];

if (
  !packageSolidVersion ||
  !openTuiSolidVersion ||
  packageSolidVersion !== openTuiSolidVersion
) {
  console.error(
    `Package smoke test failed: solid-js peer ${packageSolidVersion ?? "missing"} does not match @opentui/solid peer ${openTuiSolidVersion ?? "missing"}`
  );
  process.exit(1);
}

try {
  require.resolve("effect");
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
  !("tui" in plugin) ||
  typeof plugin.tui !== "function"
) {
  console.error(
    `Package smoke test failed: expected default export ${expectedId} with callable tui`
  );
  process.exit(1);
}

console.log(`Package smoke test passed: ${expectedId}`);
