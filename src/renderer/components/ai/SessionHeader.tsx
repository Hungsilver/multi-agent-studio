import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeftRight,
  Check,
  Code2,
  Columns2,
  FolderOpen,
  GitBranch,
  GitMerge,
  History,
  PanelLeft,
  PanelRight,
  Plus,
  X
} from 'lucide-react'
import { PROVIDERS, PROVIDER_LIST } from '@shared/constants/providers'
import type { ProviderId } from '@shared/types/ai'
import { openInVsCodeWithToast } from '../../lib/os-actions'
import { useAiStore } from '../../stores/useAiStore'
import { getDefaultModelForProvider, useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'

export interface SessionHeaderProps {
  sessionId?: string
  paneIndex?: number
  totalPanes?: number
  isFocused?: boolean
  onFocusPane?: () => void
  onClosePane?: () => void
  onSplitWorktree?: () => void
  onSplitSameFolder?: () => void
  onSplitExistingSession?: (targetSessionId: string) => void
  onMergeWorktree?: (repoRoot: string, worktreePath: string, worktreeBranch: string) => void
}

export function SessionHeader({
  sessionId,
  paneIndex = 0,
  totalPanes = 1,
  isFocused = true,
  onFocusPane,
  onClosePane,
  onSplitWorktree,
  onSplitSameFolder,
  onSplitExistingSession,
  onMergeWorktree
}: SessionHeaderProps = {}): React.JSX.Element | null {
  const detail = useAiStore((s) => (sessionId ? s.detailsBySessionId[sessionId] ?? null : s.activeDetail))
  const sessions = useAiStore((s) => s.sessions)
  const paneSessionIds = useAiStore((s) => s.paneSessionIds)
  const updateSessionMeta = useAiStore((s) => s.updateSessionMeta)
  const switchProvider = useAiStore((s) => s.switchProvider)
  const importClaudeTranscript = useAiStore((s) => s.importClaudeTranscript)

  const wsTabs = useWorkspaceTabsStore((s) => s.tabs)
  const activeWsTabId = useWorkspaceTabsStore((s) => s.activeTabId)
  const toggleInspector = useWorkspaceTabsStore((s) => s.toggleInspector)
  const toggleSidebar = useWorkspaceTabsStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useWorkspaceTabsStore((s) => s.sidebarCollapsed)
  const activeWsTab = wsTabs.find((t) => t.id === activeWsTabId)
  const inspectorOpen = activeWsTab?.inspector.open ?? false
  const inspTabsCount = activeWsTab?.inspector.tabs.length ?? 0

  const cliStatuses = useSettingsStore((s) => s.cliStatuses)
  const showToast = useSettingsStore((s) => s.showToast)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerBtnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const [splitMenuOpen, setSplitMenuOpen] = useState(false)
  const [splitMenuPos, setSplitMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const splitBtnRef = useRef<HTMLButtonElement | null>(null)
  const splitMenuRef = useRef<HTMLDivElement | null>(null)

  const computePortalPos = useCallback((btn: HTMLButtonElement | null, maxWidth = 312): { top: number; left: number; width: number } | null => {
    if (!btn) return null
    const rect = btn.getBoundingClientRect()
    const width = Math.min(maxWidth, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 300))
    return { top, left, width }
  }, [])

  const computeMenuPosition = useCallback((): void => {
    const next = computePortalPos(triggerBtnRef.current, 312)
    if (next) setMenuPos(next)
  }, [computePortalPos])

  const computeSplitPosition = useCallback((): void => {
    const next = computePortalPos(splitBtnRef.current, 320)
    if (next) setSplitMenuPos(next)
  }, [computePortalPos])

  const switcherEventId = `provider-switcher-${sessionId ?? 'active'}`
  const splitEventId = `split-menu-${sessionId ?? 'active'}`

  useEffect(() => {
    const onOtherSelect = (e: Event): void => {
      const custom = e as CustomEvent<string>
      if (custom.detail !== switcherEventId) {
        setProviderMenuOpen(false)
      }
      if (custom.detail !== splitEventId) {
        setSplitMenuOpen(false)
      }
    }
    window.addEventListener('aict:close-selects', onOtherSelect)
    return () => window.removeEventListener('aict:close-selects', onOtherSelect)
  }, [switcherEventId, splitEventId])

  useEffect(() => {
    if (!providerMenuOpen) return
    window.dispatchEvent(new CustomEvent('aict:close-selects', { detail: switcherEventId }))
    computeMenuPosition()

    const onDocDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (triggerBtnRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setProviderMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setProviderMenuOpen(false)
    }
    const onReposition = (): void => computeMenuPosition()

    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [providerMenuOpen, computeMenuPosition, switcherEventId])

  useEffect(() => {
    if (!splitMenuOpen) return
    window.dispatchEvent(new CustomEvent('aict:close-selects', { detail: splitEventId }))
    computeSplitPosition()

    const onDocDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (splitBtnRef.current?.contains(target) || splitMenuRef.current?.contains(target)) {
        return
      }
      setSplitMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSplitMenuOpen(false)
    }
    const onReposition = (): void => computeSplitPosition()

    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [splitMenuOpen, computeSplitPosition, splitEventId])

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

  return (
    <div
      className="@container h-12 shrink-0 px-3 border-b flex items-center justify-between gap-2 overflow-hidden"
      style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
    >
      {/* Left: Sidebar Toggle + Pane Badge + Title & Worktree badge */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {paneIndex === 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleSidebar()
            }}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer shrink-0"
            style={{
              borderColor: sidebarCollapsed ? 'var(--accent)' : 'var(--border)',
              color: sidebarCollapsed ? 'var(--accent)' : 'var(--muted)'
            }}
            title="Ẩn / Hiện Sidebar (Ctrl+B)"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        )}

        {totalPanes > 1 && (
          <span
            onClick={() => onFocusPane?.()}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 cursor-pointer border whitespace-nowrap"
            style={{
              backgroundColor: isFocused ? 'var(--accent-soft)' : 'var(--bg)',
              borderColor: isFocused ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border)',
              color: isFocused ? 'var(--accent)' : 'var(--muted)'
            }}
            title={`Khung làm việc ${paneIndex + 1}`}
          >
            #{paneIndex + 1}
          </span>
        )}
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
            className="px-2 py-0.5 rounded border text-xs font-semibold outline-none w-36 max-w-full"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--accent)', color: 'var(--text)' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setTitleDraft(session.title)
              setEditingTitle(true)
            }}
            className={`${totalPanes > 1 ? 'text-xs min-w-[84px]' : 'text-sm min-w-[60px]'} font-semibold truncate hover:underline text-left cursor-pointer flex-1`}
            title={session.title}
          >
            {session.title}
          </button>
        )}

        {session.worktreeBranch ? (
          <span
            className="@[640px]:inline-flex hidden items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
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
          <span className="@[640px]:inline hidden text-[11px] truncate max-w-[140px] shrink-0" style={{ color: 'var(--muted)' }} title={workDir}>
            {workDir.split(/[\\/]/).filter(Boolean).pop()}
          </span>
        )}
      </div>

      {/* Right: Provider Switcher + View Mode + Quick Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Provider Switcher Pill */}
        <div className="relative shrink-0">
          <button
            ref={triggerBtnRef}
            type="button"
            onClick={() => setProviderMenuOpen((o) => !o)}
            disabled={session.status === 'running'}
            className={`flex items-center gap-1 ${totalPanes > 1 ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1 text-xs'} rounded-lg border font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap`}
            style={{
              backgroundColor: currentMeta.badgeBg,
              borderColor: 'color-mix(in srgb, ' + currentMeta.color + ' 40%, transparent)',
              color: 'var(--text)'
            }}
            title={
              session.status === 'running'
                ? 'Đang chạy — hãy đợi xong hoặc bấm Dừng rồi mới đổi AI Tool'
                : `Đang dùng ${currentMeta.name}. Đổi AI Tool linh hoạt mà vẫn giữ ngữ cảnh phiên`
            }
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: currentMeta.color }} />
            <span className={totalPanes > 1 ? 'hidden @[400px]:inline' : undefined}>
              {totalPanes > 1 ? currentMeta.shortName : currentMeta.name}
            </span>
            <ArrowLeftRight className="w-3 h-3 opacity-75 shrink-0" />
          </button>

          {providerMenuOpen &&
            menuPos &&
            createPortal(
              <div
                ref={menuRef}
                role="menu"
                aria-label="Chọn AI Tool"
                className="fixed z-[120] rounded-xl border shadow-2xl p-1.5"
                style={{
                  top: menuPos.top,
                  left: menuPos.left,
                  width: menuPos.width,
                  backgroundColor: 'var(--surface-elevated)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
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
                  const def = getDefaultModelForProvider(cliStatuses, p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void handleSwitchProvider(p.id)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs btn-ghost cursor-pointer"
                      style={{ backgroundColor: isCurrent ? 'var(--accent-soft)' : 'transparent' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <span>{p.name}</span>
                            {def.model && (
                              <span
                                className="text-[10px] font-mono px-1.5 py-0.2 rounded truncate max-w-[125px]"
                                style={{ backgroundColor: 'var(--bg)', color: 'var(--muted)' }}
                                title={`Model mặc định: ${def.model}${def.source ? ` (${def.source})` : ''}`}
                              >
                                {def.model}
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                            {st?.providerSessionId
                              ? `Có phiên gốc · đồng bộ ${syncedIdx}/${lastIdx}`
                              : 'Khởi tạo từ Context Memory'}
                          </div>
                        </div>
                      </div>
                      {isCurrent ? (
                        <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                      ) : (
                        delta > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            +{delta} lượt
                          </span>
                        )
                      )}
                    </button>
                  )
                })}
              </div>,
              document.body
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

        {session.worktreeBranch && session.worktreePath && onMergeWorktree && (
          <button
            type="button"
            onClick={() => onMergeWorktree(session.workspacePath, session.worktreePath!, session.worktreeBranch!)}
            disabled={session.status === 'running'}
            className={`flex items-center gap-1 ${totalPanes > 1 ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1 text-xs'} rounded-lg border font-medium btn-ghost cursor-pointer shrink-0 disabled:opacity-50`}
            style={{
              borderColor: 'color-mix(in srgb, var(--ok) 45%, transparent)',
              backgroundColor: 'rgba(16, 163, 127, 0.1)',
              color: 'var(--ok)'
            }}
            title={`Merge nhánh ${session.worktreeBranch} vào repo chính & xử lý xung đột`}
          >
            <GitMerge className="w-3 h-3" />
            <span>Merge</span>
          </button>
        )}

        {/* Split Vertically Button & Portal Menu (shown in single-pane or rightmost pane) */}
        {(totalPanes === 1 || paneIndex === totalPanes - 1) && (
          <div className="relative shrink-0">
            <button
              ref={splitBtnRef}
              type="button"
              onClick={() => setSplitMenuOpen((o) => !o)}
              className={`flex items-center gap-1 ${totalPanes > 1 ? 'p-1.5' : 'px-2 py-1'} rounded-lg border text-xs font-medium btn-ghost cursor-pointer shrink-0`}
              style={{
                borderColor: splitMenuOpen ? 'var(--accent)' : 'var(--border)',
                backgroundColor: splitMenuOpen ? 'var(--accent-soft)' : 'transparent',
                color: splitMenuOpen ? 'var(--accent)' : 'var(--text)'
              }}
              title="Mở thêm 1 cửa sổ chat chia dọc để làm việc song song"
            >
              {totalPanes === 1 && <Plus className="w-3 h-3" />}
              <Columns2 className="w-3.5 h-3.5" />
              {totalPanes === 1 && <span className="hidden @[580px]:inline">Chia dọc</span>}
            </button>

          {splitMenuOpen &&
            splitMenuPos &&
            createPortal(
              <div
                ref={splitMenuRef}
                role="menu"
                aria-label="Chia dọc màn hình chat"
                className="fixed z-[120] rounded-xl border shadow-2xl p-1.5 space-y-1 text-xs"
                style={{
                  top: splitMenuPos.top,
                  left: splitMenuPos.left,
                  width: splitMenuPos.width,
                  backgroundColor: 'var(--surface-elevated)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              >
                <div className="px-2.5 py-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                  Mở khung chat song song (chia dọc)
                </div>

                {onSplitWorktree && (
                  <button
                    type="button"
                    onClick={() => {
                      setSplitMenuOpen(false)
                      onSplitWorktree()
                    }}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
                  >
                    <GitBranch className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
                    <div className="min-w-0">
                      <div className="font-medium">Worktree cô lập (Khuyên dùng)</div>
                      <div className="text-[10.5px] leading-snug" style={{ color: 'var(--muted)' }}>
                        Tạo nhánh Git riêng cho khung 2, sửa code song song rồi Merge &amp; giải quyết xung đột.
                      </div>
                    </div>
                  </button>
                )}

                {onSplitSameFolder && (
                  <button
                    type="button"
                    onClick={() => {
                      setSplitMenuOpen(false)
                      onSplitSameFolder()
                    }}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left btn-ghost cursor-pointer"
                  >
                    <Columns2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--info)' }} />
                    <div className="min-w-0">
                      <div className="font-medium">Chung thư mục trực tiếp</div>
                      <div className="text-[10.5px] leading-snug" style={{ color: 'var(--muted)' }}>
                        Giống mở 2 terminal cùng đường dẫn; tự cảnh báo nếu hai khung đụng cùng file.
                      </div>
                    </div>
                  </button>
                )}

                {onSplitExistingSession && sessions.some((s) => !paneSessionIds.includes(s.id)) && (
                  <>
                    <div
                      className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold border-t"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                    >
                      Mở phiên có sẵn bên cạnh
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {sessions
                        .filter((s) => !paneSessionIds.includes(s.id))
                        .slice(0, 6)
                        .map((s) => {
                          const pMeta = PROVIDERS[s.provider]
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setSplitMenuOpen(false)
                                onSplitExistingSession(s.id)
                              }}
                              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pMeta.color }} />
                                <span className="truncate font-medium">{s.title}</span>
                              </div>
                              <span className="text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>
                                {pMeta.shortName}
                              </span>
                            </button>
                          )
                        })}
                    </div>
                  </>
                )}
              </div>,
              document.body
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void openInVsCodeWithToast(workDir)}
          className="@[520px]:inline-flex hidden p-1.5 rounded-lg border btn-ghost cursor-pointer shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Mở bằng VS Code"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.workspaceApi.openInExplorer(workDir)}
          className="@[520px]:inline-flex hidden p-1.5 rounded-lg border btn-ghost cursor-pointer shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Mở thư mục"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>

        {paneIndex === totalPanes - 1 && (
          <button
            type="button"
            onClick={() => toggleInspector()}
            className={`relative flex items-center gap-1 ${totalPanes > 1 ? 'px-1.5 py-1' : 'px-2 py-1.5'} rounded-lg border transition-colors cursor-pointer`}
            style={{
              borderColor: inspectorOpen ? 'var(--accent)' : 'var(--border)',
              backgroundColor: inspectorOpen ? 'var(--accent-soft)' : 'transparent',
              color: inspectorOpen ? 'var(--accent)' : 'var(--muted)'
            }}
            title="Ẩn / Hiện Dynamic Inspector (Ctrl+\)"
          >
            <PanelRight className="w-3.5 h-3.5" />
            {inspTabsCount > 0 && (
              <span className="text-[10px] font-mono leading-none">{inspTabsCount}</span>
            )}
          </button>
        )}

        {totalPanes > 1 && onClosePane && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClosePane()
            }}
            className="p-1 rounded-lg border hover:bg-red-500/20 hover:text-red-400 transition-colors cursor-pointer shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            title="Đóng khung chia dọc này"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
