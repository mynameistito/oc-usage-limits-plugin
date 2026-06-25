/* @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { UsageLimitsPanel } from "@/components.tsx";
import type { ProviderState, ProviderUsage, UsageWindow } from "@/types.ts";

const color = RGBA.fromValues(1, 2, 3, 255);

const theme: TuiThemeCurrent = {
  accent: color,
  background: color,
  backgroundElement: color,
  backgroundMenu: color,
  backgroundPanel: color,
  border: color,
  borderActive: color,
  borderSubtle: color,
  diffAdded: color,
  diffAddedBg: color,
  diffAddedLineNumberBg: color,
  diffContext: color,
  diffContextBg: color,
  diffHighlightAdded: color,
  diffHighlightRemoved: color,
  diffHunkHeader: color,
  diffLineNumber: color,
  diffRemoved: color,
  diffRemovedBg: color,
  diffRemovedLineNumberBg: color,
  error: color,
  info: color,
  markdownBlockQuote: color,
  markdownCode: color,
  markdownCodeBlock: color,
  markdownEmph: color,
  markdownHeading: color,
  markdownHorizontalRule: color,
  markdownImage: color,
  markdownImageText: color,
  markdownLink: color,
  markdownLinkText: color,
  markdownListEnumeration: color,
  markdownListItem: color,
  markdownStrong: color,
  markdownText: color,
  primary: color,
  secondary: color,
  selectedListItemText: color,
  success: color,
  syntaxComment: color,
  syntaxFunction: color,
  syntaxKeyword: color,
  syntaxNumber: color,
  syntaxOperator: color,
  syntaxPunctuation: color,
  syntaxString: color,
  syntaxType: color,
  syntaxVariable: color,
  text: color,
  textMuted: color,
  thinkingOpacity: 0.6,
  warning: color,
};

const usageWindow = (overrides: Partial<UsageWindow> = {}): UsageWindow => ({
  label: "5h",
  remainingPercent: 58,
  resetAfterSeconds: 3600,
  resetsAt: new Date("2026-06-23T12:00:00.000Z"),
  usedPercent: 42,
  ...overrides,
});

const usage = (overrides: Partial<ProviderUsage> = {}): ProviderUsage => ({
  capturedAt: new Date("2026-06-23T11:00:00.000Z"),
  id: "codex",
  label: "Codex",
  windows: [usageWindow()],
  ...overrides,
});

const renderPanelText = async (
  states: ProviderState[],
  showErrors: boolean,
  lastRefreshAt: Date | null = null
): Promise<string> => {
  const setup = await testRender(
    () => (
      <UsageLimitsPanel
        showErrors={showErrors}
        states={states}
        theme={theme}
        lastRefreshAt={lastRefreshAt}
      />
    ),
    { height: 12, width: 80 }
  );

  try {
    await setup.flush();
    return setup.captureCharFrame();
  } finally {
    setup.renderer.destroy();
  }
};

describe("UsageLimitsPanel", () => {
  test("renders ready provider windows", async () => {
    const text = await renderPanelText(
      [
        {
          data: usage(),
          id: "codex",
          label: "Codex",
          stale: false,
          status: "ready",
        },
      ],
      true
    );

    expect(text).toContain("Usage Limits");
    expect(text).toContain("Codex");
    expect(text).toContain("5h: 42% used resets 1h");
    expect(text).toContain("█████░░░░░░░");
  });

  test("renders previous windows and error text when errors are visible", async () => {
    const text = await renderPanelText(
      [
        {
          id: "codex",
          label: "Codex",
          message: "provider unavailable",
          previous: usage(),
          status: "error",
        },
      ],
      true
    );

    expect(text).toContain("Codex cached");
    expect(text).toContain("5h: 42% used resets 1h");
    expect(text).toContain("provider unavailable");
  });

  test("renders previous windows without error text when errors are hidden", async () => {
    const text = await renderPanelText(
      [
        {
          id: "codex",
          label: "Codex",
          message: "provider unavailable",
          previous: usage(),
          status: "error",
        },
      ],
      false
    );

    expect(text).toContain("Codex cached");
    expect(text).toContain("5h: 42% used resets 1h");
    expect(text).not.toContain("provider unavailable");
  });

  test("hides error-only providers when errors are hidden", async () => {
    const text = await renderPanelText(
      [
        {
          id: "codex",
          label: "Codex",
          message: "provider unavailable",
          status: "error",
        },
      ],
      false
    );

    expect(text).toContain("Codex");
    expect(text).not.toContain("provider unavailable");
    expect(text).not.toContain("5h: 42% used");
  });

  test("renders tier badge when provider has tierName", async () => {
    const text = await renderPanelText(
      [
        {
          data: usage({ tierName: "Pro" }),
          id: "codex",
          label: "Codex",
          stale: false,
          status: "ready",
        },
      ],
      true
    );

    expect(text).toContain("Codex [Pro]");
  });

  test("renders updated timestamp when lastRefreshAt is provided", async () => {
    const text = await renderPanelText(
      [
        {
          data: usage(),
          id: "codex",
          label: "Codex",
          stale: false,
          status: "ready",
        },
      ],
      true,
      new Date(2026, 5, 25, 14, 32, 0, 0)
    );

    expect(text).toContain("Updated 14:32");
  });
});
