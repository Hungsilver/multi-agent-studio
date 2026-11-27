import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  FileCode2,
  GitBranch,
  Globe,
  PanelLeft,
  PanelLeftClose,
  Pin,
  Plus,
  RotateCcw,
  TerminalSquare,
  X
} from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useWorkspaceTabsStore, type WorkspaceTab } from '../../stores/useWorkspaceTabsStore'

export function WorkspaceTabBar(): React.JSX.Element {
  const tabs = useWorkspaceTabsStore((s) => s.tabs)
  const activeTabId = useWorkspaceTabsStore((s) => s.activeTabId)
  const closedTabs = useWorkspaceTabsStore((s) => s.closedTabs)
  const sidebarCollapsed = useWorkspaceTabsStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspaceTabsStore((s) => s.toggleSidebar)
  const setActiveTab = useWorkspaceTabsStore((s) => s.setActiveTab)
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab)
  const reopenLastClosedTab = useWorkspaceTabsStore((s) => s.reopenLastClosedTab)
  const closeOtherTabs = useWorkspaceTabsStore((s) => s.closeOtherTabs)
  const closeTabsToRight = useWorkspaceTabsStore((s) => s.closeTabsToRight)
  const togglePinTab = useWorkspaceTabsStore((s) => s.togglePinTab)
  const reorderTabs = useWorkspaceTabsStore((s) => s.reorderTabs)
  const openToolTab = useWorkspaceTabsStore((s) => s.openToolTab)

  const sessions = useAiStore((s) => s.sessions)
  const activeDetail = useAiStore((s) => s.activeDetail)
  const unreadSessionIds = useAiStore((s) => s.unreadSessionIds)
  const selectSession = useAiStore((s) => s.selectSession)
  const createSession = useAiStore((s) => s.createSession)

  const workspaces = useSettingsStore((s) => s.workspaces)
  const settings = useSettingsStore((s) => s.settings)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const showToast = useSettingsStore((s) => s.showToast)
  const closePtyTab = useTerminalStore((s) => s.closeTab)
  const openShellTab = useTerminalStore((s) => s.openShellTab)

  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: WorkspaceTab } | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const newMenuRef = useRef<HTMLDivElement | null>(null)
  const tabStripRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = tabStripRef.current?.querySelector('[data-active-tab="true"]') as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false)
      }
      setContextMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const currentWorkDir =
    activeDetail?.session.worktreePath || activeDetail?.session.workspacePath || workspaces[0]?.path || ''

  const handleSelectTab = (tab: WorkspaceTab): void => {
    setActiveTab(tab.id)
    if (tab.kind === 'session' && tab.sessionId) {
      void selectSession(tab.sessionId)
    }
  }

  const handleCloseTab = (tab: WorkspaceTab): void => {
    const removed = closeTab(tab.id)
    if (removed?.kind === 'terminal' && removed.ptyId) {
      void closePtyTab(removed.ptyId)
    }
    const nextActiveId = useWorkspaceTabsStore.getState().activeTabId
    const nextTab = useWorkspaceTabsStore.getState().tabs.find((t) => t.id === nextActiveId)
    if (nextTab?.kind === 'session' && nextTab.sessionId) {
      void selectSession(nextTab.sessionId)
    }
  }

  const handleNewAiTab = async (): Promise<void> => {
    setNewMenuOpen(false)
    let targetPath = currentWorkDir
    if (!targetPath) {
      const ws = await addWorkspace()
      if (!ws) return
      targetPath = ws.path
    }
    try {
      await createSession({
        workspacePath: targetPath,
        provider: settings.defaultProvider,
        permissionMode: settings.defaultMode
      })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không tạo được phiên mới', 'err')
    }
  }

  const handleNewTerminalTab = async (): Promise<void> => {
    setNewMenuOpen(false)
    const dir = currentWorkDir || '.'
    const info = await openShellTab(dir, `Shell (${dir.split(/[\\/]/).filter(Boolean).pop() || 'Root'})`)
    openToolTab({
      kind: 'terminal',
      title: info.title,
      workspacePath: dir,
      ptyId: info.id
    })
  }

  return (
    <div
      className="h-9 shrink-0 border-b flex items-center px-2 gap-1.5 select-none"
      style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
    >
      {/* Toggle Session Sidebar */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="p-1.5 rounded-lg btn-ghost cursor-pointer shrink-0"
        style={{ color: sidebarCollapsed ? 'var(--accent)' : 'var(--muted)' }}
        title={sidebarCollapsed ? 'Hiện danh sách phiên (Ctrl+B)' : 'Thu gọn danh sách phiên (Ctrl+B)'}
      >
        {sidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
      </button>

      {/* Tabs Strip */}
      <div
        ref={tabStripRef}
        onWheel={(e) => {
          if (e.deltaY !== 0 && tabStripRef.current) {
            tabStripRef.current.scrollLeft += e.deltaY
          }
        }}
        className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0"
      >
        {tabs.map((tab, idx) => {
          const active = tab.id === activeTabId
          const sess = tab.kind === 'session' && tab.sessionId ? sessions.find((s) => s.id === tab.sessionId) : undefined
          const unread = Boolean(tab.sessionId && unreadSessionIds[tab.sessionId])
          const meta = sess ? PROVIDERS[sess.provider] : null

          return (
            <div
              key={tab.id}
              data-active-tab={active ? 'true' : undefined}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== idx) {
                  reorderTabs(dragIdx, idx)
                }
                setDragIdx(null)
              }}
              onClick={() => handleSelectTab(tab)}
              onAuxClick={(e) => {
                if (e.button === 1 && !tab.pinned) {
                  e.preventDefault()
                  handleCloseTab(tab)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, tab })
              }}
              className="group relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer shrink-0 max-w-[200px] border transition-colors"
              style={{
                backgroundColor: active ? 'var(--surface)' : 'transparent',
                borderColor: active ? 'var(--border)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)'
              }}
              title={tab.workspacePath ? `${tab.title} — ${tab.workspacePath}` : tab.title}
            >
              {/* Status / Kind Indicator */}
              {tab.kind === 'session' ? (
                sess?.status === 'running' ? (
                  <span className="w-2 h-2 rounded-full shrink-0 animate-ping" style={{ backgroundColor: 'var(--ok)' }} />
                ) : (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: sess?.status === 'error' ? 'var(--err)' : meta?.color ?? 'var(--accent)' }}
                  />
                )
              ) : tab.kind === 'terminal' ? (
                <TerminalSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ok)' }} />
              ) : tab.kind === 'git' ? (
                <GitBranch className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warn)' }} />
              ) : tab.kind === 'governance' ? (
                <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
              ) : tab.kind === 'file' ? (
                <FileCode2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
              ) : (
                <Globe className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
              )}

              <span className="truncate">{tab.title}</span>

              {unread && !active && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--accent)' }}
                  title="Phiên nền vừa hoàn tất"
                />
              )}

              {tab.pinned ? (
                <Pin className="w-3 h-3 shrink-0 opacity-75" style={{ color: 'var(--accent)' }} />
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(tab)
                  }}
                  className={`p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer shrink-0 transition-opacity ${
                    active ? 'opacity-75 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Đóng tab (Ctrl+W)"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Reopen Closed Tab + New Tab Menu */}
      <div ref={newMenuRef} className="relative flex items-center gap-1 shrink-0">
        {closedTabs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const restored = reopenLastClosedTab()
              if (restored?.kind === 'session' && restored.sessionId) {
                void selectSession(restored.sessionId)
              }
            }}
            className="p-1.5 rounded-lg btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Mở lại tab vừa đóng (Ctrl+Shift+T)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => void handleNewAiTab()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs btn-ghost cursor-pointer"
          style={{ color: 'var(--accent)' }}
          title="Mở tab phiên AI mới (Ctrl+T)"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden md:inline font-medium">Tab mới</span>
        </button>

        <button
          type="button"
          onClick={() => setNewMenuOpen((o) => !o)}
          className="px-1.5 py-1 rounded-lg text-[10px] border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Chọn loại tab công việc"
        >
          ▾
        </button>

        {newMenuOpen && (
          <div
            className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border shadow-2xl p-1.5 z-50 text-xs space-y-0.5"
            style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => void handleNewAiTab()}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>Tab Phiên AI mới (Ctrl+T)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleNewTerminalTab()}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <TerminalSquare className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
              <span>Tab Terminal độc lập</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewMenuOpen(false)
                openToolTab({
                  kind: 'git',
                  title: `Git · ${currentWorkDir.split(/[\\/]/).filter(Boolean).pop() || 'Repo'}`,
                  workspacePath: currentWorkDir
                })
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} />
              <span>Tab Git Workspace</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewMenuOpen(false)
                openToolTab({
                  kind: 'governance',
                  title: 'Skills & AGENTS.md',
                  workspacePath: currentWorkDir
                })
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>Tab Skills &amp; Rules</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewMenuOpen(false)
                openToolTab({
                  kind: 'preview',
                  title: 'localhost:5173',
                  previewUrl: 'http://localhost:5173'
                })
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
              <span>Tab Live Web Preview</span>
            </button>
          </div>
        )}
      </div>

      {/* Right-click Tab Context Menu */}
      {contextMenu && (
        <div
          className="fixed w-52 rounded-xl border shadow-2xl p-1.5 z-50 text-xs space-y-0.5"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            backgroundColor: 'var(--surface-elevated)',
            borderColor: 'var(--border)'
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              togglePinTab(contextMenu.tab.id)
              setContextMenu(null)
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg btn-ghost cursor-pointer"
          >
            {contextMenu.tab.pinned ? 'Bỏ ghim tab' : 'Ghim tab lên đầu'}
          </button>
          {!contextMenu.tab.pinned && (
            <button
              type="button"
              onClick={() => {
                handleCloseTab(contextMenu.tab)
                setContextMenu(null)
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg btn-ghost cursor-pointer"
            >
              Đóng tab
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              closeOtherTabs(contextMenu.tab.id)
              setContextMenu(null)
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg btn-ghost cursor-pointer"
          >
            Đóng các tab khác
          </button>
          <button
            type="button"
            onClick={() => {
              closeTabsToRight(contextMenu.tab.id)
              setContextMenu(null)
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg btn-ghost cursor-pointer"
          >
            Đóng các tab bên phải
          </button>
          {closedTabs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const restored = reopenLastClosedTab()
                if (restored?.kind === 'session' && restored.sessionId) {
                  void selectSession(restored.sessionId)
                }
                setContextMenu(null)
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg btn-ghost cursor-pointer border-t pt-1.5 mt-1"
              style={{ borderColor: 'var(--border)' }}
            >
              Mở lại tab vừa đóng
            </button>
          )}
        </div>
      )}
    </div>
  )
}
