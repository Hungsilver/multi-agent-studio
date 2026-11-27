import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { AiWorkstation } from './components/ai/AiWorkstation'
import { XTermInstance } from './components/ai/EmbeddedTerminalPane'
import { SessionSidebar } from './components/ai/SessionSidebar'
import { UsageDashboard } from './components/analytics/UsageDashboard'
import { AppsWorkspace } from './components/apps/AppsWorkspace'
import { DatabaseWorkspace } from './components/database/DatabaseWorkspace'
import { GitWorkspace } from './components/git/GitWorkspace'
import { GovernanceStudio } from './components/governance/GovernanceStudio'
import { FileViewerPanel } from './components/inspector/FileViewerPanel'
import { LiveWebPreviewPanel } from './components/inspector/LiveWebPreviewPanel'
import { AppShell } from './components/layout/AppShell'
import { SettingsView } from './components/settings/SettingsView'
import appAvatar from './assets/app-avatar.png'
import { useAiStore } from './stores/useAiStore'
import { useAppsStore } from './stores/useAppsStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useTerminalStore } from './stores/useTerminalStore'
import { useWorkspaceTabsStore, type WorkspaceTab } from './stores/useWorkspaceTabsStore'

// Công cụ gỡ lỗi / kiểm thử E2E: lộ store ra window để script kiểm thử và DevTools truy cập
;(window as unknown as { __aict?: unknown }).__aict = { useAiStore, useAppsStore, useSettingsStore, useWorkspaceTabsStore }

