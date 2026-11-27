import { create } from 'zustand'
import type { AiSession } from '@shared/types/ai'

export type WorkspaceTabKind = 'session' | 'terminal' | 'git' | 'governance' | 'file' | 'preview'

export type InspectorPanelKind =
  | 'changes'
  | 'files'
  | 'file-viewer'
  | 'artifact'
  | 'preview'
  | 'tasks'
  | 'memory'
  | 'checkpoints'
  | 'skills'
  | 'terminal'

export interface InspectorArtifactPayload {
  language: string
  code: string
  title: string
  sourceTurnId?: string
}

export interface InspectorTabItem {
  id: string
  kind: InspectorPanelKind
  title: string
  pinned?: boolean
  closable?: boolean
  filePath?: string
  workspacePath?: string
  artifact?: InspectorArtifactPayload
  previewUrl?: string
  ptyId?: string
}

export interface TabInspectorLayout {
  open: boolean
  width: number
  expanded: boolean
  tabs: InspectorTabItem[]
  activeTabId: string | null
}

export interface WorkspaceTab {
  id: string
  kind: WorkspaceTabKind
  title: string
  pinned?: boolean
  sessionId?: string
  workspacePath?: string
  ptyId?: string
  filePath?: string
  previewUrl?: string
  inspector: TabInspectorLayout
}

export const INSPECTOR_PRESETS: Record<
  'default' | 'webdev' | 'review',
  { label: string; tabs: Array<{ id: string; kind: InspectorPanelKind; title: string; previewUrl?: string }> }
> = {
  default: {
    label: 'Mặc định (Diff + Bộ nhớ)',
    tabs: [
      { id: 'insp-changes', kind: 'changes', title: 'Diff & Commit' },
      { id: 'insp-memory', kind: 'memory', title: 'Bộ nhớ phiên' }
    ]
  },
  webdev: {
    label: 'Web Dev (Preview + Diff + Terminal)',
    tabs: [
      { id: 'insp-preview', kind: 'preview', title: 'Live Preview', previewUrl: 'http://localhost:5173' },
      { id: 'insp-changes', kind: 'changes', title: 'Diff & Commit' },
      { id: 'insp-terminal', kind: 'terminal', title: 'Terminal' }
    ]
  },
  review: {
    label: 'Review Code (Files + Diff + Checkpoints)',
    tabs: [
      { id: 'insp-files', kind: 'files', title: 'Files' },
      { id: 'insp-changes', kind: 'changes', title: 'Diff & Commit' },
      { id: 'insp-checkpoints', kind: 'checkpoints', title: 'Checkpoints' }
    ]
  }
}

export function createDefaultInspectorLayout(): TabInspectorLayout {
  return {
    open: true,
    width: 400,
    expanded: false,
    tabs: INSPECTOR_PRESETS.default.tabs.map((t) => ({ ...t })),
    activeTabId: INSPECTOR_PRESETS.default.tabs[0].id
  }
}

const SINGLETON_INSPECTOR_KINDS = new Set<InspectorPanelKind>([
  'changes',
  'files',
  'memory',
  'tasks',
  'checkpoints',
  'skills'
])

const STORAGE_KEY = 'aict:workspace-tabs:v1'

function makeUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const DEFAULT_SIDEBAR_WIDTH = 256
export function clampSidebarWidth(w: number): number {
  return Math.max(170, Math.min(460, Math.round(w)))
}

interface PersistedWorkspaceTabs {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  sidebarCollapsed: boolean
  sidebarWidth?: number
  navRailCollapsed?: boolean
}

