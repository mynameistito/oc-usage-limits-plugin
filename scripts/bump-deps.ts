#!/usr/bin/env bun
/**
 * Updates project dependencies while preserving compatibility with OpenCode.
 *
 * This script intentionally uses two dependency lanes:
 *
 * 1. General dependencies are bumped with `bun update --latest <package...>`.
 * 2. Dependencies also managed by `anomalyco/opencode` are then pinned back to
 *    the exact versions from OpenCode's `dev` branch catalog/package manifests.
 *
 * Peer dependencies for OpenCode-aligned packages are written as exact versions
 * so consumers see the same host/runtime contract this package was tested with.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OPENCODE_ROOT_PACKAGE_URL =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/package.json";
const OPENCODE_PLUGIN_PACKAGE_URL =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/plugin/package.json";

const dependencyBlocks = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

const peerDependencyBlocks = ["peerDependencies"] as const;

const opencodeAlignedPackages = new Set([
  "@opencode-ai/plugin",
  "@opentui/core",
  "@opentui/solid",
  "solid-js",
]);

type DependencyBlock = (typeof dependencyBlocks)[number];
type PeerDependencyBlock = (typeof peerDependencyBlocks)[number];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  version?: string;
  workspaces?: {
    catalog?: Record<string, string>;
  };
}

/**
 * Finds the nearest project root by walking upward until a package manifest is found.
 *
 * @param startDir - Directory where the search should begin.
 * @returns The directory containing `package.json`.
 */
const findProjectRoot = (startDir: string) => {
  let currentDir = startDir;

  while (currentDir !== path.dirname(currentDir)) {
    if (existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    currentDir = path.dirname(currentDir);
  }

  if (existsSync(path.join(currentDir, "package.json"))) {
    return currentDir;
  }

  throw new Error("Could not find package.json from script location");
};

/**
 * Reads and parses a package manifest.
 *
 * @param packageJsonPath - Absolute path to the package manifest.
 * @returns Parsed package metadata.
 */
const readPackageJson = (packageJsonPath: string) =>
  JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson;

/**
 * Writes package metadata using standard two-space JSON formatting.
 *
 * @param packageJsonPath - Absolute path to the package manifest.
 * @param packageJson - Package metadata to write.
 */
const writePackageJson = (
  packageJsonPath: string,
  packageJson: PackageJson
) => {
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
};

/**
 * Fetches and parses a package manifest from GitHub raw content.
 *
 * @param url - Raw package manifest URL.
 * @returns Parsed package metadata.
 */
const fetchPackageJson = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return (await response.json()) as PackageJson;
};

/**
 * Runs a command in the project and fails fast on non-zero exit codes.
 *
 * @param command - Command and arguments to execute.
 * @param cwd - Working directory for the command.
 */
