import { Schema } from "effect";

import {
  pluginProviderForOpenCode,
  PROVIDER_REGISTRY,
} from "@/providers/index.ts";
import type {
  ProviderID,
  ProviderState,
  ProviderUsage,
  UsageWindow,
  ProviderDisplaySettings,
} from "@/types.ts";
import type { UsageWindowKind } from "@/usage.ts";
import { usageWindowMatchesKind } from "@/usage.ts";
import { isRecord } from "@/utils.ts";

const providerIDSchema = Schema.decodeUnknownOption(Schema.String);

/**
 * Extracts an OpenCode provider identifier from a session message-like value.
 *
 * OpenCode message shapes have changed over time, so the provider may be present
 * either directly on the message or nested under `message.model`.
 *
 * @param message - Unknown message payload from OpenCode session state.
 * @returns The provider identifier when present.
 */
const getProviderFromMessage = <T>(message: T): string | undefined => {
  if (!isRecord(message)) {
    return undefined;
  }

  const directProvider = providerIDSchema(message.providerID);
  if (directProvider._tag === "Some") {
    return directProvider.value;
  }

  if (isRecord(message.model)) {
    const nestedProvider = providerIDSchema(message.model.providerID ?? null);
    if (nestedProvider._tag === "Some") {
      return nestedProvider.value;
    }
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
  messages: readonly unknown[]
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
  display: Readonly<Partial<Record<ProviderID, ProviderDisplaySettings>>> = {}
): UsageWindow | null => {
  const usageID = providerID ? pluginProviderForOpenCode(providerID) : null;

  const resolveWindow = (id: ProviderID): UsageWindow | null => {
    const state = states.find((item) => item.id === id);
    const data = windowFromState(state);
    if (!data) {
      return null;
    }
    const settings = display[id];
    if (settings?.showFooterBar === false) {
      return null;
    }
    const requestedWindow = settings?.footerWindow ?? "auto";
    const findWindow = (kind: UsageWindowKind): UsageWindow | undefined =>
      (kind === "rolling"
        ? data.windows.find((window) => window.label === "5h")
        : undefined) ??
      data.windows.find((window) => usageWindowMatchesKind(kind, window));
    const requested =
      requestedWindow === "auto" ? null : findWindow(requestedWindow);
    if (requested) {
      return requested;
    }
    const autoWindowKind = PROVIDER_REGISTRY[id]?.footerWindowKind;
    return findWindow(autoWindowKind) ?? data.windows[0] ?? null;
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
