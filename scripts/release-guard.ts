interface PreviewRelease {
  branch: string;
  version: string;
  distTag: string;
}

const previewVersionPattern = /^2\.0\.0-next\.\d+$/u;

export const validatePreviewRelease = ({
  branch,
  version,
  distTag,
}: PreviewRelease): void => {
  if (branch !== "v2") {
    throw new Error(
      `Preview releases must run from the v2 branch, got ${branch}.`
    );
  }

  if (!previewVersionPattern.test(version)) {
    throw new Error(`Preview releases must use 2.0.0-next.N, got ${version}.`);
  }

  if (distTag !== "next") {
    throw new Error(
      `Preview releases must use the next dist-tag, got ${distTag}.`
    );
  }
};

const readOption = (args: string[], name: string): string => {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
};

const run = (args: string[]): void => {
  if (args[0] !== "preview") {
    throw new Error(
      "Usage: release-guard.ts preview --branch <branch> --version <version> --dist-tag <tag>"
    );
  }

  validatePreviewRelease({
    branch: readOption(args, "--branch"),
    distTag: readOption(args, "--dist-tag"),
    version: readOption(args, "--version"),
  });
};

if (import.meta.main) {
  try {
    run(process.argv.slice(2));
    console.log("Preview release guard passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
