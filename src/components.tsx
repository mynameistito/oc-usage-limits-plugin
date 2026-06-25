/* @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { For, Show, createSignal } from "solid-js";

import {
  bottomWindowMainText,
  formatTimestamp,
  percentBar,
  tokenCountText,
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
      <box
        children={[
          <text>
            <span style={{ fg: props.theme.textMuted }}>{"  "}</span>
            <span style={{ fg: props.theme.text }}>
              <b>{window.label}</b>
            </span>
            <span style={{ fg: props.theme.textMuted }}>
              {windowResetText(window)}
              {windowResetTime(window)}
            </span>
          </text>,
          <text>
            <span style={{ fg: props.theme.textMuted }}>{"  "}</span>
            <span style={{ fg: dotColor(window.usedPercent, props.theme) }}>
              {percentBar(window.usedPercent, 12)}
            </span>
            <span style={{ fg: dotColor(window.usedPercent, props.theme) }}>
              {" "}
              {window.usedPercent === null
                ? "?"
                : `${Math.round(window.usedPercent)}% used`}
            </span>
            {tokenCountText(window) ? (
              <span style={{ fg: props.theme.textMuted }}>
                {tokenCountText(window)}
              </span>
            ) : null}
          </text>,
        ]}
      />
    )}
  </For>
);

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
  const [collapsed, setCollapsed] = createSignal(false);

  if (!props.states.some((state) => state.status !== "disabled")) {
    return null;
  }

  return (
    <box
      children={[
        <text fg={props.theme.text} onMouseDown={() => setCollapsed((v) => !v)}>
          <span style={{ fg: props.theme.text }}>
            {collapsed() ? "▶" : "▼"}
          </span>{" "}
          <b>Usage Limits</b>
          {collapsed() ? (
            <span style={{ fg: props.theme.textMuted }}>
              {" ("}
              {props.states.filter((s) => s.status !== "disabled").length}
              {")"}
            </span>
          ) : null}
        </text>,
        <Show when={!collapsed()}>
          <For each={props.states}>
            {(state) => {
              if (state.status === "disabled") {
                return null;
              }

              let tierName: string | undefined;
              if (state.status === "ready") {
                ({ tierName } = state.data);
              } else if (state.status === "error" && state.previous) {
                ({ tierName } = state.previous);
              }
              const isStale = state.status === "ready" && state.stale;
              const isCached =
                state.status === "error" && state.previous !== undefined;
              const children = [
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
                </text>,
              ];

              if (state.status === "loading") {
                children.push(
                  <text fg={props.theme.textMuted}> loading...</text>
                );
              }

              if (state.status === "ready") {
                children.push(
                  <UsageWindowRows
                    theme={props.theme}
                    windows={state.data.windows}
                  />
                );
              }

              if (state.status === "error" && state.previous) {
                children.push(
                  <UsageWindowRows
                    theme={props.theme}
                    windows={state.previous.windows}
                  />
                );
              }

              if (state.status === "error" && props.showErrors) {
                children.push(
                  <text fg={props.theme.error}> {state.message}</text>
                );
              }

              return <box children={children} />;
            }}
          </For>
          {props.lastRefreshAt ? (
            <text fg={props.theme.textMuted}>
              Updated {formatTimestamp(props.lastRefreshAt)}
            </text>
          ) : null}
        </Show>,
      ]}
    />
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
      if (!data) {return;}
      const [window] = data.windows;
      if (window) {
        const pct =
          window.usedPercent === null
            ? "?"
            : `${Math.round(window.usedPercent)}%`;
        parts.push({
          color: dotColor(window.usedPercent, props.theme),
          text: `${state.label} ${pct}`,
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
