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
import type { ProviderState, UsageWindow } from "@/types.ts";

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
  theme: TuiThemeCurrent;
  windows: UsageWindow[];
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
          <span style={{ fg: dotColor(window.usedPercent, props.theme) }}>
            {percentBar(window.usedPercent, 12)}
          </span>
          <span style={{ fg: dotColor(window.usedPercent, props.theme) }}>
            {" "}
            {formatPercent(window.usedPercent)} used
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
  theme: TuiThemeCurrent;
  lastRefreshAt: Date | null;
}) => {
  const visibleStates = createMemo(() =>
    props.states.filter((state) =>
      shouldRenderProviderState(state, props.showErrors)
    )
  );

  if (visibleStates().length === 0) {
    return null;
  }

  return (
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
                  theme={props.theme}
                  windows={state.data.windows}
                />
              ) : null}
              {state.status === "error" && state.previous ? (
                <UsageWindowRows
                  theme={props.theme}
                  windows={state.previous.windows}
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
  );
};

/**
 * Renders the compact active-provider usage indicator in the prompt footer.
 *
 * @param props - Active usage window and active TUI theme.
 * @returns Solid/OpenTUI JSX for the prompt footer slot.
 */
export const BottomUsage = (props: {
  window: UsageWindow | null;
  theme: TuiThemeCurrent;
}) => (
  <Show when={props.window}>
    {(window) => (
      <text>
        <span style={{ fg: dotColor(window().usedPercent, props.theme) }}>
          {percentBar(window().usedPercent, 8)}
        </span>
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
          color: dotColor(window.usedPercent, props.theme),
          text: `${state.label} ${formatPercent(window.usedPercent)}`,
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