function loadPersistedState(): Required<PersistedWorkspaceTabs> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { tabs: [], activeTabId: null, sidebarCollapsed: false, sidebarWidth: DEFAULT_SIDEBAR_WIDTH, navRailCollapsed: false }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tabs: [], activeTabId: null, sidebarCollapsed: false, sidebarWidth: DEFAULT_SIDEBAR_WIDTH, navRailCollapsed: false }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceTabs>
    const tabs: WorkspaceTab[] = (parsed.tabs ?? [])
      .filter((t) => t && t.kind !== 'terminal') // PTY không tồn tại qua lần khởi động mới
      .map((t) => ({
        ...t,
        ptyId: undefined,
        inspector: {
          open: t.inspector?.open ?? true,
          width: typeof t.inspector?.width === 'number' ? t.inspector.width : 400,
          expanded: Boolean(t.inspector?.expanded),
          tabs: (t.inspector?.tabs ?? createDefaultInspectorLayout().tabs).map((it) => ({
            ...it,
            ptyId: undefined
          })),
          activeTabId: t.inspector?.activeTabId ?? t.inspector?.tabs?.[0]?.id ?? null
        }
      }))
    const activeTabId = parsed.activeTabId && tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0]?.id ?? null
    const sidebarWidth =
      typeof parsed.sidebarWidth === 'number' ? clampSidebarWidth(parsed.sidebarWidth) : DEFAULT_SIDEBAR_WIDTH
    return {
      tabs,
      activeTabId,
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      sidebarWidth,
      navRailCollapsed: Boolean(parsed.navRailCollapsed)
    }
  } catch {
    return { tabs: [], activeTabId: null, sidebarCollapsed: false, sidebarWidth: DEFAULT_SIDEBAR_WIDTH, navRailCollapsed: false }
  }
}

let cachedSidebarWidth = DEFAULT_SIDEBAR_WIDTH
let cachedNavRailCollapsed = false

function persistState(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  sidebarCollapsed: boolean,
  sidebarWidth?: number,
  navRailCollapsed?: boolean
): void {
  if (typeof sidebarWidth === 'number') {
    cachedSidebarWidth = clampSidebarWidth(sidebarWidth)
  }
  if (typeof navRailCollapsed === 'boolean') {
    cachedNavRailCollapsed = navRailCollapsed
  }
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const sanitized: WorkspaceTab[] = tabs.map((t) => ({
      ...t,
      ptyId: undefined,
      inspector: {
        ...t.inspector,
        tabs: t.inspector.tabs.map((it) => ({
          ...it,
          ptyId: undefined,
          // Tránh phình localStorage bởi artifact code cực lớn
          artifact: it.artifact && it.artifact.code.length > 40_000 ? undefined : it.artifact
        }))
      }
    }))
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: sanitized,
        activeTabId,
        sidebarCollapsed,
        sidebarWidth: cachedSidebarWidth,
        navRailCollapsed: cachedNavRailCollapsed
      })
    )
  } catch {
    // ignore quota errors
  }
}

interface OpenToolTabOpts {
  kind: Exclude<WorkspaceTabKind, 'session'>
  title: string
  workspacePath?: string
  ptyId?: string
  filePath?: string
  previewUrl?: string
}

interface WorkspaceTabsState {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  closedTabs: WorkspaceTab[]
  sidebarCollapsed: boolean
  sidebarWidth: number
  navRailCollapsed: boolean

