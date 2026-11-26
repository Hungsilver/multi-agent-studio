import { useEffect, useMemo, useState } from 'react'
import { Bot, FolderGit2, GitBranch, BookOpen, BarChart3, Settings, Plus, Search } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore, type ActiveNavTab } from '../../stores/useSettingsStore'

interface PaletteItem {
  id: string
  label: string
  hint: string
  icon: React.ReactNode
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useSettingsStore((s) => s.commandPaletteOpen)
  const setOpen = useSettingsStore((s) => s.setCommandPaletteOpen)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)
  const workspaces = useSettingsStore((s) => s.workspaces)
  const settings = useSettingsStore((s) => s.settings)

  const sessions = useAiStore((s) => s.sessions)
  const selectSession = useAiStore((s) => s.selectSession)
  const createSession = useAiStore((s) => s.createSession)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!open)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const navs: Array<{ tab: ActiveNavTab; label: string; icon: React.ReactNode }> = [
      { tab: 'ai', label: 'Chuyển tới AI Coding Studio', icon: <Bot className="w-4 h-4" /> },
      { tab: 'git', label: 'Chuyển tới Git Workspace', icon: <GitBranch className="w-4 h-4" /> },
      { tab: 'governance', label: 'Chuyển tới Skills & AGENTS.md Studio', icon: <BookOpen className="w-4 h-4" /> },
      { tab: 'usage', label: 'Chuyển tới Thống kê Token & Chi phí', icon: <BarChart3 className="w-4 h-4" /> },
      { tab: 'settings', label: 'Chuyển tới Cài đặt & Chẩn đoán CLI', icon: <Settings className="w-4 h-4" /> }
    ]

    const list: PaletteItem[] = navs.map((n) => ({
      id: `nav-${n.tab}`,
      label: n.label,
      hint: 'Điều hướng',
      icon: n.icon,
      run: () => {
        setActiveTab(n.tab)
        setOpen(false)
      }
    }))

    for (const ws of workspaces) {
      list.push({
        id: `new-ws-${ws.id}`,
        label: `Phiên AI mới tại ${ws.name}`,
        hint: ws.path,
        icon: <Plus className="w-4 h-4" />,
        run: () => {
          void createSession({ workspacePath: ws.path, provider: settings.defaultProvider }).then(() => {
            setActiveTab('ai')
            setOpen(false)
          })
        }
      })
    }

    for (const s of sessions) {
      list.push({
        id: `sess-${s.id}`,
        label: s.title,
        hint: `${PROVIDERS[s.provider].shortName} · ${s.workspacePath}`,
        icon: <FolderGit2 className="w-4 h-4" style={{ color: PROVIDERS[s.provider].color }} />,
        run: () => {
          void selectSession(s.id).then(() => {
            setActiveTab('ai')
            setOpen(false)
          })
        }
      })
    }

    const q = query.trim().toLowerCase()
    if (!q) return list.slice(0, 14)
    return list
      .filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q))
      .slice(0, 16)
  }, [workspaces, sessions, query, settings.defaultProvider, createSession, selectSession, setActiveTab, setOpen])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/55 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[620px] max-w-[92vw] rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter' && items[selectedIndex]) {
                e.preventDefault()
                items[selectedIndex].run()
              }
            }}
            placeholder="Tìm phiên làm việc, tạo phiên mới hoặc chuyển trang..."
            className="w-full bg-transparent outline-none text-sm"
            style={{ color: 'var(--text)' }}
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
              Không tìm thấy kết quả phù hợp.
            </div>
          )}
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={item.run}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer"
              style={{
                backgroundColor: idx === selectedIndex ? 'var(--sel)' : 'transparent',
                color: 'var(--text)'
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span style={{ color: 'var(--muted)' }}>{item.icon}</span>
                <span className="text-[13px] font-medium truncate">{item.label}</span>
              </div>
              <span className="text-[11px] truncate max-w-[220px]" style={{ color: 'var(--muted)' }}>
                {item.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
