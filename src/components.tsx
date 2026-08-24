/* @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
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
  ProviderDisplaySettings,
  ProviderID,
  ProviderState,
  UsageWindow,
} from "@/types.ts";
import { quotaUsedPercent, usageWindowMatchesKind } from "@/usage.ts";

/**
 * Chooses the status-dot color for a usage percentage.
 *
 * @param usedPercent - Percentage consumed, or `null` when unknown.
 * @param theme - Active OpenCode TUI theme.
 * @returns A theme color indicating healthy, warning, error, or unknown usage.
 */
const dotColor = (usedPercent: number | null, theme: TuiThemeCurrent): RGBA => {
  if (usedPercent === null) {
    return theme.textMuted;
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
  theme: TuiThemeCurrent;
  windows: readonly UsageWindow[];
}) => (
  <For each={props.windows}>
    {(window) => (
      <box flexDirection="column">
        <text>
          <span style={{ fg: props.theme.textMuted }}>{"  "}</span>
          <span style={{ fg: props.theme.text }}>
            <b>{window.label}</b>
          </span>
          <span style={{ fg: props.theme.textMuted }}>
            {windowResetText(window)}
            {windowResetTime(window)}
          </span>
        </text>
        <text>
          <span style={{ fg: props.theme.textMuted }}>{"  "}</span>
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

const filterSidebarWindows = (
  id: ProviderID,
  windows: readonly UsageWindow[],
  display:
    | Readonly<Partial<Record<ProviderID, ProviderDisplaySettings>>>
    | undefined
): readonly UsageWindow[] => {
  const sidebarWindow = display?.[id]?.sidebarWindow ?? "all";
  return sidebarWindow === "all"
    ? windows
    : windows.filter((window) => usageWindowMatchesKind(sidebarWindow, window));
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
  display?: Readonly<Partial<Record<ProviderID, ProviderDisplaySettings>>>;
  theme: TuiThemeCurrent;
  lastRefreshAt: Date | null;
}) => {
  const visibleStates = createMemo(() =>
    props.states.filter((state) =>
      shouldRenderProviderState(state, props.showErrors)
    )
  );

  return (
    <Show when={visibleStates().length > 0}>
      <box flexDirection="column">
        <text fg={props.theme.text}>
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
                <text fg={props.theme.text}>
                  {state.label}
                  {tierName ? (
                    <span style={{ fg: props.theme.textMuted }}>
                      {" ["}
                      {tierName}
                      {"]"}
                    </span>
                  ) : null}
                  {isStale ? (
                    <span style={{ fg: props.theme.warning }}> stale</span>
                  ) : null}
                  {isCached ? (
                    <span style={{ fg: props.theme.warning }}> cached</span>
                  ) : null}
                </text>
                {state.status === "loading" ? (
                  <text fg={props.theme.textMuted}> loading...</text>
                ) : null}
                {state.status === "ready" ? (
                  <UsageWindowRows
                    showBar={
                      props.display?.[state.id]?.showSidebarBar !== false
                    }
                    theme={props.theme}
                    windows={filterSidebarWindows(
                      state.id,
                      state.data.windows,
                      props.display
                    )}
                  />
                ) : null}
                {state.status === "error" && state.previous ? (
                  <UsageWindowRows
                    showBar={
                      props.display?.[state.id]?.showSidebarBar !== false
                    }
                    theme={props.theme}
                    windows={filterSidebarWindows(
                      state.id,
                      state.previous.windows,
                      props.display
                    )}
                  />
                ) : null}
                {state.status === "error" && props.showErrors ? (
                  <text fg={props.theme.error}> {state.message}</text>
                ) : null}
              </box>
            );
          }}
        </For>
        {props.lastRefreshAt ? (
          <text fg={props.theme.textMuted}>
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
  theme: TuiThemeCurrent;
}) => (
  <Show when={props.window}>
    {(window) => (
      <text>
        {props.showBar ? (
          <span
            style={{
              fg: dotColor(quotaUsedPercent(window().quota), props.theme),
            }}
          >
            {percentBar(quotaUsedPercent(window().quota), 8)}
          </span>
        ) : null}
        <span style={{ fg: props.theme.text }}>
          {" "}
          {bottomWindowMainText(window())}
        </span>
        <span style={{ fg: props.theme.textMuted }}>
          {windowResetText(window())}
        </span>
      </text>
    )}
  </Show>
);

/**
 * Renders a compact single-line summary of all active providers.
 *
 * @param props - Provider states and active TUI theme.
 * @returns Solid/OpenTUI JSX for the home_bottom slot.
 */
export const CompactStatusLine = (props: {
  states: ProviderState[];
  theme: TuiThemeCurrent;
}) => {
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
          color: dotColor(quotaUsedPercent(window.quota), props.theme),
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
