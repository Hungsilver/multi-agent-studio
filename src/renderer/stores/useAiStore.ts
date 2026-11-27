import { create } from 'zustand'
import type {
  AiAttachment,
  AiSession,
  AiTurn,
  CompactContextResult,
  EffortLevel,
  NormalizedAgentEvent,
  OrchestratorConfig,
  PermissionMode,
  ProviderId,
  ProviderSyncState,
  SessionMemory
} from '@shared/types/ai'
import type { CreateSessionRequest } from '@shared/types/ipc'
import {
  addSplitPaneId,
  clampSplitRatio,
  MAX_SPLIT_PANES,
  removeSplitPaneId
} from '@shared/utils/split-panes'
import { applySessionStatusToTurns, applyStreamEventToTurns } from '@shared/utils/turn-state'
import { useWorkspaceTabsStore, type InspectorPanelKind } from './useWorkspaceTabsStore'

export type WorkspaceViewMode = 'chat' | 'split' | 'terminal'
export type InspectorTab = 'changes' | 'memory' | 'skills'

export interface SessionDetailData {
  session: AiSession
  turns: AiTurn[]
  memory: SessionMemory
  providerStates: ProviderSyncState[]
}

export interface SessionCustomTask {
  id: string
  text: string
  done: boolean
  createdAt: string
}

const TASKS_STORAGE_KEY = 'aict:session-tasks:v1'
const SPLIT_STORAGE_KEY = 'aict:split-panes:v1'

interface PersistedSplitPanes {
  paneSessionIds: string[]
  focusedPaneIdx: number
  splitRatio: number
}

function loadSplitPanes(): PersistedSplitPanes {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { paneSessionIds: [], focusedPaneIdx: 0, splitRatio: 0.5 }
  }
  try {
    const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY)
    if (!raw) return { paneSessionIds: [], focusedPaneIdx: 0, splitRatio: 0.5 }
    const parsed = JSON.parse(raw) as Partial<PersistedSplitPanes>
    const paneSessionIds = Array.isArray(parsed.paneSessionIds)
      ? parsed.paneSessionIds.filter((x): x is string => typeof x === 'string' && Boolean(x)).slice(0, MAX_SPLIT_PANES)
      : []
    const focusedPaneIdx =
      typeof parsed.focusedPaneIdx === 'number'
        ? Math.max(0, Math.min(paneSessionIds.length - 1, parsed.focusedPaneIdx))
        : 0
    const splitRatio =
      typeof parsed.splitRatio === 'number'
        ? Math.max(0.25, Math.min(0.75, parsed.splitRatio))
        : 0.5
    return { paneSessionIds, focusedPaneIdx, splitRatio }
  } catch {
    return { paneSessionIds: [], focusedPaneIdx: 0, splitRatio: 0.5 }
  }
}

function saveSplitPanes(data: PersistedSplitPanes): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

function loadCustomTasks(): Record<string, SessionCustomTask[]> {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, SessionCustomTask[]>) : {}
  } catch {
    return {}
  }
}

function saveCustomTasks(data: Record<string, SessionCustomTask[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

// ---- Gộp (batch) stream event: mỗi delta không còn tạo lại toàn bộ mảng turns ----
interface QueuedEvent {
  sessionId: string
  turnId: string
  event: NormalizedAgentEvent
}
let eventQueue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushHandler: (() => void) | null = null
let selectSeq = 0
const STREAM_FLUSH_MS = 40

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushHandler?.()
  }, STREAM_FLUSH_MS)
}

/** Snapshot từ DB đã bao gồm mọi event đến trước nó → bỏ event đang chờ của phiên đó để khỏi áp trùng. */
async function fetchDetail(sessionId: string): Promise<SessionDetailData> {
  const detail = await window.workspaceApi.getSessionDetail(sessionId)
  eventQueue = eventQueue.filter((q) => q.sessionId !== sessionId)
  return detail
}

