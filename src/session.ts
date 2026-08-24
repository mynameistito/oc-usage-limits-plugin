import {
  pluginProviderForOpenCode,
  PROVIDER_REGISTRY,
} from "@/providers/index.ts";
import type {
  ProviderDisplayConfig,
  ProviderID,
  FooterWindow,
  ProviderState,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import type { UsageWindowKind } from "@/usage.ts";
import { isRecord, isString } from "@/utils.ts";
import type { JsonValue } from "@/utils.ts";

/**
 * Extracts an OpenCode provider identifier from a session message-like value.
 *
 * OpenCode message shapes have changed over time, so the provider may be present
 * either directly on the message, nested under `message.model`, or under the
 * v2 session wrapper's `message.info` payload.
 *
 * @param message - Unknown message payload from OpenCode session state.
 * @returns The provider identifier when present.
 */
const getProviderFromMessage = (message: JsonValue): string | undefined => {
  if (!isRecord(message)) {
    return undefined;
  }

  const info = isRecord(message.info) ? message.info : message;

  if (isString(info.providerID)) {
    return info.providerID;
  }

  if (isRecord(info.model) && isString(info.model.providerID)) {
    return info.model.providerID;
  }

  if (isString(message.providerID)) {
    return message.providerID;
  }

  if (isRecord(message.model) && isString(message.model.providerID)) {
    return message.model.providerID;
  }

  return undefined;
};

/**
 * Finds the provider currently represented by a session's latest messages.
 *
 * Messages are scanned from newest to oldest so the returned provider reflects
 * the most recent model/provider selection in the active conversation.
 *
 * @param messages - OpenCode session messages.
 * @returns The latest provider identifier, or `undefined` when unavailable.
 */
export const currentProviderID = (
  messages: readonly JsonValue[]
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const providerID = getProviderFromMessage(messages[index]);
    if (providerID) {
      return providerID;
    }
  }

  return undefined;
};

/**
 * Extracts the usage data from a provider state, preferring the latest ready
 * data and falling back to the previous successful payload on error.
 */
const windowFromState = (
  state: ProviderState | undefined
): ProviderUsage | undefined => {
  if (!state) {
    return undefined;
  }
  if (state.status === "ready") {
    return state.data;
  }
  if (state.status === "error") {
    return state.previous;
  }
  return undefined;
};

/**
 * Selects the usage window that should be shown in the prompt footer.
 *
 * OpenCode provider IDs are mapped to this plugin's provider IDs, then the most
 * useful window is selected from the current provider state. If the latest fetch
 * failed, the last successful data attached to the error state is used.
 *
 * When the active provider is disabled or has no data, the first enabled
 * provider with data is used as a fallback so the footer is never empty.
 *
 * @param states - Current provider states maintained by the plugin.
 * @param providerID - OpenCode provider identifier for the active session.
 * @returns The best usage window for the active provider, or `null` if none can
 *   be shown.
 */
export const usageForProvider = (
  states: readonly ProviderState[],
  providerID: string | undefined,
  providerDisplays: Readonly<
    Partial<Record<ProviderID, ProviderDisplayConfig>>
  > = {}
): UsageWindow | null => {
  const usageID = providerID ? pluginProviderForOpenCode(providerID) : null;

  const resolveWindow = (id: ProviderID): UsageWindow | null => {
    const state = states.find((item) => item.id === id);
    const data = windowFromState(state);
    if (!data) {
      return null;
    }
    const displayConfig = providerDisplays[id];
    const requestedWindow: FooterWindow = displayConfig?.footerWindow ?? "auto";
    const footerWindowKind = PROVIDER_REGISTRY[id]?.footerWindowKind;
    const findForKind = (kind: UsageWindowKind | undefined) => {
      if (!kind) {
        return;
      }
      return (
        (kind === "rolling"
          ? data.windows.find((window) => window.label === "5h")
          : undefined) ?? data.windows.find((window) => window.kind === kind)
      );
    };
    const requestedKind =
      requestedWindow === "auto" ? footerWindowKind : requestedWindow;
    const requested = findForKind(requestedKind);
    if (requested) {
      return requested;
    }
    if (requestedWindow !== "auto") {
      const footer = findForKind(footerWindowKind);
      if (footer) {
        return footer;
      }
    }
    return data.windows[0] ?? null;
  };

  if (usageID) {
    const window = resolveWindow(usageID);
    if (window) {
      return window;
    }
  }

  // Fallback: first enabled provider with data.
  for (const state of states) {
    if (state.status === "disabled") {
      continue;
    }
    const window = resolveWindow(state.id);
    if (window) {
      return window;
    }
  }

  return null;
};
