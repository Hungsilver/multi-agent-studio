import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { AiWorkstation } from './components/ai/AiWorkstation'
import { UsageDashboard } from './components/analytics/UsageDashboard'
import { GitWorkspace } from './components/git/GitWorkspace'
import { GovernanceStudio } from './components/governance/GovernanceStudio'
import { AppShell } from './components/layout/AppShell'
import { SettingsView } from './components/settings/SettingsView'
import appAvatar from './assets/app-avatar.png'
import { useAiStore } from './stores/useAiStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useTerminalStore } from './stores/useTerminalStore'

interface ErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

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
          className="h-screen w-screen flex flex-col items-center justify-center p-8 text-center gap-4"
          style={{ backgroundColor: '#0E1117', color: '#E6EDF3' }}
        >
          <img src={appAvatar} alt="AI Coding Tool" className="w-12 h-12 rounded-xl" />
          <div className="text-base font-semibold">Đã xảy ra lỗi giao diện</div>
          <pre className="max-w-xl text-xs p-3 rounded-lg bg-black/40 border border-red-500/40 text-red-300 overflow-auto">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-500 text-white cursor-pointer"
          >
            Tải lại giao diện
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function App(): React.JSX.Element {
  const init = useSettingsStore((s) => s.init)
  const loaded = useSettingsStore((s) => s.loaded)
  const activeTab = useSettingsStore((s) => s.activeTab)

  const loadSessions = useAiStore((s) => s.loadSessions)
  const handleStreamEvent = useAiStore((s) => s.handleStreamEvent)
  const handleSessionStatus = useAiStore((s) => s.handleSessionStatus)

  const appendPtyData = useTerminalStore((s) => s.appendData)
  const markPtyExited = useTerminalStore((s) => s.markExited)

  useEffect(() => {
    void init().then(() => loadSessions())
  }, [init, loadSessions])

  useEffect(() => {
    const unsub1 = window.workspaceApi.onAiEvent((p) => handleStreamEvent(p.sessionId, p.turnId, p.event))
    const unsub2 = window.workspaceApi.onAiSessionStatus((p) => handleSessionStatus(p.sessionId, p.status))
    const unsub3 = window.workspaceApi.onPtyData((p) => appendPtyData(p.ptyId, p.data))
    const unsub4 = window.workspaceApi.onPtyExit((p) => markPtyExited(p.ptyId, p.exitCode))
    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
    }
  }, [handleStreamEvent, handleSessionStatus, appendPtyData, markPtyExited])

  if (!loaded) {
    return (
      <div
        className="h-screen w-screen flex flex-col items-center justify-center gap-3 text-xs"
        style={{ backgroundColor: '#0E1117', color: '#8B949E' }}
      >
        <img src={appAvatar} alt="AI Coding Tool" className="w-12 h-12 rounded-xl animate-pulse" />
        <span>Đang khởi động AI Coding Tool…</span>
      </div>
    )
  }

  return (
    <AppErrorBoundary>
      <AppShell>
        {activeTab === 'ai' && <AiWorkstation />}
        {activeTab === 'git' && <GitWorkspace />}
        {activeTab === 'governance' && <GovernanceStudio />}
        {activeTab === 'usage' && <UsageDashboard />}
        {activeTab === 'settings' && <SettingsView />}
      </AppShell>
    </AppErrorBoundary>
  )
}
