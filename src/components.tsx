/* @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { RGBA } from "@opentui/core";
import { For, Show } from "solid-js";

import {
  bottomWindowMainText,
  windowMainText,
  windowResetText,
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
        flexDirection="row"
        gap={1}
        children={[
          <text flexShrink={0} fg={dotColor(window.usedPercent, props.theme)}>
            •
          </text>,
          <text fg={props.theme.text}>
            {windowMainText(window)}
            <span style={{ fg: props.theme.textMuted }}>
              {windowResetText(window)}
            </span>
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
 * @param props - Provider states, error visibility, and active TUI theme.
 * @returns Solid/OpenTUI JSX for the sidebar content slot.
 */
export const UsageLimitsPanel = (props: {
  states: ProviderState[];
  showErrors: boolean;
  theme: TuiThemeCurrent;
}) => {
  if (!props.states.some((state) => state.status !== "disabled")) {
    return null;
  }

  return (
    <box
      children={[
        <text fg={props.theme.text}>
          <b>Usage Limits</b>
        </text>,
        <For each={props.states}>
          {(state) => {
            if (state.status === "disabled") {
              return null;
            }

            const isStale =
              (state.status === "ready" && state.stale) ||
              (state.status === "error" && state.previous !== undefined);
            const children = [
              <text fg={props.theme.text}>
                {state.label}
                {isStale ? " stale" : ""}
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
        </For>,
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
      <text fg={props.theme.text}>
        {bottomWindowMainText(window())}
        <span style={{ fg: props.theme.textMuted }}>
          {windowResetText(window())}
        </span>
      </text>
    )}
  </Show>
);
