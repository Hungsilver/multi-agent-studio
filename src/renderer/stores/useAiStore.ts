import { create } from 'zustand'
import type {
  AiAttachment,
  AiSession,
  AiTurn,
  EffortLevel,
  NormalizedAgentEvent,
  PermissionMode,
  ProviderId,
  ProviderSyncState,
  SessionMemory
} from '@shared/types/ai'
import type { CreateSessionRequest } from '@shared/types/ipc'

export type WorkspaceViewMode = 'chat' | 'split' | 'terminal'
export type InspectorTab = 'changes' | 'memory' | 'skills'

interface AiState {
  sessions: AiSession[]
  activeSessionId: string | null
  activeDetail: {
    session: AiSession
    turns: AiTurn[]
    memory: SessionMemory
    providerStates: ProviderSyncState[]
  } | null
  viewMode: WorkspaceViewMode
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  selectedTurnForDiff: string | null
  draftBySession: Record<string, string>

  loadSessions: () => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  createSession: (req: CreateSessionRequest) => Promise<AiSession>
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
  }) => Promise<void>
  stopRun: (sessionId: string) => Promise<void>
  updateMemory: (sessionId: string, patch: Partial<Omit<SessionMemory, 'sessionId' | 'updatedAt'>>) => Promise<void>
  compactMemory: (sessionId: string) => Promise<void>
  importClaudeTranscript: (sessionId: string) => Promise<void>

  setViewMode: (mode: WorkspaceViewMode) => void
  setInspectorOpen: (open: boolean) => void
  setInspectorTab: (tab: InspectorTab) => void
  setSelectedTurnForDiff: (turnId: string | null) => void
  setDraft: (sessionId: string, text: string) => void

  handleStreamEvent: (sessionId: string, turnId: string, event: NormalizedAgentEvent) => void
  handleSessionStatus: (sessionId: string, status: 'idle' | 'running' | 'error') => void
}

export const useAiStore = create<AiState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeDetail: null,
  viewMode: 'chat',
  inspectorOpen: true,
  inspectorTab: 'changes',
  selectedTurnForDiff: null,
  draftBySession: {},

  loadSessions: async () => {
    const sessions = await window.workspaceApi.listSessions()
    const currentId = get().activeSessionId
    set({ sessions })
    if (!currentId && sessions.length > 0) {
      await get().selectSession(sessions[0].id)
    } else if (currentId && sessions.some((s) => s.id === currentId)) {
      await get().selectSession(currentId)
    }
  },

  selectSession: async (sessionId) => {
    const detail = await window.workspaceApi.getSessionDetail(sessionId)
    set({ activeSessionId: sessionId, activeDetail: detail, selectedTurnForDiff: null })
  },

  createSession: async (req) => {
    const created = await window.workspaceApi.createSession(req)
    const sessions = await window.workspaceApi.listSessions()
    set({ sessions })
    await get().selectSession(created.id)
    return created
  },

  deleteSession: async (sessionId) => {
    await window.workspaceApi.deleteSession(sessionId)
    const sessions = await window.workspaceApi.listSessions()
    const wasActive = get().activeSessionId === sessionId
    set({
      sessions,
      ...(wasActive ? { activeSessionId: sessions[0]?.id ?? null, activeDetail: null } : {})
    })
    if (wasActive && sessions[0]) {
      await get().selectSession(sessions[0].id)
    }
  },

  forkSession: async (sessionId, upToTurnIndex) => {
    const forked = await window.workspaceApi.forkSession(sessionId, upToTurnIndex)
    const sessions = await window.workspaceApi.listSessions()
    set({ sessions })
    await get().selectSession(forked.id)
    return forked
  },

  updateSessionMeta: async (sessionId, patch) => {
    const updated = await window.workspaceApi.updateSession(sessionId, patch)
    set((s) => ({
      sessions: s.sessions.map((item) => (item.id === sessionId ? { ...item, ...updated } : item)),
      activeDetail:
        s.activeDetail?.session.id === sessionId
          ? { ...s.activeDetail, session: { ...s.activeDetail.session, ...updated } }
          : s.activeDetail
    }))
  },

  switchProvider: async (sessionId, provider, model) => {
    const res = await window.workspaceApi.switchProvider(sessionId, provider, model)
    set((s) => ({
      sessions: s.sessions.map((item) => (item.id === sessionId ? res.session : item)),
      activeDetail:
        s.activeDetail?.session.id === sessionId
          ? {
              ...s.activeDetail,
              session: res.session,
              providerStates: res.providerStates
            }
          : s.activeDetail
    }))
    return res.unsyncedTurnsCount
  },

  sendPrompt: async (params) => {
    await window.workspaceApi.sendPrompt(params)
    if (get().activeSessionId === params.sessionId) {
      await get().selectSession(params.sessionId)
    }
  },

  stopRun: async (sessionId) => {
    await window.workspaceApi.stopRun(sessionId)
  },

  updateMemory: async (sessionId, patch) => {
    const memory = await window.workspaceApi.updateMemory(sessionId, patch)
    set((s) => ({
      activeDetail:
        s.activeDetail?.session.id === sessionId
          ? { ...s.activeDetail, memory }
          : s.activeDetail
    }))
  },

  compactMemory: async (sessionId) => {
    const memory = await window.workspaceApi.compactMemory(sessionId)
    set((s) => ({
      activeDetail:
        s.activeDetail?.session.id === sessionId
          ? { ...s.activeDetail, memory }
          : s.activeDetail
    }))
  },

  importClaudeTranscript: async (sessionId) => {
    await window.workspaceApi.importClaudeTranscript(sessionId)
    if (get().activeSessionId === sessionId) {
      await get().selectSession(sessionId)
    }
  },

  setViewMode: (viewMode) => set({ viewMode }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setSelectedTurnForDiff: (selectedTurnForDiff) => set({ selectedTurnForDiff }),
  setDraft: (sessionId, text) =>
    set((s) => ({ draftBySession: { ...s.draftBySession, [sessionId]: text } })),

  handleStreamEvent: (sessionId, turnId, event) => {
    set((s) => {
      if (s.activeDetail?.session.id !== sessionId) return s
      const turns = s.activeDetail.turns.map((t) => {
        if (t.id !== turnId) return t
        const nextSeq = (t.events[t.events.length - 1]?.seq ?? 0) + 1
        return {
          ...t,
          events: [
            ...t.events,
            { id: Date.now() + nextSeq, turnId, seq: nextSeq, event, createdAt: new Date().toISOString() }
          ]
        }
      })
      let nextSession = s.activeDetail.session
      if (event.type === 'session.init') {
        nextSession = { ...nextSession, providerSessionId: event.providerSessionId }
      }
      return {
        activeDetail: {
          ...s.activeDetail,
          session: nextSession,
          turns
        }
      }
    })
  },

  handleSessionStatus: (sessionId, status) => {
    set((s) => ({
      sessions: s.sessions.map((item) => (item.id === sessionId ? { ...item, status } : item)),
      activeDetail:
        s.activeDetail?.session.id === sessionId
          ? { ...s.activeDetail, session: { ...s.activeDetail.session, status } }
          : s.activeDetail
    }))
    // Khi phiên hoàn thành, đồng bộ lại đầy đủ turns/checkpoints/memory từ DB
    if (status !== 'running') {
      if (get().activeSessionId === sessionId) {
        void get().selectSession(sessionId)
      }
      void window.workspaceApi.listSessions().then((sessions) => set({ sessions }))
    }
  }
}))
