import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Code2,
  Columns2,
  FolderOpen,
  GitBranch,
  History,
  MessageSquare,
  PanelRight,
  TerminalSquare
} from 'lucide-react'
import { PROVIDERS, PROVIDER_LIST } from '@shared/constants/providers'
import type { ProviderId } from '@shared/types/ai'
import { useAiStore, type WorkspaceViewMode } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'

export function SessionHeader(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const viewMode = useAiStore((s) => s.viewMode)
  const setViewMode = useAiStore((s) => s.setViewMode)
  const inspectorOpen = useAiStore((s) => s.inspectorOpen)
  const setInspectorOpen = useAiStore((s) => s.setInspectorOpen)
  const updateSessionMeta = useAiStore((s) => s.updateSessionMeta)
  const switchProvider = useAiStore((s) => s.switchProvider)
  const importClaudeTranscript = useAiStore((s) => s.importClaudeTranscript)

  const openInteractiveAiTab = useTerminalStore((s) => s.openInteractiveAiTab)
  const showToast = useSettingsStore((s) => s.showToast)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocDown = (e: MouseEvent): void => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setProviderMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  if (!detail) return null
  const { session, turns, providerStates } = detail
  const currentMeta = PROVIDERS[session.provider]
  const workDir = session.worktreePath || session.workspacePath

  const handleSaveTitle = async (): Promise<void> => {
    setEditingTitle(false)
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== session.title) {
      await updateSessionMeta(session.id, { title: trimmed })
    }
  }

  const handleSwitchProvider = async (target: ProviderId): Promise<void> => {
    setProviderMenuOpen(false)
    if (target === session.provider) return
    try {
      const unsynced = await switchProvider(session.id, target)
      showToast(
        unsynced > 0
          ? `Đã chuyển sang ${PROVIDERS[target].name} — sẽ tự đồng bộ ${unsynced} lượt ngữ cảnh khi gửi lệnh.`
          : `Đã chuyển sang ${PROVIDERS[target].name}.`,
        'ok'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không đổi được AI tool', 'err')
    }
  }

  const handleOpenTerminal = async (): Promise<void> => {
    try {
      await openInteractiveAiTab(session.id)
      if (viewMode === 'chat') setViewMode('split')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không mở được Interactive Terminal', 'err')
    }
  }

  return (
    <div
      className="h-12 shrink-0 px-4 border-b flex items-center justify-between gap-3"
      style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
    >
      {/* Left: Title & Worktree badge */}
      <div className="flex items-center gap-2.5 min-w-0">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void handleSaveTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSaveTitle()
              if (e.key === 'Escape') setEditingTitle(false)
            }}
            className="px-2 py-0.5 rounded border text-sm font-semibold outline-none w-64"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--accent)', color: 'var(--text)' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setTitleDraft(session.title)
              setEditingTitle(true)
            }}
            className="text-sm font-semibold truncate hover:underline text-left cursor-pointer max-w-[280px]"
            title="Bấm để đổi tên phiên"
          >
            {session.title}
          </button>
        )}

        {session.worktreeBranch ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
            style={{
              backgroundColor: 'var(--accent-soft)',
              borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
              color: 'var(--accent)'
            }}
            title={`Cô lập Worktree: ${session.worktreePath}`}
          >
            <GitBranch className="w-3 h-3" />
            {session.worktreeBranch}
          </span>
        ) : (
          <span className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--muted)' }} title={workDir}>
            {workDir.split(/[\\/]/).filter(Boolean).pop()}
          </span>
        )}
      </div>

      {/* Right: Provider Switcher + View Mode + Quick Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Provider Switcher Pill */}
        <div ref={menuWrapRef} className="relative">
          <button
            type="button"
            onClick={() => setProviderMenuOpen((o) => !o)}
            disabled={session.status === 'running'}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: currentMeta.badgeBg,
              borderColor: 'color-mix(in srgb, ' + currentMeta.color + ' 40%, transparent)',
              color: 'var(--text)'
            }}
            title="Đổi AI Tool linh hoạt mà vẫn giữ 100% ngữ cảnh phiên"
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentMeta.color }} />
            <span>{currentMeta.name}</span>
            <ArrowLeftRight className="w-3 h-3 opacity-75" />
          </button>

          {providerMenuOpen && (
            <div
              className="absolute right-0 mt-1.5 w-72 rounded-xl border shadow-2xl p-1.5 z-40"
              style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
            >
              <div className="px-2.5 py-1.5 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                Đổi AI Tool (giữ 100% ngữ cảnh phiên)
              </div>
              {PROVIDER_LIST.map((p) => {
                const st = providerStates.find((x) => x.provider === p.id)
                const lastIdx = turns[turns.length - 1]?.turnIndex ?? 0
                const syncedIdx = st?.lastSyncedTurnIndex ?? 0
                const delta = Math.max(0, lastIdx - syncedIdx)
                const isCurrent = p.id === session.provider
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void handleSwitchProvider(p.id)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs btn-ghost cursor-pointer"
                    style={{ backgroundColor: isCurrent ? 'var(--sel)' : 'transparent' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                          {st?.providerSessionId
                            ? `Có phiên gốc · đồng bộ ${syncedIdx}/${lastIdx}`
                            : 'Khởi tạo từ Context Memory'}
                        </div>
                      </div>
                    </div>
                    {!isCurrent && delta > 0 && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        +{delta} lượt
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Import V1 Claude Transcript shortcut if empty */}
        {session.provider === 'claude' && session.providerSessionId && turns.length === 0 && (
          <button
            type="button"
            onClick={() => void importClaudeTranscript(session.id)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border text-xs btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--info)' }}
            title="Nạp lại lịch sử hội thoại Claude Code từ ~/.claude"
          >
            <History className="w-3.5 h-3.5" />
            <span>Nạp lịch sử</span>
          </button>
        )}

        {/* Chat / Split / Terminal mode toggle */}
        <div
          className="flex items-center rounded-lg border p-0.5"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {(
            [
              { id: 'chat', icon: MessageSquare, label: 'Chat' },
              { id: 'split', icon: Columns2, label: 'Chia đôi' },
              { id: 'terminal', icon: TerminalSquare, label: 'Terminal' }
            ] as Array<{ id: WorkspaceViewMode; icon: typeof MessageSquare; label: string }>
          ).map((m) => {
            const Icon = m.icon
            const active = viewMode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setViewMode(m.id)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: active ? 'var(--sel)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--muted)'
                }}
                title={m.label}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{m.label}</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => void handleOpenTerminal()}
          className="px-2.5 py-1 rounded-lg border text-xs btn-ghost cursor-pointer flex items-center gap-1"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          title="Mở Interactive CLI (--resume) trong Terminal nhúng"
        >
          <TerminalSquare className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">CLI Tương tác</span>
        </button>

        <button
          type="button"
          onClick={() => void window.workspaceApi.openInVsCode(workDir)}
          className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Mở bằng VS Code"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.workspaceApi.openInExplorer(workDir)}
          className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Mở thư mục"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setInspectorOpen(!inspectorOpen)}
          className="p-1.5 rounded-lg border transition-colors cursor-pointer"
          style={{
            borderColor: inspectorOpen ? 'var(--accent)' : 'var(--border)',
            backgroundColor: inspectorOpen ? 'var(--accent-soft)' : 'transparent',
            color: inspectorOpen ? 'var(--accent)' : 'var(--muted)'
          }}
          title="Ẩn / Hiện Inspector (Diff, Bộ nhớ phiên, Skills)"
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
