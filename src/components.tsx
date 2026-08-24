/* @jsxImportSource @opentui/solid */
import type { RGBA } from "@opentui/core";
import { createMemo, For, Show } from "solid-js";

import {
  bottomWindowMainText,
  formatPercent,
  formatTimestamp,
  percentBar,
  windowResetText,
  windowResetTime,
} from "@/format.ts";
import type {
  ProviderDisplayConfig,
  ProviderState,
  SidebarWindow,
  UsageWindow,
} from "@/types.ts";
import { quotaUsedPercent } from "@/usage.ts";

/**
 * Chooses the status-dot color for a usage percentage.
 *
 * @param usedPercent - Percentage consumed, or `null` when unknown.
 * @param theme - Active OpenCode TUI theme.
 * @returns A theme color indicating healthy, warning, error, or unknown usage.
 */
interface V2Theme {
  readonly text: {
    readonly default: RGBA;
    readonly subdued: RGBA;
    readonly feedback: {
      readonly warning: { readonly default: RGBA };
      readonly error: { readonly default: RGBA };
      readonly success: { readonly default: RGBA };
    };
  };
}

interface LegacyTheme {
  readonly text: RGBA;
  readonly textMuted: RGBA;
  readonly warning: RGBA;
  readonly error: RGBA;
  readonly success: RGBA;
}

export type UsageTheme = V2Theme | LegacyTheme;

interface ThemeColors {
  readonly text: RGBA;
  readonly subdued: RGBA;
  readonly warning: RGBA;
  readonly error: RGBA;
  readonly success: RGBA;
}

/** Local boundary for v2 theme data while the v2 plugin package is unavailable. */
const isV2Theme = (theme: UsageTheme): theme is V2Theme =>
  typeof theme.text === "object" &&
  theme.text !== null &&
  "feedback" in theme.text;

const resolveTheme = (theme: UsageTheme): ThemeColors => {
  if (!isV2Theme(theme)) {
    return {
      error: theme.error,
      subdued: theme.textMuted,
      success: theme.success,
      text: theme.text,
      warning: theme.warning,
    };
  }

  return {
    error: theme.text.feedback.error.default,
    subdued: theme.text.subdued,
    success: theme.text.feedback.success.default,
    text: theme.text.default,
    warning: theme.text.feedback.warning.default,
  };
};

const dotColor = (usedPercent: number | null, theme: ThemeColors): RGBA => {
  if (usedPercent === null) {
    return theme.subdued;
  }
  if (usedPercent >= 90) {
    return theme.error;
  }
  if (usedPercent >= 70) {
    return theme.warning;
  }
  return theme.success;
};

const UsageWindowRows = (props: {
  showBar: boolean;
  theme: ThemeColors;
  windows: readonly UsageWindow[];
}) => (
  <For each={props.windows}>
    {(window) => (
      <box flexDirection="column">
        <text>
          <span style={{ fg: props.theme.subdued }}>{"  "}</span>
          <span style={{ fg: props.theme.text }}>
            <b>{window.label}</b>
          </span>
          <span style={{ fg: props.theme.subdued }}>
            {windowResetText(window)}
            {windowResetTime(window)}
          </span>
        </text>
        <text>
          <span style={{ fg: props.theme.subdued }}>{"  "}</span>
          {props.showBar ? (
            <span
              style={{
                fg: dotColor(quotaUsedPercent(window.quota), props.theme),
              }}
            >
              {percentBar(quotaUsedPercent(window.quota), 12)}
            </span>
          ) : null}
          <span
            style={{
              fg: dotColor(quotaUsedPercent(window.quota), props.theme),
            }}
          >
            {" "}
            {formatPercent(quotaUsedPercent(window.quota))} used
          </span>
        </text>
      </box>
    )}
  </For>
);

export const shouldRenderProviderState = (
  state: ProviderState,
  showErrors: boolean
): boolean => {
  if (state.status === "disabled") {
    return false;
  }
  if (state.status !== "error") {
    return true;
  }
  if (state.previous) {
    return true;
  }

  return showErrors && state.errorKind !== "missing_credentials";
};

/**
 * Renders the sidebar usage-limits panel.
 *
 * The panel lists every enabled provider, shows loading and stale states, and can
 * optionally display provider fetch errors.
 *
 * @param props - Provider states, error visibility, active TUI theme, and last refresh timestamp.
 * @returns Solid/OpenTUI JSX for the sidebar content slot.
 */
