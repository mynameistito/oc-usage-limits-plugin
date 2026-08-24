import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
interface PluginModule {
  readonly default?: {
    readonly id?: string;
    readonly tui?: unknown;
  };
}

const expectedId = "mynameistito.usage-limits";
const entrypoint = new URL("../dist/index.mjs", import.meta.url);
const require = createRequire(entrypoint);

const readManifest = async (path: string | URL): Promise<PackageManifest> => {
  const manifest: object = JSON.parse(await readFile(path, "utf-8"));
  // SAFETY: JSON manifest files are owned package metadata and are consumed through PackageManifest fields.
  return manifest as PackageManifest;
};

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

// SAFETY: The built package is the artifact being smoke-tested and is imported from the fixed entrypoint.
const module = (await import(entrypoint.href)) as PluginModule;
const plugin = module.default;

const validPlugin = plugin?.id === expectedId && Boolean(plugin.tui);
if (!validPlugin) {
  console.error(
    `Package smoke test failed: expected default export ${expectedId} with callable tui`
  );
  process.exit(1);
}

console.log(`Package smoke test passed: ${expectedId}`);
