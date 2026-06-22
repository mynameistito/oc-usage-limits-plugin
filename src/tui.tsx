/** @jsxImportSource @opentui/solid */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { RGBA } from "@opentui/core"
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { For, Show, createSignal } from "solid-js"

type ProviderID = "codex" | "zai"

type UsageWindow = {
  label: string
  usedPercent: number | null
  remainingPercent: number | null
  resetsAt: Date | null
  resetAfterSeconds: number | null
  current?: number
  total?: number
}

type ProviderUsage = {
  id: ProviderID
  label: string
  tierName?: string
  capturedAt: Date
  windows: UsageWindow[]
  metadata?: Record<string, string | number | boolean | null>
}

type ProviderState =
  | { id: ProviderID; label: string; status: "disabled" }
  | { id: ProviderID; label: string; status: "loading" }
  | { id: ProviderID; label: string; status: "ready"; data: ProviderUsage; stale: boolean }
  | { id: ProviderID; label: string; status: "error"; message: string; previous?: ProviderUsage }

type ProviderConfig = {
  enabled?: boolean
  label?: string
  authPath?: string
  apiKey?: string
  authorizationScheme?: "raw" | "bearer"
  baseUrl?: string
}

type UsageLimitsConfig = {
  enabled?: boolean
  refreshIntervalSeconds?: number
  requestTimeoutMs?: number
  showErrors?: boolean
  providers?: Partial<Record<ProviderID, ProviderConfig>>
}

type OpenCodeAuth = {
  openai?: {
    access?: string
    accountId?: string
  }
  "zai-coding-plan"?: {
    key?: string
  }
  zai?: {
    key?: string
  }
}

const CONFIG_PATH = path.join(homedir(), ".config", "opencode", "usage-limits.jsonc")
const OPENCODE_AUTH_PATH = path.join(homedir(), ".local", "share", "opencode", "auth.json")
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api"
const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit"

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stripJsonComments = (input: string): string => {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }

    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") {
        index += 1
      }
      output += "\n"
      continue
    }

    if (char === "/" && next === "*") {
      index += 2
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1
      }
      index += 1
      continue
    }

    output += char
  }

  return output.replace(/,\s*([}\]])/g, "$1")
}

const expandHome = (value: string): string =>
  value === "~" || value.startsWith("~/") || value.startsWith("~\\")
    ? path.join(homedir(), value.slice(2))
    : value

const readJsonFile = async <T,>(filePath: string): Promise<T> => {
  const raw = await readFile(expandHome(filePath), "utf8")
  return JSON.parse(stripJsonComments(raw)) as T
}

const loadConfig = async (): Promise<Required<UsageLimitsConfig>> => {
  const fallback: Required<UsageLimitsConfig> = {
    enabled: true,
    providers: {},
    refreshIntervalSeconds: 60,
    requestTimeoutMs: 10_000,
    showErrors: true,
  }

  try {
    const config = await readJsonFile<UsageLimitsConfig>(CONFIG_PATH)
    return {
      enabled: config.enabled ?? fallback.enabled,
      providers: config.providers ?? fallback.providers,
      refreshIntervalSeconds: config.refreshIntervalSeconds ?? fallback.refreshIntervalSeconds,
      requestTimeoutMs: config.requestTimeoutMs ?? fallback.requestTimeoutMs,
      showErrors: config.showErrors ?? fallback.showErrors,
    }
  } catch {
    return fallback
  }
}

const loadOpenCodeAuth = async (): Promise<OpenCodeAuth> => {
  try {
    return await readJsonFile<OpenCodeAuth>(OPENCODE_AUTH_PATH)
  } catch {
    return {}
  }
}

const resolveEnvReference = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const envMatch = /^\{env:([^}]+)\}$/i.exec(value.trim())
  if (envMatch?.[1]) {
    return process.env[envMatch[1]]
  }

  return value
}

const fetchJson = async (url: string, init: RequestInit, timeoutMs: number): Promise<unknown> => {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("unauthorized")
    }
    if (response.status === 403) {
      throw new Error("forbidden")
    }
    if (response.status === 429) {
      throw new Error("rate limited")
    }
    throw new Error(`HTTP ${response.status}`)
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error("invalid JSON")
  }
}

const duration = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "now"
  }

  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) {
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
  }

  const days = Math.floor(hours / 24)
  const hourRemainder = hours % 24
  return hourRemainder === 0 ? `${days}d` : `${days}d ${hourRemainder}h`
}

const formatPercent = (value: number | null): string => (value === null ? "?" : `${Math.round(value)}%`)

