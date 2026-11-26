import { create } from 'zustand'
import { ACCENTS, THEMES } from '@shared/constants/themes'
import type { CliStatus, ProviderId } from '@shared/types/ai'
import type { AppSettings, WorkspaceRecord } from '@shared/types/workspace'

export type ActiveNavTab = 'ai' | 'git' | 'governance' | 'usage' | 'settings'

interface SettingsState {
  settings: AppSettings
  workspaces: WorkspaceRecord[]
  cliStatuses: CliStatus[]
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
  addWorkspace: (folderPath?: string) => Promise<WorkspaceRecord | null>
  removeWorkspace: (id: string) => Promise<void>
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
    cliOverrides: {}
  },
  workspaces: [],
  cliStatuses: [],
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
