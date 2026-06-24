import type {
  ProviderID,
  ProviderState,
  ProviderUsage,
  UsageWindow,
} from "@/types.ts";
import { isRecord } from "@/utils.ts";

/**
 * Extracts an OpenCode provider identifier from a session message-like value.
 *
 * OpenCode message shapes have changed over time, so the provider may be present
 * either directly on the message or nested under `message.model`.
 *
 * @param message - Unknown message payload from OpenCode session state.
 * @returns The provider identifier when present.
 */
const getProviderFromMessage = (message: unknown): string | undefined => {
  if (!isRecord(message)) {
    return undefined;
  }

  if (typeof message.providerID === "string") {
    return message.providerID;
  }

  if (isRecord(message.model) && typeof message.model.providerID === "string") {
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
 * Selects the usage window that should be shown in the prompt footer.
 *
 * OpenCode provider IDs are mapped to this plugin's provider IDs, then the most
 * useful window is selected from the current provider state. If the latest fetch
 * failed, the last successful data attached to the error state is used.
 *
 * @param states - Current provider states maintained by the plugin.
 * @param providerID - OpenCode provider identifier for the active session.
 * @returns The best usage window for the active provider, or `null` if none can
 *   be shown.
 */
export const usageForProvider = (
  states: readonly ProviderState[],
  providerID: string | undefined
): UsageWindow | null => {
  let usageID: ProviderID | null = null;
  if (providerID === "openai") {
    usageID = "codex";
  }
  if (providerID === "zai-coding-plan") {
    usageID = "zai";
  }
  if (providerID === "minimax-coding-plan") {
    usageID = "minimax";
  }
  if (providerID === "minimax") {
    usageID = "minimax";
  }
  if (!usageID) {
    return null;
  }

  const state = states.find((item) => item.id === usageID);
  let data: ProviderUsage | undefined;
  if (state?.status === "ready") {
    ({ data } = state);
  }
  if (state?.status === "error") {
    data = state.previous;
  }
  if (!data) {
    return null;
  }

  if (usageID === "zai") {
    return (
      data.windows.find((window) => window.label === "5h") ??
      data.windows[0] ??
      null
    );
  }

  return (
    data.windows.find((window) => window.label === "5h") ??
    data.windows[0] ??
    null
  );
};