interface ErrorBoundaryState {
  error: Error | null
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Đổi giá trị này (vd chuyển phiên) sẽ tự xóa lỗi và dựng lại giao diện, không cần tải lại trang. */
  resetKey?: string
  compact?: boolean
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI ErrorBoundary:', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className={`${this.props.compact ? 'flex-1 min-h-0' : 'h-screen w-screen'} flex flex-col items-center justify-center p-8 text-center gap-4`}
          style={{ backgroundColor: '#0E1117', color: '#E6EDF3' }}
        >
          <img src={appAvatar} alt="Multi-Agent Studio" className="w-12 h-12 rounded-xl" />
          <div className="text-base font-semibold">Đã xảy ra lỗi giao diện</div>
          <pre className="max-w-xl text-xs p-3 rounded-lg bg-black/40 border border-red-500/40 text-red-300 overflow-auto">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-500 text-white cursor-pointer"
          >
            Thử lại (giữ nguyên dữ liệu)
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 rounded-lg text-[11px] border border-white/20 text-white/70 cursor-pointer"
          >
            Tải lại giao diện
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function FullTabTerminal({ tab }: { tab: WorkspaceTab }): React.JSX.Element {
  const openShellTab = useTerminalStore((s) => s.openShellTab)
  const ptyTabs = useTerminalStore((s) => s.tabs)
  const updateWorkspaceTab = useWorkspaceTabsStore((s) => s.updateWorkspaceTab)

  const ptyExists = Boolean(tab.ptyId && ptyTabs.some((t) => t.id === tab.ptyId))

  useEffect(() => {
    if (!tab.ptyId || !ptyExists) {
      void openShellTab(tab.workspacePath || '.', tab.title).then((info) => {
        updateWorkspaceTab(tab.id, { ptyId: info.id })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  if (!tab.ptyId || !ptyExists) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
        Đang khởi tạo PowerShell ConPTY…
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0" style={{ backgroundColor: 'var(--bg)' }}>
      <XTermInstance key={tab.ptyId} ptyId={tab.ptyId} />
    </div>
  )
}

export function App(): React.JSX.Element {
  const init = useSettingsStore((s) => s.init)
  const loaded = useSettingsStore((s) => s.loaded)
  const activeTab = useSettingsStore((s) => s.activeTab)

  const loadSessions = useAiStore((s) => s.loadSessions)
  const selectSession = useAiStore((s) => s.selectSession)
  const createSession = useAiStore((s) => s.createSession)
  const handleStreamEvent = useAiStore((s) => s.handleStreamEvent)
  const handleSessionStatus = useAiStore((s) => s.handleSessionStatus)

  const appendPtyData = useTerminalStore((s) => s.appendData)
  const markPtyExited = useTerminalStore((s) => s.markExited)
  const closePtyTab = useTerminalStore((s) => s.closeTab)

  const wsTabs = useWorkspaceTabsStore((s) => s.tabs)
  const activeWsTabId = useWorkspaceTabsStore((s) => s.activeTabId)
  const activeSessionId = useAiStore((s) => s.activeSessionId)
  const sidebarCollapsed = useWorkspaceTabsStore((s) => s.sidebarCollapsed)

  useEffect(() => {
    void init()
      .then(() => loadSessions())
      .catch((err) => console.error('Khởi tạo phiên làm việc thất bại:', err))
  }, [init, loadSessions])

  useEffect(() => {
    if (!loaded) return
    void useAppsStore.getState().initApps()
  }, [loaded])

  useEffect(() => {
    if (!loaded || activeTab === 'apps') return
    const timer = setInterval(() => {
      const s = useAppsStore.getState()
      if (s.apps.length > 0 || (s.config?.apps.length ?? 0) > 0) {
        void s.refreshApps(false, true)
      }
    }, 10_000)
    return () => clearInterval(timer)
  }, [loaded, activeTab])

  useEffect(() => {
    const unsub1 = window.workspaceApi.onAiEvent((p) => handleStreamEvent(p.sessionId, p.turnId, p.event))
    const unsub2 = window.workspaceApi.onAiSessionStatus((p) => {
      handleSessionStatus(p.sessionId, p.status)
      if (p.status !== 'running') {
        void useSettingsStore.getState().refreshProviderQuotas(true)
      }
    })
    const unsub3 = window.workspaceApi.onPtyData((p) => appendPtyData(p.ptyId, p.data))
    const unsub4 = window.workspaceApi.onPtyExit((p) => markPtyExited(p.ptyId, p.exitCode))
    const unsub5 = window.workspaceApi.onAppsAlert((p) => {
      useSettingsStore.getState().showToast(`${p.title}: ${p.message}`, p.kind === 'crash' ? 'err' : 'info')
    })
    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
      unsub5()
    }
  }, [handleStreamEvent, handleSessionStatus, appendPtyData, markPtyExited])

  // Global IDE/Browser Tab & Panel Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return

      const key = e.key.toLowerCase()
      const tabsState = useWorkspaceTabsStore.getState()
      const settingsState = useSettingsStore.getState()
      const aiState = useAiStore.getState()

      if (key === 'b' && e.altKey && !e.shiftKey) {
        e.preventDefault()
        tabsState.toggleNavRail()
        return
      }
      if (key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        tabsState.toggleSidebar()
        return
      }
      if (e.key === '\\') {
        e.preventDefault()
        tabsState.toggleInspector()
        return
      }
      if (key === 't' && !e.shiftKey) {
        e.preventDefault()
        const workDir =
          aiState.activeDetail?.session.worktreePath ||
          aiState.activeDetail?.session.workspacePath ||
          settingsState.workspaces[0]?.path
        if (workDir) {
          void createSession({
            workspacePath: workDir,
            provider: settingsState.settings.defaultProvider,
            permissionMode: settingsState.settings.defaultMode
          }).then(() => settingsState.setActiveTab('ai'))
        }
        return
      }
      if (key === 't' && e.shiftKey) {
        e.preventDefault()
        const restored = tabsState.reopenLastClosedTab()
        if (restored?.kind === 'session' && restored.sessionId) {
          void selectSession(restored.sessionId)
        }
        settingsState.setActiveTab('ai')
        return
      }
      if (key === 'w' && !e.shiftKey) {
        if (settingsState.activeTab === 'ai') {
          const cur = tabsState.activeTabId
            ? tabsState.tabs.find((t) => t.id === tabsState.activeTabId)
            : undefined
          if (cur && cur.kind !== 'session' && !cur.pinned) {
            e.preventDefault()
            const removed = tabsState.closeTab(cur.id)
            if (removed?.kind === 'terminal' && removed.ptyId) {
              void closePtyTab(removed.ptyId)
            }
            const sess = aiState.sessions.find((s) => s.id === aiState.activeSessionId)
            if (sess) tabsState.openSessionTab(sess)
            return
          }
          if (aiState.paneSessionIds.length > 1) {
            e.preventDefault()
            void aiState.closeSplitPane(aiState.focusedPaneIdx)
          }
        }
        return
      }
      if (e.key === 'Tab' && aiState.paneSessionIds.length > 1) {
        e.preventDefault()
        const dir = e.shiftKey ? -1 : 1
        const nextIdx = (aiState.focusedPaneIdx + dir + aiState.paneSessionIds.length) % aiState.paneSessionIds.length
        void aiState.focusPane(nextIdx)
        settingsState.setActiveTab('ai')
        return
      }
      if (/^[1-3]$/.test(key) && !e.shiftKey && !e.altKey && aiState.paneSessionIds.length > 1) {
        const index = Number(key) - 1
        if (index < aiState.paneSessionIds.length) {
          e.preventDefault()
          void aiState.focusPane(index)
          settingsState.setActiveTab('ai')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createSession, selectSession, closePtyTab])

  if (!loaded) {
    return (
      <div
        className="h-screen w-screen flex flex-col items-center justify-center gap-3 text-xs"
        style={{ backgroundColor: '#0E1117', color: '#8B949E' }}
      >
        <img src={appAvatar} alt="Multi-Agent Studio" className="w-12 h-12 rounded-xl animate-pulse" />
        <span>Đang khởi động Multi-Agent Studio…</span>
      </div>
    )
  }

  const activeWorkspaceTab = wsTabs.find((t) => t.id === activeWsTabId)

  return (
    <AppErrorBoundary>
      <AppShell>
        {activeTab === 'ai' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {activeWorkspaceTab && activeWorkspaceTab.kind !== 'session' && (
              <div
                className="h-9 shrink-0 px-3 border-b flex items-center justify-between text-xs"
                style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      const curSessId = useAiStore.getState().activeSessionId
                      const sess = useAiStore.getState().sessions.find((s) => s.id === curSessId)
                      if (sess) useWorkspaceTabsStore.getState().openSessionTab(sess)
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border btn-ghost cursor-pointer shrink-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Quay lại Chat</span>
                  </button>
                  <span className="font-semibold truncate">{activeWorkspaceTab.title}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const tabsStore = useWorkspaceTabsStore.getState()
                    const removed = tabsStore.closeTab(activeWorkspaceTab.id)
                    if (removed?.kind === 'terminal' && removed.ptyId) {
                      void closePtyTab(removed.ptyId)
                    }
                    const curSessId = useAiStore.getState().activeSessionId
                    const sess = useAiStore.getState().sessions.find((s) => s.id === curSessId)
                    if (sess) tabsStore.openSessionTab(sess)
                  }}
                  className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                  title="Đóng chế độ toàn màn hình"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {!sidebarCollapsed && (
                <>
                  <SessionSidebar />
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const startX = e.clientX
                      const startW = useWorkspaceTabsStore.getState().sidebarWidth
                      const onMove = (mv: MouseEvent): void => {
                        const maxAllowed = Math.min(460, Math.max(220, Math.floor(window.innerWidth * 0.42)))
                        const next = Math.max(170, Math.min(maxAllowed, startW + (mv.clientX - startX)))
                        useWorkspaceTabsStore.getState().setSidebarWidth(next)
                      }
                      const onUp = (): void => {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    onDoubleClick={() => useWorkspaceTabsStore.getState().setSidebarWidth(256)}
                    className="w-1 shrink-0 cursor-col-resize hover:bg-indigo-500/50 transition-colors"
                    style={{ backgroundColor: 'var(--border)' }}
                    title="Kéo để chỉnh độ rộng Sidebar (Double-click đặt lại 256px)"
                  />
                </>
              )}
              <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                {!activeWorkspaceTab || activeWorkspaceTab.kind === 'session' ? (
                  <AppErrorBoundary resetKey={activeSessionId ?? ''} compact>
                    <AiWorkstation />
                  </AppErrorBoundary>
                ) : activeWorkspaceTab.kind === 'terminal' ? (
                  <FullTabTerminal tab={activeWorkspaceTab} />
                ) : activeWorkspaceTab.kind === 'git' ? (
                  <GitWorkspace key={activeWorkspaceTab.id} initialDir={activeWorkspaceTab.workspacePath} />
                ) : activeWorkspaceTab.kind === 'governance' ? (
                  <GovernanceStudio />
                ) : activeWorkspaceTab.kind === 'file' && activeWorkspaceTab.workspacePath && activeWorkspaceTab.filePath ? (
                  <FileViewerPanel
                    key={`${activeWorkspaceTab.workspacePath}:${activeWorkspaceTab.filePath}`}
                    workspacePath={activeWorkspaceTab.workspacePath}
                    relPath={activeWorkspaceTab.filePath}
                    fullTab
                  />
                ) : activeWorkspaceTab.kind === 'preview' ? (
                  <LiveWebPreviewPanel initialUrl={activeWorkspaceTab.previewUrl} fullTab />
                ) : (
                  <AiWorkstation />
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'apps' && <AppsWorkspace />}
        {activeTab === 'git' && <GitWorkspace />}
        <DatabaseWorkspace visible={activeTab === 'database'} />
        {activeTab === 'governance' && <GovernanceStudio />}
        {activeTab === 'usage' && <UsageDashboard />}
        {activeTab === 'settings' && <SettingsView />}
      </AppShell>
    </AppErrorBoundary>
  )
}