const limitLabelForWindow = (seconds: number, fallback: string): string => {
  const minutes = Math.ceil(seconds / 60)
  const roughly = (expected: number) => minutes >= expected * 0.95 && minutes <= expected * 1.05
  const hour = 60
  const day = 24 * hour

  if (roughly(5 * hour)) return "5h"
  if (roughly(day)) return "daily"
  if (roughly(7 * day)) return "weekly"
  if (roughly(30 * day)) return "monthly"
  return fallback
}

const readCodexAuthFile = async (authPath: string | undefined): Promise<{ access: string; accountId: string }> => {
  const auth = await readJsonFile<unknown>(authPath ?? "~/.codex/auth.json")
  if (!isRecord(auth) || !isRecord(auth.tokens)) {
    throw new Error("missing Codex auth")
  }

  const access = auth.tokens.access_token
  const accountId = auth.tokens.account_id
  if (typeof access !== "string" || typeof accountId !== "string") {
    throw new Error("missing Codex auth")
  }

  return { access, accountId }
}

const codexWindow = (value: unknown, fallback: string): UsageWindow | null => {
  if (!isRecord(value)) {
    return null
  }

  const used = typeof value.used_percent === "number" ? clampPercent(value.used_percent) : null
  const resetAfter = typeof value.reset_after_seconds === "number" ? value.reset_after_seconds : null
  const windowSeconds = typeof value.limit_window_seconds === "number" ? value.limit_window_seconds : 0
  const resetAt = typeof value.reset_at === "number" && value.reset_at > 0 ? new Date(value.reset_at * 1000) : null

  return {
    label: windowSeconds > 0 ? limitLabelForWindow(windowSeconds, fallback) : fallback,
    remainingPercent: used === null ? null : 100 - used,
    resetAfterSeconds: resetAfter,
    resetsAt: resetAt,
    usedPercent: used,
  }
}

const fetchCodexUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const openai = openCodeAuth.openai
  const credentials =
    typeof openai?.access === "string" && typeof openai.accountId === "string"
      ? { access: openai.access, accountId: openai.accountId }
      : await readCodexAuthFile(config?.authPath)

  const baseUrl = config?.baseUrl ?? DEFAULT_CODEX_BASE_URL
  const payload = await fetchJson(
    `${baseUrl.replace(/\/$/, "")}/wham/usage`,
    {
      headers: {
        Authorization: `Bearer ${credentials.access}`,
        "ChatGPT-Account-Id": credentials.accountId,
        "User-Agent": "opencode-usage-limits",
      },
      method: "GET",
    },
    timeoutMs
  )

  if (!isRecord(payload)) {
    throw new Error("invalid Codex usage")
  }

  const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : undefined
  const windows = [
    codexWindow(rateLimit?.primary_window, "usage"),
    codexWindow(rateLimit?.secondary_window, "secondary"),
  ].filter((item): item is UsageWindow => item !== null)
  const resetCredits = isRecord(payload.rate_limit_reset_credits)
    && typeof payload.rate_limit_reset_credits.available_count === "number"
    ? payload.rate_limit_reset_credits.available_count
    : null

  return {
    capturedAt: new Date(),
    id: "codex",
    label: config?.label ?? "codex",
    metadata: { resetCredits },
    tierName: typeof payload.plan_type === "string" ? payload.plan_type : undefined,
    windows,
  }
}

const inferZaiTier = (total: number | null): string | undefined => {
  if (total === null) return undefined
  if (total >= 1400) return "Max"
  if (total >= 300) return "Pro"
  if (total > 0) return "Lite"
  return undefined
}

const keyFromZaiAuth = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value.key === "string") {
    return value.key
  }

  if (typeof value.apiKey === "string") {
    return value.apiKey
  }

  const zaiCodingPlan = value["zai-coding-plan"]
  if (isRecord(zaiCodingPlan) && typeof zaiCodingPlan.key === "string") {
    return zaiCodingPlan.key
  }

  if (isRecord(value.zai) && typeof value.zai.key === "string") {
    return value.zai.key
  }

  return undefined
}

const readZaiAuthPathKey = async (authPath: string | undefined): Promise<string | undefined> => {
  if (!authPath) {
    return undefined
  }

  try {
    return keyFromZaiAuth(await readJsonFile<unknown>(authPath))
  } catch {
    return undefined
  }
}

