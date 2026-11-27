import { create } from 'zustand'
import { ACCENTS, THEMES } from '@shared/constants/themes'
import type { CliStatus, OrchestratorConfig, ProviderId, ProviderQuotaStatus } from '@shared/types/ai'
import type { AppSettings, WorkspaceRecord } from '@shared/types/workspace'

export type ActiveNavTab = 'ai' | 'apps' | 'git' | 'database' | 'governance' | 'usage' | 'settings'

interface SettingsState {
  settings: AppSettings
  workspaces: WorkspaceRecord[]
  cliStatuses: CliStatus[]
  providerQuotas: ProviderQuotaStatus[]
  quotasLoading: boolean
  agyQuotaCap5h: number
  orchestratorConfig: OrchestratorConfig
  activeTab: ActiveNavTab
  commandPaletteOpen: boolean
  toastMessage: { text: string; kind: 'info' | 'ok' | 'err' } | null
  loaded: boolean

  init: () => Promise<void>
  setActiveTab: (tab: ActiveNavTab) => void
  setCommandPaletteOpen: (open: boolean) => void
  showToast: (text: string, kind?: 'info' | 'ok' | 'err') => void
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshCliStatuses: (force?: boolean) => Promise<void>
  refreshProviderQuotas: (force?: boolean) => Promise<void>
  setAgyQuotaCap5h: (cap: number) => void
  updateOrchestratorConfig: (patch: Partial<OrchestratorConfig>) => void
  addWorkspace: (folderPath?: string) => Promise<WorkspaceRecord | null>
  removeWorkspace: (id: string) => Promise<void>
}

const AGY_CAP_STORAGE_KEY = 'aict:agy-quota-cap-5h'
const ORCHESTRATOR_STORAGE_KEY = 'aict:orchestrator-config:v1'
const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  enabled: false,
  plannerProvider: 'agy',
  plannerModel: 'gemini-4-neon-high',
  executorProvider: 'agy',
  executorModel: 'gemini-3.8-flash-high',
  autoExecute: true,
  verifyAfterExecute: false
}

function loadAgyCap(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 1_000_000
  const raw = Number(window.localStorage.getItem(AGY_CAP_STORAGE_KEY))
  return Number.isFinite(raw) && raw >= 100_000 ? raw : 1_000_000
}

function loadOrchestratorConfig(): OrchestratorConfig {
  if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_ORCHESTRATOR_CONFIG }
  try {
    const raw = window.localStorage.getItem(ORCHESTRATOR_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_ORCHESTRATOR_CONFIG }
    const parsed = JSON.parse(raw) as Partial<OrchestratorConfig>
    return {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      ...parsed
    }
  } catch {
    return { ...DEFAULT_ORCHESTRATOR_CONFIG }
  }
}

export function applyThemeCss(settings: AppSettings): void {
  const t = THEMES[settings.theme] ?? THEMES.dark
  const a = ACCENTS[settings.accent] ?? ACCENTS.indigo
  const root = document.documentElement.style
  root.setProperty('--bg', t.bg)
  root.setProperty('--surface', t.surface)
  root.setProperty('--surface-elevated', t.surfaceElevated)
  root.setProperty('--header', t.header)
  root.setProperty('--border', t.border)
  root.setProperty('--text', t.text)
  root.setProperty('--muted', t.muted)
  root.setProperty('--sel', t.sel)
  root.setProperty('--hover', t.hover)
  root.setProperty('--err', t.err)
  root.setProperty('--err-bg', t.errBg)
  root.setProperty('--warn', t.warn)
  root.setProperty('--ok', t.ok)
  root.setProperty('--info', t.info)
  root.setProperty('--accent', a.color)
  root.setProperty('--accent-hover', a.hover)
  root.setProperty('--accent-soft', a.soft)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    theme: 'dark',
    accent: 'indigo',
    defaultProvider: 'claude',
    defaultMode: 'edit',
    claudeAuthMode: 'env',
    notifications: true,
    autoCompactEnabled: true,
    autoCompactThreshold: 80,
    cliOverrides: {}
  },
  workspaces: [],
  cliStatuses: [],
  providerQuotas: [],
  quotasLoading: false,
  agyQuotaCap5h: loadAgyCap(),
  orchestratorConfig: loadOrchestratorConfig(),
  activeTab: 'ai',
  commandPaletteOpen: false,
  toastMessage: null,
  loaded: false,

  init: async () => {
    const [settings, workspaces, cliStatuses] = await Promise.all([
      window.workspaceApi.getSettings(),
      window.workspaceApi.listWorkspaces(),
      window.workspaceApi.getCliStatuses(false)
    ])
    applyThemeCss(settings)
    set({ settings, workspaces, cliStatuses, loaded: true })
    void get().refreshProviderQuotas(false)
  },

  setActiveTab: (activeTab) => set({ activeTab }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  showToast: (text, kind = 'info') => {
    set({ toastMessage: { text, kind } })
    setTimeout(() => {
      if (get().toastMessage?.text === text) {
        set({ toastMessage: null })
      }
    }, 3500)
  },

  updateSettings: async (patch) => {
    const updated = await window.workspaceApi.updateSettings(patch)
    applyThemeCss(updated)
    set({ settings: updated })
  },

  refreshCliStatuses: async (force = true) => {
    const cliStatuses = await window.workspaceApi.getCliStatuses(force)
    set({ cliStatuses })
  },

  refreshProviderQuotas: async (force = false) => {
    set({ quotasLoading: true })
    try {
      const cap = get().agyQuotaCap5h
      const providerQuotas = await window.workspaceApi.getProviderQuotas(force, cap)
      set({ providerQuotas })
    } catch {
      // ignore background quota refresh failure
    } finally {
      set({ quotasLoading: false })
    }
  },

  setAgyQuotaCap5h: (cap) => {
    const valid = Math.max(100_000, Math.round(cap))
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AGY_CAP_STORAGE_KEY, String(valid))
    }
    set({ agyQuotaCap5h: valid })
    void get().refreshProviderQuotas(true)
  },

  updateOrchestratorConfig: (patch) => {
    const next: OrchestratorConfig = {
      ...get().orchestratorConfig,
      ...patch
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ORCHESTRATOR_STORAGE_KEY, JSON.stringify(next))
    }
    set({ orchestratorConfig: next })
  },

  addWorkspace: async (folderPath) => {
    const target = folderPath || (await window.workspaceApi.pickFolder())
    if (!target) return null
    const rec = await window.workspaceApi.addWorkspace(target)
    const workspaces = await window.workspaceApi.listWorkspaces()
    set({ workspaces })
    return rec
  },

  removeWorkspace: async (id) => {
    await window.workspaceApi.removeWorkspace(id)
    const workspaces = await window.workspaceApi.listWorkspaces()
    set({ workspaces })
  }
}))

export function getModelsForProvider(statuses: CliStatus[], provider: ProviderId): string[] {
  return statuses.find((s) => s.provider === provider)?.models ?? []
}

export function getDefaultModelForProvider(
  statuses: CliStatus[],
  provider: ProviderId
): { model: string | null; source: string | null } {
  const hit = statuses.find((s) => s.provider === provider)
  return {
    model: hit?.defaultModel ?? null,
    source: hit?.defaultModelSource ?? null
  }
}