  openSessionTab: (session: AiSession) => WorkspaceTab
  syncSessions: (sessions: AiSession[]) => void
  openToolTab: (opts: OpenToolTabOpts) => WorkspaceTab
  setActiveTab: (tabId: string) => void
  closeTab: (tabId: string) => WorkspaceTab | null
  reopenLastClosedTab: () => WorkspaceTab | null
  closeOtherTabs: (tabId: string) => void
  closeTabsToRight: (tabId: string) => void
  togglePinTab: (tabId: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  updateWorkspaceTab: (tabId: string, patch: Partial<WorkspaceTab>) => void

  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  setNavRailCollapsed: (collapsed: boolean) => void
  toggleNavRail: () => void

  // Inspector actions (theo workspaceTabId hoặc activeTabId)
  openInspectorTab: (item: Omit<InspectorTabItem, 'id'> & { id?: string }, workspaceTabId?: string) => string | null
  closeInspectorTab: (inspTabId: string, workspaceTabId?: string) => void
  setActiveInspectorTab: (inspTabId: string, workspaceTabId?: string) => void
  reorderInspectorTabs: (fromIndex: number, toIndex: number, workspaceTabId?: string) => void
  toggleInspector: (workspaceTabId?: string) => void
  setInspectorOpen: (open: boolean, workspaceTabId?: string) => void
  setInspectorWidth: (width: number, workspaceTabId?: string) => void
  toggleInspectorExpanded: (workspaceTabId?: string) => void
  applyInspectorPreset: (preset: 'default' | 'webdev' | 'review', workspaceTabId?: string) => void
  updateInspectorTab: (inspTabId: string, patch: Partial<InspectorTabItem>, workspaceTabId?: string) => void

  resetForTest: () => void
}

const initialPersisted = loadPersistedState()
cachedSidebarWidth = initialPersisted.sidebarWidth
cachedNavRailCollapsed = initialPersisted.navRailCollapsed

function mapTargetTab(
  tabs: WorkspaceTab[],
  workspaceTabId: string | undefined,
  activeTabId: string | null,
  updater: (tab: WorkspaceTab) => WorkspaceTab
): WorkspaceTab[] {
  const targetId = workspaceTabId ?? activeTabId
  if (!targetId) return tabs
  return tabs.map((t) => (t.id === targetId ? updater(t) : t))
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set, get) => ({
  tabs: initialPersisted.tabs,
  activeTabId: initialPersisted.activeTabId,
  closedTabs: [],
  sidebarCollapsed: initialPersisted.sidebarCollapsed,
  sidebarWidth: initialPersisted.sidebarWidth,
  navRailCollapsed: initialPersisted.navRailCollapsed,

  openSessionTab: (session) => {
    const existing = get().tabs.find((t) => t.kind === 'session' && t.sessionId === session.id)
    if (existing) {
      const nextTabs =
        existing.title !== session.title
          ? get().tabs.map((t) => (t.id === existing.id ? { ...t, title: session.title } : t))
          : get().tabs
      set({ tabs: nextTabs, activeTabId: existing.id })
      persistState(nextTabs, existing.id, get().sidebarCollapsed)
      return existing
    }

    const created: WorkspaceTab = {
      id: `tab-sess-${session.id}`,
      kind: 'session',
      title: session.title,
      sessionId: session.id,
      workspacePath: session.worktreePath || session.workspacePath,
      inspector: createDefaultInspectorLayout()
    }
    const nextTabs = [...get().tabs, created]
    set({ tabs: nextTabs, activeTabId: created.id })
    persistState(nextTabs, created.id, get().sidebarCollapsed)
    return created
  },

  syncSessions: (sessions) => {
    const byId = new Map(sessions.map((s) => [s.id, s]))
    const currentTabs = get().tabs
    let changed = false
    const filtered: WorkspaceTab[] = []

    for (const tab of currentTabs) {
      if (tab.kind === 'session' && tab.sessionId) {
        const sess = byId.get(tab.sessionId)
        if (!sess) {
          changed = true
          continue
        }
        const nextTitle = sess.title
        const nextWs = sess.worktreePath || sess.workspacePath
        if (tab.title !== nextTitle || tab.workspacePath !== nextWs) {
          changed = true
          filtered.push({ ...tab, title: nextTitle, workspacePath: nextWs })
          continue
        }
      }
      filtered.push(tab)
    }

    if (!changed) return
    const curActive = get().activeTabId
    const nextActive = curActive && filtered.some((t) => t.id === curActive) ? curActive : filtered[0]?.id ?? null
    set({ tabs: filtered, activeTabId: nextActive })
    persistState(filtered, nextActive, get().sidebarCollapsed)
  },

  openToolTab: (opts) => {
    const tabs = get().tabs
    const existing = tabs.find((t) => {
      if (t.kind !== opts.kind) return false
      if (opts.kind === 'git' || opts.kind === 'governance') {
        return (t.workspacePath ?? '') === (opts.workspacePath ?? '')
      }
      if (opts.kind === 'file') {
        return t.workspacePath === opts.workspacePath && t.filePath === opts.filePath
      }
      if (opts.kind === 'terminal' && opts.ptyId) {
        return t.ptyId === opts.ptyId
      }
      if (opts.kind === 'preview' && opts.previewUrl) {
        return t.previewUrl === opts.previewUrl
      }
      return false
    })

    if (existing) {
      set({ activeTabId: existing.id })
      persistState(tabs, existing.id, get().sidebarCollapsed)
      return existing
    }

    const created: WorkspaceTab = {
      id: makeUid(`tab-${opts.kind}`),
      kind: opts.kind,
      title: opts.title,
      workspacePath: opts.workspacePath,
      ptyId: opts.ptyId,
      filePath: opts.filePath,
      previewUrl: opts.previewUrl,
      inspector: {
        open: false,
        width: 400,
        expanded: false,
        tabs: [],
        activeTabId: null
      }
    }
    const nextTabs = [...tabs, created]
    set({ tabs: nextTabs, activeTabId: created.id })
    persistState(nextTabs, created.id, get().sidebarCollapsed)
    return created
  },

  setActiveTab: (tabId) => {
    const { tabs, sidebarCollapsed } = get()
    if (!tabs.some((t) => t.id === tabId)) return
    set({ activeTabId: tabId })
    persistState(tabs, tabId, sidebarCollapsed)
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId, closedTabs, sidebarCollapsed } = get()
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return null
    const removed = tabs[idx]
    const nextTabs = tabs.filter((t) => t.id !== tabId)
    const nextActive =
      activeTabId === tabId
        ? nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null
        : activeTabId
    const nextClosed = [removed, ...closedTabs].slice(0, 15)
    set({ tabs: nextTabs, activeTabId: nextActive, closedTabs: nextClosed })
    persistState(nextTabs, nextActive, sidebarCollapsed)
    return removed
  },

  reopenLastClosedTab: () => {
    const { closedTabs, tabs, sidebarCollapsed } = get()
    if (closedTabs.length === 0) return null
    const [head, ...rest] = closedTabs
    const existing = tabs.find((t) => t.id === head.id)
    if (existing) {
      set({ activeTabId: existing.id, closedTabs: rest })
      persistState(tabs, existing.id, sidebarCollapsed)
      return existing
    }
    const restored: WorkspaceTab = {
      ...head,
      ptyId: head.kind === 'terminal' ? undefined : head.ptyId
    }
    const nextTabs = [...tabs, restored]
    set({ tabs: nextTabs, activeTabId: restored.id, closedTabs: rest })
    persistState(nextTabs, restored.id, sidebarCollapsed)
    return restored
  },

  closeOtherTabs: (tabId) => {
    const { tabs, closedTabs, sidebarCollapsed } = get()
    const target = tabs.find((t) => t.id === tabId)
    if (!target) return
    const nextTabs = tabs.filter((t) => t.id === tabId || t.pinned)
    const removed = tabs.filter((t) => t.id !== tabId && !t.pinned)
    set({
      tabs: nextTabs,
      activeTabId: tabId,
      closedTabs: [...removed.reverse(), ...closedTabs].slice(0, 15)
    })
    persistState(nextTabs, tabId, sidebarCollapsed)
  },

  closeTabsToRight: (tabId) => {
    const { tabs, activeTabId, closedTabs, sidebarCollapsed } = get()
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    const nextTabs = tabs.filter((t, i) => i <= idx || t.pinned)
    const removed = tabs.filter((t, i) => i > idx && !t.pinned)
    const nextActive = activeTabId && nextTabs.some((t) => t.id === activeTabId) ? activeTabId : tabId
    set({
      tabs: nextTabs,
      activeTabId: nextActive,
      closedTabs: [...removed.reverse(), ...closedTabs].slice(0, 15)
    })
    persistState(nextTabs, nextActive, sidebarCollapsed)
  },

  togglePinTab: (tabId) => {
    const { tabs, activeTabId, sidebarCollapsed } = get()
    const toggled = tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t))
    // Đưa tab ghim lên đầu, giữ nguyên thứ tự tương đối
    const pinned = toggled.filter((t) => t.pinned)
    const unpinned = toggled.filter((t) => !t.pinned)
    const nextTabs = [...pinned, ...unpinned]
    set({ tabs: nextTabs })
    persistState(nextTabs, activeTabId, sidebarCollapsed)
  },

  reorderTabs: (fromIndex, toIndex) => {
    const { tabs, activeTabId, sidebarCollapsed } = get()
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tabs.length || toIndex >= tabs.length) {
      return
    }
    const next = [...tabs]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    set({ tabs: next })
    persistState(next, activeTabId, sidebarCollapsed)
  },

  updateWorkspaceTab: (tabId, patch) => {
    const { tabs, activeTabId, sidebarCollapsed } = get()
    const next = tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
    set({ tabs: next })
    persistState(next, activeTabId, sidebarCollapsed)
  },

  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed })
    persistState(get().tabs, get().activeTabId, sidebarCollapsed, get().sidebarWidth)
  },

  setSidebarWidth: (width) => {
    const next = clampSidebarWidth(width)
    set({ sidebarWidth: next })
    persistState(get().tabs, get().activeTabId, get().sidebarCollapsed, next)
  },

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    set({ sidebarCollapsed: next })
    persistState(get().tabs, get().activeTabId, next, get().sidebarWidth)
  },

  setNavRailCollapsed: (navRailCollapsed) => {
    set({ navRailCollapsed })
    persistState(get().tabs, get().activeTabId, get().sidebarCollapsed, get().sidebarWidth, navRailCollapsed)
  },

  toggleNavRail: () => {
    const next = !get().navRailCollapsed
    set({ navRailCollapsed: next })
    persistState(get().tabs, get().activeTabId, get().sidebarCollapsed, get().sidebarWidth, next)
  },

  openInspectorTab: (item, workspaceTabId) => {
    let createdOrFocusedId: string | null = null
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => {
      const insp = tab.inspector
      // 1. Singleton kinds
      if (SINGLETON_INSPECTOR_KINDS.has(item.kind)) {
        const hit = insp.tabs.find((t) => t.kind === item.kind)
        if (hit) {
          createdOrFocusedId = hit.id
          return { ...tab, inspector: { ...insp, open: true, activeTabId: hit.id } }
        }
      }
      // 2. File-viewer dedupe theo workspacePath + filePath
      if (item.kind === 'file-viewer' && item.filePath) {
        const hit = insp.tabs.find(
          (t) => t.kind === 'file-viewer' && t.filePath === item.filePath && t.workspacePath === item.workspacePath
        )
        if (hit) {
          createdOrFocusedId = hit.id
          return { ...tab, inspector: { ...insp, open: true, activeTabId: hit.id } }
        }
      }
      // 3. Artifact dedupe nếu trùng sourceTurnId + title + code
      if (item.kind === 'artifact' && item.artifact) {
        const hit = insp.tabs.find(
          (t) =>
            t.kind === 'artifact' &&
            t.artifact?.sourceTurnId === item.artifact?.sourceTurnId &&
            t.artifact?.code === item.artifact?.code
        )
        if (hit) {
          createdOrFocusedId = hit.id
          return { ...tab, inspector: { ...insp, open: true, activeTabId: hit.id } }
        }
      }

      const newId = item.id || makeUid(`insp-${item.kind}`)
      createdOrFocusedId = newId
      const newTab: InspectorTabItem = {
        closable: true,
        ...item,
        id: newId
      }
      return {
        ...tab,
        inspector: {
          ...insp,
          open: true,
          tabs: [...insp.tabs, newTab],
          activeTabId: newId
        }
      }
    })
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
    return createdOrFocusedId
  },

  closeInspectorTab: (inspTabId, workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => {
      const insp = tab.inspector
      const idx = insp.tabs.findIndex((t) => t.id === inspTabId)
      if (idx === -1) return tab
      const remaining = insp.tabs.filter((t) => t.id !== inspTabId)
      const nextActive =
        insp.activeTabId === inspTabId
          ? remaining[Math.min(idx, remaining.length - 1)]?.id ?? null
          : insp.activeTabId
      return {
        ...tab,
        inspector: {
          ...insp,
          tabs: remaining,
          activeTabId: nextActive,
          open: remaining.length > 0 ? insp.open : false
        }
      }
    })
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  setActiveInspectorTab: (inspTabId, workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => ({
      ...tab,
      inspector: { ...tab.inspector, open: true, activeTabId: inspTabId }
    }))
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  reorderInspectorTabs: (fromIndex, toIndex, workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => {
      const insp = tab.inspector
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= insp.tabs.length ||
        toIndex >= insp.tabs.length
      ) {
        return tab
      }
      const next = [...insp.tabs]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return { ...tab, inspector: { ...insp, tabs: next } }
    })
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  toggleInspector: (workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => {
      const insp = tab.inspector
      if (!insp.open && insp.tabs.length === 0) {
        const def = createDefaultInspectorLayout()
        return { ...tab, inspector: { ...def, width: insp.width, expanded: insp.expanded, open: true } }
      }
      return { ...tab, inspector: { ...insp, open: !insp.open } }
    })
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  setInspectorOpen: (open, workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => {
      const insp = tab.inspector
      if (open && insp.tabs.length === 0) {
        const def = createDefaultInspectorLayout()
        return { ...tab, inspector: { ...def, width: insp.width, expanded: insp.expanded, open: true } }
      }
      return { ...tab, inspector: { ...insp, open } }
    })
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  setInspectorWidth: (width, workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => ({
      ...tab,
      inspector: { ...tab.inspector, width, expanded: false }
    }))
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  toggleInspectorExpanded: (workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => ({
      ...tab,
      inspector: { ...tab.inspector, expanded: !tab.inspector.expanded, open: true }
    }))
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  applyInspectorPreset: (preset, workspaceTabId) => {
    const cfg = INSPECTOR_PRESETS[preset]
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => {
      const tabs: InspectorTabItem[] = cfg.tabs.map((t) => ({
        ...t,
        workspacePath: tab.workspacePath
      }))
      return {
        ...tab,
        inspector: {
          ...tab.inspector,
          open: true,
          tabs,
          activeTabId: tabs[0]?.id ?? null
        }
      }
    })
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  updateInspectorTab: (inspTabId, patch, workspaceTabId) => {
    const nextTabs = mapTargetTab(get().tabs, workspaceTabId, get().activeTabId, (tab) => ({
      ...tab,
      inspector: {
        ...tab.inspector,
        tabs: tab.inspector.tabs.map((it) => (it.id === inspTabId ? { ...it, ...patch } : it))
      }
    }))
    set({ tabs: nextTabs })
    persistState(nextTabs, get().activeTabId, get().sidebarCollapsed)
  },

  resetForTest: () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY)
    }
    cachedSidebarWidth = DEFAULT_SIDEBAR_WIDTH
    cachedNavRailCollapsed = false
    set({
      tabs: [],
      activeTabId: null,
      closedTabs: [],
      sidebarCollapsed: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      navRailCollapsed: false
    })
  }
}))