const fetchZaiUsage = async (
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  const configuredKey = resolveEnvReference(config?.apiKey)
  const apiKey = (await readZaiAuthPathKey(config?.authPath)) ?? keyFromZaiAuth(openCodeAuth) ?? configuredKey
  if (!apiKey) {
    throw new Error("missing ZAI key")
  }

  const scheme = config?.authorizationScheme ?? "raw"
  const payload = await fetchJson(
    ZAI_QUOTA_URL,
    {
      headers: {
        "Accept-Language": "en-US,en",
        Authorization: scheme === "bearer" ? `Bearer ${apiKey}` : apiKey,
        "Content-Type": "application/json",
      },
      method: "GET",
    },
    timeoutMs
  )

  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.limits)) {
    throw new Error("invalid ZAI usage")
  }

  const windows: UsageWindow[] = []
  let promptTotal: number | null = null

  for (const limit of payload.data.limits) {
    if (!isRecord(limit) || typeof limit.type !== "string") {
      continue
    }

    const usedPercent = typeof limit.percentage === "number" ? clampPercent(limit.percentage) : null
    const resetsAt = typeof limit.nextResetTime === "number" ? new Date(limit.nextResetTime) : null
    const current = typeof limit.currentValue === "number" ? limit.currentValue : undefined
    const total = typeof limit.usage === "number" ? limit.usage : undefined

    if (limit.type === "TOKENS_LIMIT") {
      windows.push({
        label: "tokens",
        remainingPercent: usedPercent === null ? null : 100 - usedPercent,
        resetAfterSeconds: resetsAt ? Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000)) : null,
        resetsAt,
        usedPercent,
      })
    }

    if (limit.type === "TIME_LIMIT") {
      promptTotal = total ?? null
      windows.push({
        current,
        label: "MCP",
        remainingPercent: usedPercent === null ? null : 100 - usedPercent,
        resetAfterSeconds: null,
        resetsAt: null,
        total,
        usedPercent,
      })
    }
  }

  return {
    capturedAt: new Date(),
    id: "zai",
    label: config?.label ?? "ZAI",
    tierName: inferZaiTier(promptTotal),
    windows,
  }
}

const fetchProvider = async (
  id: ProviderID,
  config: ProviderConfig | undefined,
  openCodeAuth: OpenCodeAuth,
  timeoutMs: number
): Promise<ProviderUsage> => {
  if (id === "codex") {
    return fetchCodexUsage(config, openCodeAuth, timeoutMs)
  }

  return fetchZaiUsage(config, openCodeAuth, timeoutMs)
}

const getProviderConfigs = (config: Required<UsageLimitsConfig>): Array<[ProviderID, ProviderConfig]> =>
  (["codex", "zai"] as const).flatMap((id) => {
    const provider = config.providers[id]
    if (provider?.enabled !== true) {
      return []
    }
    return [[id, provider]]
  })

const dotColor = (usedPercent: number | null, theme: TuiThemeCurrent): RGBA => {
  if (usedPercent === null) return theme.textMuted
  if (usedPercent >= 90) return theme.error
  if (usedPercent >= 70) return theme.warning
  return theme.success
}

const windowMainText = (window: UsageWindow): string => `${window.label}: ${formatPercent(window.usedPercent)}`

const bottomWindowMainText = (window: UsageWindow): string => `5h: ${formatPercent(window.usedPercent)}`

const windowResetText = (window: UsageWindow): string =>
  window.resetAfterSeconds === null ? "" : ` resets ${duration(window.resetAfterSeconds)}`

const UsageLimitsPanel = (props: { states: ProviderState[]; showErrors: boolean; theme: TuiThemeCurrent }) => (
  <Show when={props.states.some((state) => state.status !== "disabled")}>
    <box>
      <text fg={props.theme.text}>
        <b>Usage Limits</b>
      </text>
      <For each={props.states}>
        {(state) => (
          <Show when={state.status !== "disabled"}>
            <box>
              <text fg={props.theme.text}>
                {state.label}
                <Show when={state.status === "ready" && state.stale}> stale</Show>
              </text>
              <Show when={state.status === "loading"}>
                <text fg={props.theme.textMuted}>  loading...</text>
              </Show>
              <Show when={state.status === "ready"}>
                <For each={state.status === "ready" ? state.data.windows : []}>
                  {(window) => (
                    <box flexDirection="row" gap={1}>
                      <text flexShrink={0} fg={dotColor(window.usedPercent, props.theme)}>
                        •
                      </text>
                      <text fg={props.theme.text}>
                        {windowMainText(window)}
                        <span style={{ fg: props.theme.textMuted }}>{windowResetText(window)}</span>
                      </text>
                    </box>
                  )}
                </For>
              </Show>
              <Show when={state.status === "error" && props.showErrors}>
                <text fg={props.theme.error}>  {state.status === "error" ? state.message : "error"}</text>
              </Show>
            </box>
          </Show>
        )}
      </For>
    </box>
  </Show>
)