interface AiState {
  sessions: AiSession[]
  activeSessionId: string | null
  activeDetail: SessionDetailData | null
  detailsBySessionId: Record<string, SessionDetailData>
  paneSessionIds: string[]
  focusedPaneIdx: number
  splitRatio: number
  unreadSessionIds: Record<string, boolean>
  customTasksBySession: Record<string, SessionCustomTask[]>
  viewMode: WorkspaceViewMode
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  selectedTurnForDiff: string | null
  draftBySession: Record<string, string>

  loadSessions: () => Promise<void>
  ensureSessionDetail: (sessionId: string) => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  focusPane: (idx: number) => Promise<void>
  openSessionInSplitPane: (sessionId: string) => Promise<void>
  closeSplitPane: (idx: number) => Promise<void>
  setSplitRatio: (ratio: number) => void
  createSession: (req: CreateSessionRequest, opts?: { openInSplitPane?: boolean }) => Promise<AiSession>
  deleteSession: (sessionId: string) => Promise<void>
  forkSession: (sessionId: string, upToTurnIndex?: number) => Promise<AiSession>
  updateSessionMeta: (
    sessionId: string,
    patch: Partial<Pick<AiSession, 'title' | 'model' | 'effort' | 'permissionMode' | 'pinned'>>
  ) => Promise<void>
  switchProvider: (sessionId: string, provider: ProviderId, model?: string) => Promise<number>
  sendPrompt: (params: {
    sessionId: string
    prompt: string
    provider?: ProviderId
    model?: string
    effort?: EffortLevel
    permissionMode?: PermissionMode
    attachments?: AiAttachment[]
    orchestrator?: OrchestratorConfig
  }) => Promise<{ turnId: string } | void>
  stopRun: (sessionId: string) => Promise<void>
  updateMemory: (sessionId: string, patch: Partial<Omit<SessionMemory, 'sessionId' | 'updatedAt'>>) => Promise<void>
  compactMemory: (sessionId: string) => Promise<void>
  compactSessionContext: (sessionId: string) => Promise<CompactContextResult>
  importClaudeTranscript: (sessionId: string) => Promise<void>

  setViewMode: (mode: WorkspaceViewMode) => void
  setInspectorOpen: (open: boolean) => void
  setInspectorTab: (tab: InspectorPanelKind) => void
  setSelectedTurnForDiff: (turnId: string | null) => void
  setDraft: (sessionId: string, text: string) => void
  appendToDraft: (sessionId: string, snippet: string) => void
  clearUnread: (sessionId: string) => void

  addSessionTask: (sessionId: string, text: string) => void
  toggleSessionTask: (sessionId: string, taskId: string) => void
  deleteSessionTask: (sessionId: string, taskId: string) => void

  handleStreamEvent: (sessionId: string, turnId: string, event: NormalizedAgentEvent) => void
  handleSessionStatus: (sessionId: string, status: 'idle' | 'running' | 'error') => void
}

const INSPECTOR_KIND_TITLES: Record<InspectorPanelKind, string> = {
  changes: 'Diff & Commit',
  files: 'Files',
  'file-viewer': 'File',
  artifact: 'Artifact',
  preview: 'Live Preview',
  tasks: 'Tasks & Plan',
  memory: 'Bộ nhớ phiên',
  checkpoints: 'Checkpoints',
  skills: 'Skills',
  terminal: 'Terminal'
}

