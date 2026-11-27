import { beforeEach, describe, expect, it } from 'vitest'
import type { AiSession } from '../src/shared/types/ai'
import { addSplitPaneId, clampSplitRatio, removeSplitPaneId } from '../src/shared/utils/split-panes'
import { useWorkspaceTabsStore } from '../src/renderer/stores/useWorkspaceTabsStore'

function makeSession(id: string, title: string, workspacePath = 'D:\\proj\\a'): AiSession {
  const now = new Date().toISOString()
  return {
    id,
    workspaceId: 'ws-1',
    workspacePath,
    provider: 'claude',
    providerSessionId: null,
    title,
    model: '',
    effort: 'medium',
    permissionMode: 'edit',
    worktreePath: null,
    worktreeBranch: null,
    worktreeBaseBranch: null,
    pinned: false,
    status: 'idle',
    createdAt: now,
    updatedAt: now
  }
}

describe('Multi-Tab Workspace & Dynamic Inspector Store', () => {
  beforeEach(() => {
    useWorkspaceTabsStore.getState().resetForTest()
  })

  it('opens multiple session and tool tabs, switches, closes and reopens with Ctrl+Shift+T semantics', () => {
    const store = useWorkspaceTabsStore.getState()
    const s1 = makeSession('s1', 'API Refactor', 'D:\\proj\\api')
    const s2 = makeSession('s2', 'UI Polish', 'D:\\proj\\web')

    const t1 = store.openSessionTab(s1)
    const t2 = store.openSessionTab(s2)
    const tTerm = store.openToolTab({ kind: 'terminal', title: 'Shell', workspacePath: 'D:\\proj\\api', ptyId: 'pty-1' })

    expect(useWorkspaceTabsStore.getState().tabs.map((t) => t.id)).toEqual([t1.id, t2.id, tTerm.id])
    expect(useWorkspaceTabsStore.getState().activeTabId).toBe(tTerm.id)

    // Re-opening existing session focuses its tab without duplicating
    store.openSessionTab(s1)
    expect(useWorkspaceTabsStore.getState().tabs).toHaveLength(3)
    expect(useWorkspaceTabsStore.getState().activeTabId).toBe(t1.id)

    // Pin tab 2 moves it before unpinned tabs
    store.togglePinTab(t2.id)
    expect(useWorkspaceTabsStore.getState().tabs[0].id).toBe(t2.id)

    // Close t1 then reopen
    store.closeTab(t1.id)
    expect(useWorkspaceTabsStore.getState().tabs.some((t) => t.id === t1.id)).toBe(false)
    store.reopenLastClosedTab()
    expect(useWorkspaceTabsStore.getState().tabs.some((t) => t.id === t1.id)).toBe(true)
  })

  it('maintains separate per-tab inspector layouts and auto-collapses when closing the last inspector tab', () => {
    const store = useWorkspaceTabsStore.getState()
    const t1 = store.openSessionTab(makeSession('s1', 'Backend'))
    const t2 = store.openSessionTab(makeSession('s2', 'Frontend'))

    // Open Files and a file-viewer in t1 only
    store.openInspectorTab({ kind: 'files', title: 'Files', workspacePath: 'D:\\proj\\a' }, t1.id)
    store.openInspectorTab(
      { kind: 'file-viewer', title: 'index.ts', filePath: 'src/index.ts', workspacePath: 'D:\\proj\\a' },
      t1.id
    )
    // Open Preview in t2 only
    store.openInspectorTab({ kind: 'preview', title: 'Live Preview', previewUrl: 'http://localhost:5173' }, t2.id)

    const state1 = useWorkspaceTabsStore.getState().tabs.find((t) => t.id === t1.id)!
    const state2 = useWorkspaceTabsStore.getState().tabs.find((t) => t.id === t2.id)!

    expect(state1.inspector.tabs.some((i) => i.kind === 'files')).toBe(true)
    expect(state1.inspector.tabs.some((i) => i.kind === 'preview')).toBe(false)
    expect(state2.inspector.tabs.some((i) => i.kind === 'preview')).toBe(true)
    expect(state2.inspector.tabs.some((i) => i.kind === 'files')).toBe(false)

    // Closing all inspector tabs on t2 collapses its inspector automatically
    for (const insp of [...state2.inspector.tabs]) {
      store.closeInspectorTab(insp.id, t2.id)
    }
    const afterClose = useWorkspaceTabsStore.getState().tabs.find((t) => t.id === t2.id)!
    expect(afterClose.inspector.tabs).toHaveLength(0)
    expect(afterClose.inspector.open).toBe(false)

    // Toggling inspector back on restores default tabs cleanly
    store.toggleInspector(t2.id)
    const afterReopen = useWorkspaceTabsStore.getState().tabs.find((t) => t.id === t2.id)!
    expect(afterReopen.inspector.open).toBe(true)
    expect(afterReopen.inspector.tabs.length).toBeGreaterThanOrEqual(2)
  })

  it('manages vertical split chat panes: addSplitPaneId, removeSplitPaneId, and clampSplitRatio', () => {
    const step1 = addSplitPaneId(['sp-1'], 'sp-2')
    expect(step1).toEqual({ paneSessionIds: ['sp-1', 'sp-2'], focusedPaneIdx: 1 })

    // Re-opening already open pane focuses it without duplicating
    const focusExisting = addSplitPaneId(step1.paneSessionIds, 'sp-1')
    expect(focusExisting).toEqual({ paneSessionIds: ['sp-1', 'sp-2'], focusedPaneIdx: 0 })

    // Caps at MAX_SPLIT_PANES = 3
    const step3 = addSplitPaneId(step1.paneSessionIds, 'sp-3')
    expect(step3.paneSessionIds).toEqual(['sp-1', 'sp-2', 'sp-3'])
    const step4 = addSplitPaneId(step3.paneSessionIds, 'sp-4')
    expect(step4).toEqual({ paneSessionIds: ['sp-1', 'sp-2', 'sp-4'], focusedPaneIdx: 2 })

    const closed = removeSplitPaneId(step1.paneSessionIds, 1, 1)
    expect(closed).toEqual({ paneSessionIds: ['sp-1'], focusedPaneIdx: 0 })

    expect(clampSplitRatio(0.1)).toBe(0.18)
    expect(clampSplitRatio(0.9)).toBe(0.82)
  })
})