const getProviderFromMessage = (message: unknown): string | undefined => {
  if (!isRecord(message)) {
    return undefined
  }

  if (typeof message.providerID === "string") {
    return message.providerID
  }

  if (isRecord(message.model) && typeof message.model.providerID === "string") {
    return message.model.providerID
  }

  return undefined
}

const currentProviderID = (messages: readonly unknown[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const providerID = getProviderFromMessage(messages[index])
    if (providerID) {
      return providerID
    }
  }

  return undefined
}

const usageForProvider = (states: readonly ProviderState[], providerID: string | undefined): UsageWindow | null => {
  const usageID = providerID === "openai" ? "codex" : providerID === "zai-coding-plan" ? "zai" : null
  if (!usageID) {
    return null
  }

  const state = states.find((item) => item.id === usageID)
  const data = state?.status === "ready" ? state.data : state?.status === "error" ? state.previous : undefined
  if (!data) {
    return null
  }

  if (usageID === "zai") {
    return data.windows.find((window) => window.label === "tokens") ?? data.windows[0] ?? null
  }

  return data.windows.find((window) => window.label === "5h") ?? data.windows[0] ?? null
}

const BottomUsage = (props: { window: UsageWindow | null; theme: TuiThemeCurrent }) => (
  <Show when={props.window}>
    {(window) => (
      <text fg={props.theme.text}>
        {bottomWindowMainText(window())}
        <span style={{ fg: props.theme.textMuted }}>{windowResetText(window())}</span>
      </text>
    )}
  </Show>
)

const tui: TuiPlugin = async (api) => {
  const [states, setStates] = createSignal<ProviderState[]>([])
  const [showErrors, setShowErrors] = createSignal(true)
  let lastSuccess = new Map<ProviderID, ProviderUsage>()
  let refreshIntervalSeconds = 60

  const refresh = async () => {
    const config = await loadConfig()
    setShowErrors(config.showErrors)
    refreshIntervalSeconds = config.refreshIntervalSeconds

    if (!config.enabled) {
      setStates([])
      return
    }

    const providers = getProviderConfigs(config)
    const previous = new Map(states().map((state) => [state.id, state]))
    setStates(
      providers.map(([id, provider]) => {
        const label = provider.label ?? (id === "codex" ? "codex" : "ZAI")
        const current = previous.get(id)
        if (current?.status === "ready" || current?.status === "error") {
          return current
        }
        return { id, label, status: "loading" as const }
      })
    )

    const openCodeAuth = await loadOpenCodeAuth()
    const nextStates = await Promise.all(
      providers.map(async ([id, provider]): Promise<ProviderState> => {
        const label = provider.label ?? (id === "codex" ? "codex" : "ZAI")
        try {
          const data = await fetchProvider(id, provider, openCodeAuth, config.requestTimeoutMs)
          lastSuccess.set(id, data)
          return { data, id, label, stale: false, status: "ready" }
        } catch (error) {
          const message = error instanceof Error ? error.message : "usage unavailable"
          const previousData = lastSuccess.get(id)
          if (previousData) {
            return { id, label, message, previous: previousData, status: "error" }
          }
          return { id, label, message, status: "error" }
        }
      })
    )

    const staleAfterMs = config.refreshIntervalSeconds * 2 * 1000
    setStates(
      nextStates.map((state) => {
        if (state.status !== "ready") {
          return state
        }
        return { ...state, stale: Date.now() - state.data.capturedAt.getTime() > staleAfterMs }
      })
    )
  }

  await refresh()
  const timer = setInterval(() => {
    void refresh()
  }, Math.max(15, refreshIntervalSeconds) * 1000)

  api.lifecycle.onDispose(() => {
    clearInterval(timer)
    lastSuccess = new Map()
  })

  api.slots.register({
    order: 101,
    slots: {
      sidebar_content(ctx) {
        return <UsageLimitsPanel showErrors={showErrors()} states={states()} theme={ctx.theme.current} />
      },
      session_prompt_right(ctx, props) {
        const providerID = currentProviderID(api.state.session.messages(props.session_id))
        return <BottomUsage theme={ctx.theme.current} window={usageForProvider(states(), providerID)} />
      },
    },
  })
}

export default {
  id: "mynameistito.usage-limits",
  tui,
} satisfies TuiPluginModule & { id: string }
