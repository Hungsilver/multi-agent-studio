import { BarChart3, BookOpen, Bot, Database, GitBranch, Rocket, Settings } from 'lucide-react'
import { useAiStore } from '../../stores/useAiStore'
import { useAppsStore } from '../../stores/useAppsStore'
import { useSettingsStore, type ActiveNavTab } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'
import { CommandPalette } from './CommandPalette'
import { TitleBar } from './TitleBar'

interface AppShellProps {
  children: React.ReactNode
}

const NAV_ITEMS: Array<{ id: ActiveNavTab; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'ai', label: 'AI Studio', shortLabel: 'AI Studio', icon: Bot },
  { id: 'apps', label: 'Ứng dụng Dev & IIS', shortLabel: 'Ứng dụng', icon: Rocket },
  { id: 'git', label: 'Git', shortLabel: 'Git', icon: GitBranch },
  { id: 'database', label: 'Database', shortLabel: 'Database', icon: Database },
  { id: 'governance', label: 'Skills & Rules', shortLabel: 'Skills', icon: BookOpen },
  { id: 'usage', label: 'Thống kê', shortLabel: 'Thống kê', icon: BarChart3 },
  { id: 'settings', label: 'Cài đặt', shortLabel: 'Cài đặt', icon: Settings }
]

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const activeTab = useSettingsStore((s) => s.activeTab)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)
  const toastMessage = useSettingsStore((s) => s.toastMessage)
  const navRailCollapsed = useWorkspaceTabsStore((s) => s.navRailCollapsed)
  const runningCount = useAiStore((s) => s.sessions.filter((x) => x.status === 'running').length)
  const runningAppsCount = useAppsStore((s) => s.apps.filter((x) => x.running).length)

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      <TitleBar />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Navigation Rail */}
        {!navRailCollapsed && (
          <nav
            aria-label="Thanh điều hướng chính"
            className="w-[74px] shrink-0 border-r flex flex-col items-center py-3 gap-1.5 select-none"
            style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className="relative w-14 py-2 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer btn-ghost"
                  style={{
                    backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--muted)'
                  }}
                  title={item.label}
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span className="text-[10px] font-medium leading-none whitespace-nowrap">{item.shortLabel}</span>
                  {item.id === 'ai' && runningCount > 0 && (
                    <span
                      className="absolute top-1.5 right-2 w-2 h-2 rounded-full animate-pulse"
                      style={{ backgroundColor: 'var(--ok)' }}
                      title={`${runningCount} phiên đang chạy`}
                    />
                  )}
                  {item.id === 'apps' && runningAppsCount > 0 && (
                    <span
                      className="absolute top-1 right-1.5 px-1 rounded-full text-[9px] font-mono font-semibold"
                      style={{ backgroundColor: 'var(--ok)', color: '#fff' }}
                      title={`${runningAppsCount} ứng dụng đang chạy`}
                    >
                      {runningAppsCount}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        )}

        {/* Main Workspace Surface */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{children}</main>
      </div>

      {toastMessage && (
        <div
          data-toast="true"
          className="fixed top-12 left-1/2 -translate-x-1/2 max-w-[80vw] z-[140] px-4 py-2 rounded-xl border shadow-2xl text-xs font-medium pointer-events-none text-center"
          style={{
            backgroundColor: 'var(--surface-elevated)',
            borderColor:
              toastMessage.kind === 'err'
                ? 'var(--err)'
                : toastMessage.kind === 'ok'
                  ? 'var(--ok)'
                  : 'var(--border)',
            color:
              toastMessage.kind === 'err'
                ? 'var(--err)'
                : toastMessage.kind === 'ok'
                  ? 'var(--ok)'
                  : 'var(--text)'
          }}
        >
          {toastMessage.text}
        </div>
      )}

      <CommandPalette />
    </div>
  )
}
