import { create } from 'zustand'
import type { PtySessionInfo } from '@shared/types/workspace'

interface TerminalTab extends PtySessionInfo {
  buffer: string
  exited: boolean
}

interface TerminalState {
  tabs: TerminalTab[]
  activePtyId: string | null

  openShellTab: (cwd: string, title?: string) => Promise<PtySessionInfo>
  openInteractiveAiTab: (sessionId: string) => Promise<PtySessionInfo>
  attachExistingPty: (info: PtySessionInfo) => void
  setActivePty: (ptyId: string) => void
  closeTab: (ptyId: string) => Promise<void>
  appendData: (ptyId: string, data: string) => void
  markExited: (ptyId: string, exitCode: number) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activePtyId: null,

  openShellTab: async (cwd, title) => {
    const info = await window.workspaceApi.createPty({ cwd, title })
    get().attachExistingPty(info)
    return info
  },

  openInteractiveAiTab: async (sessionId) => {
    const info = await window.workspaceApi.openInteractiveSessionPty(sessionId)
    get().attachExistingPty(info)
    return info
  },

  attachExistingPty: (info) => {
    set((s) => ({
      tabs: [...s.tabs, { ...info, buffer: '', exited: false }],
      activePtyId: info.id
    }))
  },

  setActivePty: (activePtyId) => set({ activePtyId }),

  closeTab: async (ptyId) => {
    await window.workspaceApi.killPty(ptyId)
    set((s) => {
      const nextTabs = s.tabs.filter((t) => t.id !== ptyId)
      const nextActive = s.activePtyId === ptyId ? nextTabs[nextTabs.length - 1]?.id ?? null : s.activePtyId
      return { tabs: nextTabs, activePtyId: nextActive }
    })
  },

  appendData: (ptyId, data) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== ptyId) return t
        const nextBuf = t.buffer + data
        return { ...t, buffer: nextBuf.length > 100_000 ? nextBuf.slice(-80_000) : nextBuf }
      })
    }))
  },

  markExited: (ptyId, exitCode) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === ptyId ? { ...t, exited: true, buffer: `${t.buffer}\r\n[Tiến trình đã thoát với mã ${exitCode}]\r\n` } : t
      )
    }))
  }
}))
