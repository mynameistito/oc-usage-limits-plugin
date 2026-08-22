import { describe, expect, test } from "bun:test";

import { validatePreviewRelease } from "../scripts/release-guard";

describe("validatePreviewRelease", () => {
  test("accepts only the v2 next preview shape", () => {
    expect(() =>
      validatePreviewRelease({
        branch: "v2",
        distTag: "next",
        version: "2.0.0-next.3",
      })
    ).not.toThrow();
  });

  test("rejects stable branches, versions, and tags", () => {
    const cases = [
      { branch: "main", distTag: "next", version: "2.0.0-next.0" },
      { branch: "v2", distTag: "next", version: "2.0.0" },
      { branch: "v2", distTag: "latest", version: "2.0.0-next.0" },
    ];

    for (const release of cases) {
      expect(() => validatePreviewRelease(release)).toThrow();
    }
  });
});