export const UsageLimitsPanel = (props: {
  states: ProviderState[];
  showErrors: boolean;
  theme: UsageTheme;
  lastRefreshAt: Date | null;
  providerDisplays: Readonly<
    Partial<Record<ProviderState["id"], ProviderDisplayConfig>>
  >;
}) => {
  const colors = resolveTheme(props.theme);
  const displayConfigFor = (state: ProviderState): ProviderDisplayConfig =>
    props.providerDisplays[state.id] ?? {
      footerWindow: "auto",
      showFooterBar: true,
      showSidebarBar: true,
      sidebarWindow: "all",
    };
  const filteredWindowsFor = (
    state: ProviderState,
    windows: readonly UsageWindow[]
  ): UsageWindow[] => {
    const sidebarWindow: SidebarWindow = displayConfigFor(state).sidebarWindow;
    return sidebarWindow === "all"
      ? [...windows]
      : windows.filter(
          (window) =>
            window.kind === sidebarWindow ||
            (sidebarWindow === "rolling" && window.label === "5h")
        );
  };
  const visibleStates = createMemo(() =>
    props.states.filter((state) => {
      if (!shouldRenderProviderState(state, props.showErrors)) {
        return false;
      }
      if (state.status === "ready") {
        return filteredWindowsFor(state, state.data.windows).length > 0;
      }
      if (state.status === "error" && state.previous) {
        return filteredWindowsFor(state, state.previous.windows).length > 0;
      }
      return true;
    })
  );

  return (
    <Show when={visibleStates().length > 0}>
      <box flexDirection="column">
        <text fg={colors.text}>
          <b>Usage Limits</b>
        </text>
        <For each={visibleStates()}>
          {(state) => {
            let tierName: string | undefined;
            if (state.status === "ready") {
              ({ tierName } = state.data);
            } else if (state.status === "error" && state.previous) {
              ({ tierName } = state.previous);
            }
            const isStale = state.status === "ready" && state.stale;
            const isCached =
              state.status === "error" && state.previous !== undefined;

            return (
              <box flexDirection="column">
                <text fg={colors.text}>
                  {state.label}
                  {tierName ? (
                    <span style={{ fg: colors.subdued }}>
                      {" ["}
                      {tierName}
                      {"]"}
                    </span>
                  ) : null}
                  {isStale ? (
                    <span style={{ fg: colors.warning }}> stale</span>
                  ) : null}
                  {isCached ? (
                    <span style={{ fg: colors.warning }}> cached</span>
                  ) : null}
                </text>
                {state.status === "loading" ? (
                  <text fg={colors.subdued}> loading...</text>
                ) : null}
                {state.status === "ready" ? (
                  <UsageWindowRows
                    showBar={displayConfigFor(state).showSidebarBar}
                    theme={colors}
                    windows={filteredWindowsFor(state, state.data.windows)}
                  />
                ) : null}
                {state.status === "error" && state.previous ? (
                  <UsageWindowRows
                    showBar={displayConfigFor(state).showSidebarBar}
                    theme={colors}
                    windows={filteredWindowsFor(state, state.previous.windows)}
                  />
                ) : null}
                {state.status === "error" && props.showErrors ? (
                  <text fg={colors.error}> {state.message}</text>
                ) : null}
              </box>
            );
          }}
        </For>
        {props.lastRefreshAt ? (
          <text fg={colors.subdued}>
            Updated {formatTimestamp(props.lastRefreshAt)}
          </text>
        ) : null}
      </box>
    </Show>
  );
};

/**
 * Renders the compact active-provider usage indicator in the prompt footer.
 *
 * @param props - Active usage window and active TUI theme.
 * @returns Solid/OpenTUI JSX for the prompt footer slot.
 */
export const BottomUsage = (props: {
  showBar: boolean;
  window: UsageWindow | null;
  theme: UsageTheme;
}) => {
  const colors = resolveTheme(props.theme);
  return (
    <Show when={props.window}>
      {(window) => (
        <text>
          {props.showBar ? (
            <span
              style={{
                fg: dotColor(quotaUsedPercent(window().quota), colors),
              }}
            >
              {percentBar(quotaUsedPercent(window().quota), 8)}
            </span>
          ) : null}
          <span style={{ fg: colors.text }}>
            {" "}
            {bottomWindowMainText(window())}
          </span>
          <span style={{ fg: colors.subdued }}>
            {windowResetText(window())}
          </span>
        </text>
      )}
    </Show>
  );
};

/**
 * Renders a compact single-line summary of all active providers.
 *
 * @param props - Provider states and active TUI theme.
 * @returns Solid/OpenTUI JSX for the home_bottom slot.
 */
export const CompactStatusLine = (props: {
  states: ProviderState[];
  theme: UsageTheme;
}) => {
  const colors = resolveTheme(props.theme);
  const activeProviders = props.states.filter((s) => s.status !== "disabled");
  if (activeProviders.length === 0) {
    return null;
  }

  const parts: { text: string; color: RGBA }[] = [];
  for (const state of activeProviders) {
    if (
      state.status === "ready" ||
      (state.status === "error" && state.previous)
    ) {
      const data = state.status === "ready" ? state.data : state.previous;
      if (!data) {
        return;
      }
      const [window] = data.windows;
      if (window) {
        parts.push({
          color: dotColor(quotaUsedPercent(window.quota), colors),
          text: `${state.label} ${formatPercent(quotaUsedPercent(window.quota))}`,
        });
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <text>
      {parts.map((part, i) => (
        <span>
          {i > 0 ? " | " : ""}
          <span style={{ fg: part.color }}>{part.text}</span>
        </span>
      ))}
    </text>
  );
};