const run = async (command: string[], cwd: string) => {
  console.log(`$ ${command.join(" ")}`);

  const process = Bun.spawn(command, {
    cwd,
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await process.exited;

  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
};

/**
 * Lists direct dependencies that are safe to update from the public registry.
 *
 * OpenCode-aligned packages are skipped because their versions come from the
 * OpenCode source manifests, not from latest npm resolution.
 *
 * @param packageJson - Local package metadata to inspect.
 * @returns Direct dependency names that can be passed to `bun update --latest`.
 */
const getPackagesToUpdate = (packageJson: PackageJson) => {
  const packages = new Set<string>();

  for (const block of dependencyBlocks) {
    const dependencies = packageJson[block];

    if (!dependencies) {
      continue;
    }

    for (const name of Object.keys(dependencies)) {
      if (!opencodeAlignedPackages.has(name)) {
        packages.add(name);
      }
    }
  }

  return [...packages].toSorted();
};

/**
 * Converts an OpenCode-managed package version into a peer dependency version.
 *
 * This intentionally preserves exact versions rather than broadening them to
 * ranges, because these packages are supplied by the OpenCode host/runtime.
 *
 * @param version - Dependency version from the OpenCode source manifests.
 * @returns The exact version to write into peer dependencies.
 */
const toPeerVersion = (version: string) => version;

/**
 * Synchronizes a regular dependency block with OpenCode-managed versions.
 *
 * Only dependencies already declared by this package are changed.
 *
 * @param packageJson - Local package metadata to mutate.
 * @param block - Dependency block being synchronized.
 * @param opencodeVersions - Package versions sourced from OpenCode.
 * @returns Human-readable descriptions of changed entries.
 */
const syncBlock = (
  packageJson: PackageJson,
  block: DependencyBlock,
  opencodeVersions: Record<string, string>
) => {
  const dependencies = packageJson[block];

  if (!dependencies) {
    return [];
  }

  const changed: string[] = [];

  for (const [name, version] of Object.entries(opencodeVersions)) {
    if (!opencodeAlignedPackages.has(name)) {
      continue;
    }

    if (dependencies[name] && dependencies[name] !== version) {
      dependencies[name] = version;
      changed.push(`${block}.${name}=${version}`);
    }
  }

  return changed;
};

/**
 * Synchronizes peer dependencies with compatible OpenCode-managed ranges.
 *
 * Only peers already declared by this package are changed.
 *
 * @param packageJson - Local package metadata to mutate.
 * @param block - Peer dependency block being synchronized.
 * @param opencodeVersions - Package versions sourced from OpenCode.
 * @returns Human-readable descriptions of changed entries.
 */
const syncPeerBlock = (
  packageJson: PackageJson,
  block: PeerDependencyBlock,
  opencodeVersions: Record<string, string>
) => {
  const dependencies = packageJson[block];

  if (!dependencies) {
    return [];
  }

  const changed: string[] = [];

  for (const [name, version] of Object.entries(opencodeVersions)) {
    if (!opencodeAlignedPackages.has(name)) {
      continue;
    }

    const peerVersion = toPeerVersion(version);

    if (dependencies[name] && dependencies[name] !== peerVersion) {
      dependencies[name] = peerVersion;
      changed.push(`${block}.${name}=${peerVersion}`);
    }
  }

  return changed;
};

const projectRoot = findProjectRoot(import.meta.dirname);
const packageJsonPath = path.join(projectRoot, "package.json");
const initialPackageJson = readPackageJson(packageJsonPath);
const packagesToUpdate = getPackagesToUpdate(initialPackageJson);

if (packagesToUpdate.length > 0) {
  await run(["bun", "update", "--latest", ...packagesToUpdate], projectRoot);
} else {
  console.log("No non-OpenCode dependencies to update.");
}

const [opencodeRootPackageJson, opencodePluginPackageJson] = await Promise.all([
  fetchPackageJson(OPENCODE_ROOT_PACKAGE_URL),
  fetchPackageJson(OPENCODE_PLUGIN_PACKAGE_URL),
]);

if (!opencodePluginPackageJson.version) {
  throw new Error("OpenCode plugin package is missing a version");
}

const opencodeVersions = {
  ...opencodeRootPackageJson.workspaces?.catalog,
  "@opencode-ai/plugin": opencodePluginPackageJson.version,
};

const packageJson = readPackageJson(packageJsonPath);
const changes = [
  ...dependencyBlocks.flatMap((block) =>
    syncBlock(packageJson, block, opencodeVersions)
  ),
  ...peerDependencyBlocks.flatMap((block) =>
    syncPeerBlock(packageJson, block, opencodeVersions)
  ),
];

writePackageJson(packageJsonPath, packageJson);

if (changes.length > 0) {
  console.log("Synced OpenCode-aligned dependency versions:");

  for (const change of changes) {
    console.log(`  ${change}`);
  }
} else {
  console.log("OpenCode-aligned dependency versions already match.");
}

await run(["bun", "install"], projectRoot);
