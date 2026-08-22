import { describe, expect, test } from "bun:test";

import {
  validatePrereleaseMetadata,
  validatePreviewRelease,
} from "../scripts/release-guard";

describe("validatePreviewRelease", () => {
  test("accepts only the opencode-v2 next preview shape", () => {
    expect(() =>
      validatePreviewRelease({
        branch: "opencode-v2",
        distTag: "next",
        version: "2.0.0-next.3",
      })
    ).not.toThrow();
  });

  test("rejects stable branches, versions, and tags", () => {
    const cases = [
      { branch: "main", distTag: "next", version: "2.0.0-next.0" },
      {
        branch: "v2",
        distTag: "next",
        version: "2.0.0-next.0",
      },
      {
        branch: "opencode-v2",
        distTag: "latest",
        version: "2.0.0-next.0",
      },
    ];

    for (const release of cases) {
      expect(() => validatePreviewRelease(release)).toThrow();
    }
  });
});

describe("validatePrereleaseMetadata", () => {
  test("accepts committed prerelease metadata shape", () => {
    expect(() =>
      validatePrereleaseMetadata({
        changesets: [],
        mode: "pre",
        tag: "next",
      })
    ).not.toThrow();
  });

  test("rejects stable or incomplete metadata", () => {
    for (const metadata of [
      { changesets: [], mode: "exit", tag: "next" },
      { changesets: [], mode: "pre", tag: "latest" },
      { mode: "pre", tag: "next" },
    ]) {
      expect(() => validatePrereleaseMetadata(metadata)).toThrow();
    }
  });
});