export const useAiStore = create<AiState>((set, get) => {
  const initialSplit = loadSplitPanes()

  const flushQueuedEvents = (): void => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    const batch = eventQueue
    eventQueue = []
    if (batch.length === 0) return
    const missing = new Set<string>()
    set((s) => {
      const details = { ...s.detailsBySessionId }
      let activeDetail = s.activeDetail
      let changed = false
      for (const q of batch) {
        const target = details[q.sessionId] ?? (activeDetail?.session.id === q.sessionId ? activeDetail : null)
        if (!target) continue
        if (!target.turns.some((t) => t.id === q.turnId)) missing.add(q.sessionId)
        const turns = applyStreamEventToTurns(target.turns, q.turnId, q.event)
        const session =
          q.event.type === 'session.init'
            ? { ...target.session, providerSessionId: q.event.providerSessionId }
            : target.session
        const updated: SessionDetailData = { ...target, session, turns }
        details[q.sessionId] = updated
        if (activeDetail?.session.id === q.sessionId) activeDetail = updated
        changed = true
      }
      return changed ? { detailsBySessionId: details, activeDetail } : s
    })
    missing.forEach((id) => void get().ensureSessionDetail(id))
  }
  flushHandler = flushQueuedEvents

  return {
  sessions: [],
  activeSessionId: null,
  activeDetail: null,
  detailsBySessionId: {},
  paneSessionIds: initialSplit.paneSessionIds,
  focusedPaneIdx: initialSplit.focusedPaneIdx,
  splitRatio: initialSplit.splitRatio,
  unreadSessionIds: {},
  customTasksBySession: loadCustomTasks(),
  viewMode: 'chat',
  inspectorOpen: true,
  inspectorTab: 'changes',
  selectedTurnForDiff: null,
  draftBySession: {},

  loadSessions: async () => {
    const sessions = await window.workspaceApi.listSessions()
    const validIds = new Set(sessions.map((s) => s.id))
    let paneIds = Array.from(new Set(get().paneSessionIds.filter((id) => validIds.has(id))))
    let focusedIdx = Math.max(0, Math.min(Math.max(0, paneIds.length - 1), get().focusedPaneIdx))

    const tabsStore = useWorkspaceTabsStore.getState()
    tabsStore.syncSessions(sessions)

    if (paneIds.length === 0) {
      const currentId = get().activeSessionId
      const fallback =
        (currentId && validIds.has(currentId) ? sessions.find((s) => s.id === currentId) : null) ?? sessions[0]
      if (fallback) {
        paneIds = [fallback.id]
        focusedIdx = 0
      }
    }

    set({ sessions, paneSessionIds: paneIds, focusedPaneIdx: focusedIdx })
    saveSplitPanes({ paneSessionIds: paneIds, focusedPaneIdx: focusedIdx, splitRatio: get().splitRatio })

    const targetId = paneIds[focusedIdx] ?? paneIds[0]
    if (targetId) {
      const targetSess = sessions.find((s) => s.id === targetId)
      if (targetSess) tabsStore.openSessionTab(targetSess)
      await Promise.all(paneIds.map((id) => get().ensureSessionDetail(id)))
      await get().focusPane(focusedIdx)
    }
  },

  ensureSessionDetail: async (sessionId) => {
    try {
      const detail = await fetchDetail(sessionId)
      set((s) => ({
        detailsBySessionId: { ...s.detailsBySessionId, [sessionId]: detail },
        ...(s.activeSessionId === sessionId ? { activeDetail: detail } : {})
      }))
    } catch (err) {
      // Phiên đã bị xóa / lỗi IPC: không làm sập luồng khởi động hay chuyển phiên
      console.warn('ensureSessionDetail failed:', sessionId, err)
    }
  },

  selectSession: async (sessionId) => {
    const token = ++selectSeq
    const existingPaneIdx = get().paneSessionIds.indexOf(sessionId)
    if (existingPaneIdx >= 0) {
      await get().focusPane(existingPaneIdx)
      return
    }

    const curPanes = [...get().paneSessionIds]
    let focusedIdx = Math.max(0, Math.min(Math.max(0, curPanes.length - 1), get().focusedPaneIdx))
    if (curPanes.length === 0) {
      curPanes.push(sessionId)
      focusedIdx = 0
    } else {
      curPanes[focusedIdx] = sessionId
    }

    set({ paneSessionIds: curPanes, focusedPaneIdx: focusedIdx })
    saveSplitPanes({ paneSessionIds: curPanes, focusedPaneIdx: focusedIdx, splitRatio: get().splitRatio })

    const sess = get().sessions.find((s) => s.id === sessionId)
    if (sess) {
      useWorkspaceTabsStore.getState().openSessionTab(sess)
    }

    const cached = get().detailsBySessionId[sessionId]
    if (cached) {
      set((s) => {
        const nextUnread = { ...s.unreadSessionIds }
        delete nextUnread[sessionId]
        return {
          activeSessionId: sessionId,
          activeDetail: cached,
          unreadSessionIds: nextUnread,
          selectedTurnForDiff: null
        }
      })
    }

    let detail: SessionDetailData
    try {
      detail = await fetchDetail(sessionId)
    } catch (err) {
      console.warn('selectSession: không nạp được chi tiết phiên', sessionId, err)
      return
    }
    set((s) => {
      const nextUnread = { ...s.unreadSessionIds }
      delete nextUnread[sessionId]
      // Chỉ lượt chọn phiên mới nhất được quyền đổi phiên đang active (tránh phản hồi cũ về muộn ghi đè)
      const isStillCurrent = token === selectSeq
      return {
        detailsBySessionId: { ...s.detailsBySessionId, [sessionId]: detail },
        unreadSessionIds: nextUnread,
        ...(isStillCurrent
          ? {
              activeSessionId: sessionId,
              activeDetail: detail,
              ...(cached ? {} : { selectedTurnForDiff: null })
            }
          : {})
      }
    })
  },

  focusPane: async (idx) => {
    const panes = get().paneSessionIds
    if (panes.length === 0) return
    selectSeq++
    const clamped = Math.max(0, Math.min(panes.length - 1, idx))
    const sessionId = panes[clamped]
    set({ focusedPaneIdx: clamped })
    saveSplitPanes({ paneSessionIds: panes, focusedPaneIdx: clamped, splitRatio: get().splitRatio })

    const sess = get().sessions.find((s) => s.id === sessionId)
    if (sess) {
      useWorkspaceTabsStore.getState().openSessionTab(sess)
    }

    const cached = get().detailsBySessionId[sessionId]
    if (cached) {
      set((s) => {
        const nextUnread = { ...s.unreadSessionIds }
        delete nextUnread[sessionId]
        return {
          activeSessionId: sessionId,
          activeDetail: cached,
          unreadSessionIds: nextUnread,
          selectedTurnForDiff: null
        }
      })
      return
    }
    await get().ensureSessionDetail(sessionId)
    const loaded = get().detailsBySessionId[sessionId]
    if (loaded) {
      set((s) => {
        const nextUnread = { ...s.unreadSessionIds }
        delete nextUnread[sessionId]
        return {
          activeSessionId: sessionId,
          activeDetail: loaded,
          unreadSessionIds: nextUnread,
          selectedTurnForDiff: null
        }
      })
    }
  },

  openSessionInSplitPane: async (sessionId) => {
    const next = addSplitPaneId(get().paneSessionIds, sessionId)
    set({ paneSessionIds: next.paneSessionIds, focusedPaneIdx: next.focusedPaneIdx })
    saveSplitPanes({
      paneSessionIds: next.paneSessionIds,
      focusedPaneIdx: next.focusedPaneIdx,
      splitRatio: get().splitRatio
    })
    await get().focusPane(next.focusedPaneIdx)
  },

  closeSplitPane: async (idx) => {
    if (get().paneSessionIds.length <= 1) return
    const next = removeSplitPaneId(get().paneSessionIds, idx, get().focusedPaneIdx)
    set({ paneSessionIds: next.paneSessionIds, focusedPaneIdx: next.focusedPaneIdx })
    saveSplitPanes({
      paneSessionIds: next.paneSessionIds,
      focusedPaneIdx: next.focusedPaneIdx,
      splitRatio: get().splitRatio
    })
    await get().focusPane(next.focusedPaneIdx)
  },

  setSplitRatio: (ratio) => {
    const clamped = clampSplitRatio(ratio)
    set({ splitRatio: clamped })
    saveSplitPanes({
      paneSessionIds: get().paneSessionIds,
      focusedPaneIdx: get().focusedPaneIdx,
      splitRatio: clamped
    })
  },

  createSession: async (req, opts) => {
    const created = await window.workspaceApi.createSession(req)
    const sessions = await window.workspaceApi.listSessions()
    set({ sessions })
    useWorkspaceTabsStore.getState().openSessionTab(created)
    if (opts?.openInSplitPane) {
      await get().openSessionInSplitPane(created.id)
    } else {
      await get().selectSession(created.id)
    }
    return created
  },

  deleteSession: async (sessionId) => {
    await window.workspaceApi.deleteSession(sessionId)
    const sessions = await window.workspaceApi.listSessions()
    const wasActive = get().activeSessionId === sessionId
    const remainingPanes = get().paneSessionIds.filter((id) => id !== sessionId)
    if (remainingPanes.length === 0 && sessions[0]) {
      remainingPanes.push(sessions[0].id)
    }
    const nextFocused = Math.max(0, Math.min(Math.max(0, remainingPanes.length - 1), get().focusedPaneIdx))

    set((s) => {
      const nextDetails = { ...s.detailsBySessionId }
      delete nextDetails[sessionId]
      const nextUnread = { ...s.unreadSessionIds }
      delete nextUnread[sessionId]
      return {
        sessions,
        paneSessionIds: remainingPanes,
        focusedPaneIdx: nextFocused,
        detailsBySessionId: nextDetails,
        unreadSessionIds: nextUnread,
        ...(wasActive ? { activeSessionId: remainingPanes[nextFocused] ?? sessions[0]?.id ?? null, activeDetail: null } : {})
      }
    })
    saveSplitPanes({
      paneSessionIds: remainingPanes,
      focusedPaneIdx: nextFocused,
      splitRatio: get().splitRatio
    })

    useWorkspaceTabsStore.getState().syncSessions(sessions)
    if (remainingPanes[nextFocused]) {
      await get().focusPane(nextFocused)
    }
  },

  forkSession: async (sessionId, upToTurnIndex) => {
    const forked = await window.workspaceApi.forkSession(sessionId, upToTurnIndex)
    const sessions = await window.workspaceApi.listSessions()
    set({ sessions })
    useWorkspaceTabsStore.getState().openSessionTab(forked)
    await get().selectSession(forked.id)
    return forked
  },

  updateSessionMeta: async (sessionId, patch) => {
    const updated = await window.workspaceApi.updateSession(sessionId, patch)
    set((s) => {
      const cached = s.detailsBySessionId[sessionId]
      const nextDetails = cached
        ? { ...s.detailsBySessionId, [sessionId]: { ...cached, session: { ...cached.session, ...updated } } }
        : s.detailsBySessionId
      return {
        sessions: s.sessions.map((item) => (item.id === sessionId ? { ...item, ...updated } : item)),
        detailsBySessionId: nextDetails,
        activeDetail:
          s.activeDetail?.session.id === sessionId
            ? { ...s.activeDetail, session: { ...s.activeDetail.session, ...updated } }
            : s.activeDetail
      }
    })
    useWorkspaceTabsStore.getState().syncSessions(get().sessions)
  },

  switchProvider: async (sessionId, provider, model) => {
    const res = await window.workspaceApi.switchProvider(sessionId, provider, model)
    set((s) => {
      const cached = s.detailsBySessionId[sessionId]
      const nextDetails = cached
        ? {
            ...s.detailsBySessionId,
            [sessionId]: { ...cached, session: res.session, providerStates: res.providerStates }
          }
        : s.detailsBySessionId
      return {
        sessions: s.sessions.map((item) => (item.id === sessionId ? res.session : item)),
        detailsBySessionId: nextDetails,
        activeDetail:
          s.activeDetail?.session.id === sessionId
            ? {
                ...s.activeDetail,
                session: res.session,
                providerStates: res.providerStates
              }
            : s.activeDetail
      }
    })
    return res.unsyncedTurnsCount
  },

  sendPrompt: async (params) => {
    await window.workspaceApi.sendPrompt(params)
    const detail = await fetchDetail(params.sessionId)
    set((s) => ({
      detailsBySessionId: { ...s.detailsBySessionId, [params.sessionId]: detail },
      ...(s.activeSessionId === params.sessionId ? { activeDetail: detail } : {})
    }))
  },

  stopRun: async (sessionId) => {
    await window.workspaceApi.stopRun(sessionId)
  },

  updateMemory: async (sessionId, patch) => {
    const memory = await window.workspaceApi.updateMemory(sessionId, patch)
    set((s) => {
      const cached = s.detailsBySessionId[sessionId]
      const nextDetails = cached
        ? { ...s.detailsBySessionId, [sessionId]: { ...cached, memory } }
        : s.detailsBySessionId
      return {
        detailsBySessionId: nextDetails,
        activeDetail:
          s.activeDetail?.session.id === sessionId
            ? { ...s.activeDetail, memory }
            : s.activeDetail
      }
    })
  },

  compactMemory: async (sessionId) => {
    const memory = await window.workspaceApi.compactMemory(sessionId)
    set((s) => {
      const cached = s.detailsBySessionId[sessionId]
      const nextDetails = cached
        ? { ...s.detailsBySessionId, [sessionId]: { ...cached, memory } }
        : s.detailsBySessionId
      return {
        detailsBySessionId: nextDetails,
        activeDetail:
          s.activeDetail?.session.id === sessionId
            ? { ...s.activeDetail, memory }
            : s.activeDetail
      }
    })
  },

  compactSessionContext: async (sessionId) => {
    const res = await window.workspaceApi.compactSessionContext(sessionId)
    set((s) => {
      const cached = s.detailsBySessionId[sessionId]
      const nextDetails = cached
        ? {
            ...s.detailsBySessionId,
            [sessionId]: {
              ...cached,
              session: { ...cached.session, providerSessionId: null },
              memory: res.memory,
              providerStates: res.providerStates
            }
          }
        : s.detailsBySessionId
      return {
        sessions: s.sessions.map((item) =>
          item.id === sessionId ? { ...item, providerSessionId: null } : item
        ),
        detailsBySessionId: nextDetails,
        activeDetail:
          s.activeDetail?.session.id === sessionId
            ? {
                ...s.activeDetail,
                session: { ...s.activeDetail.session, providerSessionId: null },
                memory: res.memory,
                providerStates: res.providerStates
              }
            : s.activeDetail
      }
    })
    return res
  },

  importClaudeTranscript: async (sessionId) => {
    await window.workspaceApi.importClaudeTranscript(sessionId)
    const detail = await fetchDetail(sessionId)
    set((s) => ({
      detailsBySessionId: { ...s.detailsBySessionId, [sessionId]: detail },
      ...(s.activeSessionId === sessionId ? { activeDetail: detail } : {})
    }))
  },

  setViewMode: (viewMode) => set({ viewMode }),

  setInspectorOpen: (inspectorOpen) => {
    set({ inspectorOpen })
    useWorkspaceTabsStore.getState().setInspectorOpen(inspectorOpen)
  },

  setInspectorTab: (kind) => {
    if (kind === 'changes' || kind === 'memory' || kind === 'skills') {
      set({ inspectorTab: kind })
    }
    useWorkspaceTabsStore.getState().openInspectorTab({
      kind,
      title: INSPECTOR_KIND_TITLES[kind] ?? kind
    })
  },

  setSelectedTurnForDiff: (selectedTurnForDiff) => set({ selectedTurnForDiff }),

  setDraft: (sessionId, text) =>
    set((s) => ({ draftBySession: { ...s.draftBySession, [sessionId]: text } })),

  appendToDraft: (sessionId, snippet) =>
    set((s) => {
      const cur = s.draftBySession[sessionId] ?? ''
      const sep = cur && !cur.endsWith(' ') && !cur.endsWith('\n') ? ' ' : ''
      return {
        draftBySession: { ...s.draftBySession, [sessionId]: `${cur}${sep}${snippet}` }
      }
    }),

  clearUnread: (sessionId) =>
    set((s) => {
      if (!s.unreadSessionIds[sessionId]) return s
      const next = { ...s.unreadSessionIds }
      delete next[sessionId]
      return { unreadSessionIds: next }
    }),

  addSessionTask: (sessionId, text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    set((s) => {
      const prev = s.customTasksBySession[sessionId] ?? []
      const nextMap = {
        ...s.customTasksBySession,
        [sessionId]: [
          ...prev,
          {
            id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            text: trimmed,
            done: false,
            createdAt: new Date().toISOString()
          }
        ]
      }
      saveCustomTasks(nextMap)
      return { customTasksBySession: nextMap }
    })
  },

  toggleSessionTask: (sessionId, taskId) => {
    set((s) => {
      const prev = s.customTasksBySession[sessionId] ?? []
      const nextMap = {
        ...s.customTasksBySession,
        [sessionId]: prev.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t))
      }
      saveCustomTasks(nextMap)
      return { customTasksBySession: nextMap }
    })
  },

  deleteSessionTask: (sessionId, taskId) => {
    set((s) => {
      const prev = s.customTasksBySession[sessionId] ?? []
      const nextMap = {
        ...s.customTasksBySession,
        [sessionId]: prev.filter((t) => t.id !== taskId)
      }
      saveCustomTasks(nextMap)
      return { customTasksBySession: nextMap }
    })
  },

  handleStreamEvent: (sessionId, turnId, event) => {
    eventQueue.push({ sessionId, turnId, event })
    // Kết thúc lượt / lỗi: áp dụng ngay để UI chốt trạng thái, delta thường thì gộp theo khung 40ms
    if (event.type === 'turn.complete' || event.type === 'error') flushQueuedEvents()
    else scheduleFlush()
  },

  handleSessionStatus: (sessionId, status) => {
    flushQueuedEvents()
    set((s) => {
      const cached = s.detailsBySessionId[sessionId]
      const updatedCached = cached
        ? {
            ...cached,
            session: { ...cached.session, status },
            turns: applySessionStatusToTurns(cached.turns, status)
          }
        : undefined
      const nextDetails = updatedCached
        ? { ...s.detailsBySessionId, [sessionId]: updatedCached }
        : s.detailsBySessionId
      const isVisible = s.activeSessionId === sessionId || s.paneSessionIds.includes(sessionId)
      const shouldMarkUnread = status !== 'running' && !isVisible
      return {
        sessions: s.sessions.map((item) => (item.id === sessionId ? { ...item, status } : item)),
        detailsBySessionId: nextDetails,
        unreadSessionIds: shouldMarkUnread
          ? { ...s.unreadSessionIds, [sessionId]: true }
          : s.unreadSessionIds,
        activeDetail:
          s.activeDetail?.session.id === sessionId
            ? {
                ...s.activeDetail,
                session: { ...s.activeDetail.session, status },
                turns: applySessionStatusToTurns(s.activeDetail.turns, status)
              }
            : s.activeDetail
      }
    })

    // Khi phiên chuyển sang running (vd pha 2 Orchestrator) hoặc hoàn thành, nạp lại chi tiết đầy đủ từ DB
    if (get().activeSessionId === sessionId || Boolean(get().detailsBySessionId[sessionId])) {
      void get().ensureSessionDetail(sessionId)
    }
    // Làm mới danh sách cả khi bắt đầu chạy: tiêu đề tự đặt từ prompt đầu hiện ngay thay vì chờ xong lượt
    void window.workspaceApi.listSessions().then((sessions) => set({ sessions }))
  }
  }
})
