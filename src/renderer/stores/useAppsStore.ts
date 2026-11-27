import { create } from 'zustand'
import type { AppsBatchAction, AppsCatalogConfig, DevAppRuntime } from '@shared/types/apps'

export type AppsTypeFilter = 'ALL' | 'backend' | 'bff' | 'frontend' | 'tool' | 'storybook' | 'running'
export type AppsSortCol = 'group' | 'name' | 'type' | 'port' | 'status' | 'pid' | 'cpu' | 'ram' | 'health'

export interface AppPendingEntry {
  act: AppsBatchAction
  since: number
  doneAt: number | null
  isTool: boolean
}

let appsRefreshSeq = 0

interface AppsState {
  apps: DevAppRuntime[]
  config: AppsCatalogConfig | null
  iisInstalled: boolean
  loading: boolean
  batchBusy: boolean
  selectedIds: string[]
  lastClickedId: string | null
  search: string
  typeFilter: AppsTypeFilter
  sortCol: AppsSortCol
  sortDesc: boolean
  pendingMap: Record<string, AppPendingEntry>
  failedMap: Record<string, string>
  logAppId: string | null
  logContent: string
  logLoading: boolean

  initApps: () => Promise<void>
  loadConfig: () => Promise<void>
  refreshApps: (statsOverride?: boolean, silent?: boolean) => Promise<void>
  setSearch: (q: string) => void
  setTypeFilter: (f: AppsTypeFilter) => void
  setSort: (col: AppsSortCol) => void
  setSelection: (ids: string[]) => void
  selectRange: (orderedIds: string[], targetId: string) => void
  toggleSelectRow: (id: string, multi: boolean) => void
  clearFailed: (ids: string[]) => void
  markPending: (ids: string[], act: AppsBatchAction, done?: boolean) => void
  clearPending: (ids: string[]) => void
  setFailed: (id: string, reason: string) => void
  setBatchBusy: (busy: boolean) => void
  openLog: (appId: string) => Promise<void>
  refreshLog: () => Promise<void>
  clearLog: () => Promise<void>
  closeLog: () => void
}

export const useAppsStore = create<AppsState>((set, get) => ({
  apps: [],
  config: null,
  iisInstalled: false,
  loading: false,
  batchBusy: false,
  selectedIds: [],
  lastClickedId: null,
  search: '',
  typeFilter: 'ALL',
  sortCol: 'status',
  sortDesc: false,
  pendingMap: {},
  failedMap: {},
  logAppId: null,
  logContent: '',
  logLoading: false,

  initApps: async () => {
    await Promise.all([get().loadConfig(), get().refreshApps()])
  },

  loadConfig: async () => {
    const [config, iisInstalled] = await Promise.all([
      window.workspaceApi.getAppsConfig(),
      window.workspaceApi.isIisInstalled()
    ])
    set({ config, iisInstalled })
  },

  refreshApps: async (statsOverride, silent = false) => {
    const seq = ++appsRefreshSeq
    if (!silent) set({ loading: true })
    try {
      const wantStats = statsOverride ?? get().config?.showStats ?? false
      const apps = await window.workspaceApi.listDevApps(wantStats)
      if (seq !== appsRefreshSeq) return

      const now = Date.now()
      const nextPending = { ...get().pendingMap }
      const nextFailed = { ...get().failedMap }

      for (const [id, pd] of Object.entries(nextPending)) {
        if (!pd.doneAt) continue
        const app = apps.find((x) => x.id === id)
        if (!app) {
          delete nextPending[id]
          continue
        }
        if (pd.act === 'stop') {
          if (!app.running) {
            delete nextPending[id]
          } else if (now - pd.doneAt > 30_000) {
            delete nextPending[id]
            nextFailed[id] = `Không thể dừng ${app.name} sau 30s.`
          }
          continue
        }
        if (pd.isTool) {
          if (app.running || now - pd.doneAt > 5_000) {
            delete nextPending[id]
          }
          continue
        }
        if (app.running) {
          delete nextPending[id]
          delete nextFailed[id]
          continue
        }
        if (now - pd.doneAt > 180_000) {
          delete nextPending[id]
          if (!app.running) {
            nextFailed[id] = `Sau 180s chưa thấy ${app.name} mở port ${app.port} — xem Log.`
          }
        }
      }

      set({
        apps,
        pendingMap: nextPending,
        failedMap: nextFailed,
        ...(silent ? {} : { loading: false })
      })
    } catch {
      if (seq === appsRefreshSeq && !silent) set({ loading: false })
    }
  },

  setSearch: (search) => set({ search }),
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setSort: (col) =>
    set((s) =>
      s.sortCol === col ? { sortDesc: !s.sortDesc } : { sortCol: col, sortDesc: false }
    ),
  setSelection: (selectedIds) =>
    set({ selectedIds, lastClickedId: selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null }),
  selectRange: (orderedIds, targetId) =>
    set((s) => {
      const anchor = s.lastClickedId
      const aIdx = anchor ? orderedIds.indexOf(anchor) : -1
      const tIdx = orderedIds.indexOf(targetId)
      if (aIdx < 0 || tIdx < 0) {
        return { selectedIds: [targetId], lastClickedId: targetId }
      }
      const lo = Math.min(aIdx, tIdx)
      const hi = Math.max(aIdx, tIdx)
      return { selectedIds: orderedIds.slice(lo, hi + 1), lastClickedId: targetId }
    }),
  toggleSelectRow: (id, multi) =>
    set((s) => {
      if (!multi) return { selectedIds: [id], lastClickedId: id }
      const exists = s.selectedIds.includes(id)
      return {
        selectedIds: exists ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
        lastClickedId: id
      }
    }),
  clearFailed: (ids) =>
    set((s) => {
      const next = { ...s.failedMap }
      for (const id of ids) delete next[id]
      return { failedMap: next }
    }),
  markPending: (ids, act, done = false) =>
    set((s) => {
      const now = Date.now()
      const next = { ...s.pendingMap }
      for (const id of ids) {
        const app = s.apps.find((a) => a.id === id)
        if (done) {
          if (next[id]) next[id] = { ...next[id], doneAt: now }
        } else {
          next[id] = { act, since: now, doneAt: null, isTool: Boolean(app && !app.port && !app.iis) }
        }
      }
      return { pendingMap: next }
    }),
  clearPending: (ids) =>
    set((s) => {
      const next = { ...s.pendingMap }
      for (const id of ids) delete next[id]
      return { pendingMap: next }
    }),
  setFailed: (id, reason) => set((s) => ({ failedMap: { ...s.failedMap, [id]: reason } })),
  setBatchBusy: (batchBusy) => set({ batchBusy }),

  openLog: async (appId) => {
    set({ logAppId: appId, logLoading: true })
    try {
      const logContent = await window.workspaceApi.getDevAppLog(appId, 400)
      if (get().logAppId === appId) {
        set({ logContent, logLoading: false })
      }
    } catch (err) {
      set({
        logContent: err instanceof Error ? err.message : 'Không đọc được file log.',
        logLoading: false
      })
    }
  },

  refreshLog: async () => {
    const id = get().logAppId
    if (!id) return
    try {
      const logContent = await window.workspaceApi.getDevAppLog(id, 400)
      if (get().logAppId === id) set({ logContent })
    } catch {
      // ignore poll error
    }
  },

  clearLog: async () => {
    const id = get().logAppId
    if (!id) return
    await window.workspaceApi.clearDevAppLog(id)
    set({ logContent: '(Đã xóa log.)' })
  },

  closeLog: () => set({ logAppId: null, logContent: '' })
}))
