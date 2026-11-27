import { Minus, PanelLeftClose, PanelLeftOpen, Search, Square, X } from 'lucide-react'
import appAvatar from '../../assets/app-avatar.png'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'

export function TitleBar(): React.JSX.Element {
  const setCommandPaletteOpen = useSettingsStore((s) => s.setCommandPaletteOpen)
  const navRailCollapsed = useWorkspaceTabsStore((s) => s.navRailCollapsed)
  const toggleNavRail = useWorkspaceTabsStore((s) => s.toggleNavRail)

  return (
    <header
      className="app-drag h-10 shrink-0 flex items-center justify-between px-3 border-b select-none"
      style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-nav-rail-toggle="true"
          onClick={toggleNavRail}
          className="app-no-drag p-1.5 rounded-md btn-ghost transition-colors cursor-pointer"
          style={{ color: navRailCollapsed ? 'var(--accent)' : 'var(--muted)' }}
          title={navRailCollapsed ? 'Hiện thanh điều hướng trái (Ctrl+Alt+B)' : 'Ẩn thanh điều hướng trái (Ctrl+Alt+B)'}
          aria-label="Ẩn/hiện thanh điều hướng trái"
        >
          {navRailCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
        <img
          src={appAvatar}
          alt="Multi-Agent Studio"
          className="w-6 h-6 rounded-md object-cover shadow-sm"
        />
        <span className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
          Multi-Agent Studio
        </span>
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded border"
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)'
          }}
        >
          AI Workspace
        </span>
      </div>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="app-no-drag flex items-center gap-2 px-3 py-1 rounded-md text-xs border transition-colors cursor-pointer"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--muted)'
        }}
      >
        <Search className="w-3.5 h-3.5" />
        <span>Tìm nhanh phiên, workspace, lệnh...</span>
        <kbd
          className="px-1.5 py-0.5 text-[10px] rounded border ml-4"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
        >
          Ctrl+K
        </kbd>
      </button>

      <div className="app-no-drag flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => void window.workspaceApi.windowMinimize()}
          className="w-9 h-8 flex items-center justify-center rounded btn-ghost transition-colors cursor-pointer"
          style={{ color: 'var(--muted)' }}
          title="Thu nhỏ"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.workspaceApi.windowMaximize()}
          className="w-9 h-8 flex items-center justify-center rounded btn-ghost transition-colors cursor-pointer"
          style={{ color: 'var(--muted)' }}
          title="Phóng to / Khôi phục"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => void window.workspaceApi.windowClose()}
          className="w-9 h-8 flex items-center justify-center rounded hover:bg-red-500/80 hover:text-white transition-colors cursor-pointer"
          style={{ color: 'var(--muted)' }}
          title="Đóng"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  )
}
