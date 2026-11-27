import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  CopyPlus,
  Folder,
  FolderPlus,
  GitBranch,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiSession, ProviderId } from '@shared/types/ai'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'
import { CustomSelect } from '../common/CustomSelect'

type SidebarFilter = 'all' | 'running' | 'pinned'

const DEFAULT_TITLE = 'Phiên làm việc mới'

function formatClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'vừa'
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${mins}p`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}g`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}n`
  return `${Math.floor(days / 30)}th`
}

export function SessionSidebar(): React.JSX.Element {
  const sessions = useAiStore((s) => s.sessions)
  const activeSessionId = useAiStore((s) => s.activeSessionId)
  const unreadSessionIds = useAiStore((s) => s.unreadSessionIds)
  const selectSession = useAiStore((s) => s.selectSession)
  const openSessionInSplitPane = useAiStore((s) => s.openSessionInSplitPane)
  const paneSessionIds = useAiStore((s) => s.paneSessionIds)
  const createSession = useAiStore((s) => s.createSession)
  const deleteSession = useAiStore((s) => s.deleteSession)
  const forkSession = useAiStore((s) => s.forkSession)
  const updateSessionMeta = useAiStore((s) => s.updateSessionMeta)

  const wsTabs = useWorkspaceTabsStore((s) => s.tabs)
  const openSessionTab = useWorkspaceTabsStore((s) => s.openSessionTab)
  const sidebarWidth = useWorkspaceTabsStore((s) => s.sidebarWidth)

  const workspaces = useSettingsStore((s) => s.workspaces)
  const settings = useSettingsStore((s) => s.settings)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const showToast = useSettingsStore((s) => s.showToast)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SidebarFilter>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const [newModalOpen, setNewModalOpen] = useState(false)
  const [newWsPath, setNewWsPath] = useState('')
  const [newProvider, setNewProvider] = useState<ProviderId>(settings.defaultProvider)
  const [useWorktree, setUseWorktree] = useState(false)
  const [worktreeSlug, setWorktreeSlug] = useState('')
  const [creating, setCreating] = useState(false)

  const runningCount = useMemo(() => sessions.filter((s) => s.status === 'running').length, [sessions])
  const pinnedCount = useMemo(() => sessions.filter((s) => s.pinned).length, [sessions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((s) => {
      if (filter === 'running' && s.status !== 'running') return false
      if (filter === 'pinned' && !s.pinned) return false
      if (!q) return true
      return (
        s.title.toLowerCase().includes(q) ||
        s.workspacePath.toLowerCase().includes(q) ||
        PROVIDERS[s.provider].name.toLowerCase().includes(q) ||
        (s.worktreeBranch ?? '').toLowerCase().includes(q)
      )
    })
  }, [sessions, search, filter])

  const pinnedSessions = useMemo(
    () => (filter === 'pinned' ? filtered : filtered.filter((s) => s.pinned)),
    [filtered, filter]
  )

  const grouped = useMemo(() => {
    const sourceList = filter === 'pinned' ? [] : filtered.filter((s) => !s.pinned)
    const map = new Map<string, { key: string; path: string; name: string; items: AiSession[] }>()
    for (const s of sourceList) {
      const key = s.workspacePath.toLowerCase()
      if (!map.has(key)) {
        const name = s.workspacePath.split(/[\\/]/).filter(Boolean).pop() || s.workspacePath
        map.set(key, { key, path: s.workspacePath, name, items: [] })
      }
      map.get(key)!.items.push(s)
    }
    return Array.from(map.values())
  }, [filtered, filter])

  const openNewDialog = (): void => {
    const activeWs =
      sessions.find((s) => s.id === activeSessionId)?.workspacePath || workspaces[0]?.path || ''
    setNewWsPath(activeWs)
    setNewProvider(settings.defaultProvider)
    setUseWorktree(false)
    setWorktreeSlug('')
    setNewModalOpen(true)
  }

  const handleCreate = async (): Promise<void> => {
    let targetPath = newWsPath
    if (!targetPath) {
      const picked = await addWorkspace()
      if (!picked) return
      targetPath = picked.path
    }
    setCreating(true)
    try {
      await createSession({
        workspacePath: targetPath,
        provider: newProvider,
        permissionMode: settings.defaultMode,
        useWorktree,
        worktreeBranchName: worktreeSlug.trim() || undefined
      })
      setNewModalOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không tạo được phiên mới', 'err')
    } finally {
      setCreating(false)
    }
  }

  const commitRename = async (sess: AiSession): Promise<void> => {
    const trimmed = editTitle.trim()
    setEditingId(null)
    if (!trimmed || trimmed === sess.title) return
    await updateSessionMeta(sess.id, { title: trimmed })
  }

  const renderSessionRow = (sess: AiSession, showWsSubtitle = false): React.JSX.Element => {
    const active = sess.id === activeSessionId
    const splitIdx = paneSessionIds.indexOf(sess.id)
    const isOpenInSplit = paneSessionIds.length > 1 && splitIdx >= 0
    const unread = Boolean(unreadSessionIds[sess.id]) && !active
    const meta = PROVIDERS[sess.provider]
    const wsName = sess.workspacePath.split(/[\\/]/).filter(Boolean).pop() || sess.workspacePath
    const relTime = formatRelativeTime(sess.updatedAt)
    const isEditing = editingId === sess.id
    const isDefaultTitle = !sess.title.trim() || sess.title === DEFAULT_TITLE
    const displayTitle = isDefaultTitle ? `Phiên mới · ${formatClock(sess.createdAt)}` : sess.title
    const rowBg = active
      ? 'var(--sel)'
      : isOpenInSplit
        ? 'color-mix(in srgb, var(--accent) 7%, transparent)'
        : 'transparent'

    const actionBtn = (
      title: string,
      icon: React.ReactNode,
      onClick: () => void,
      danger = false
    ): React.JSX.Element => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className={`p-1 rounded cursor-pointer ${danger ? 'hover:bg-red-500/20 hover:text-red-400' : 'btn-ghost'}`}
        title={title}
      >
        {icon}
      </button>
    )

    return (
      <div
        key={sess.id}
        role="button"
        tabIndex={0}
        aria-current={active ? 'true' : undefined}
        data-session-id={sess.id}
        data-active={active ? 'true' : 'false'}
        onClick={() => {
          if (isEditing) return
          openSessionTab(sess)
          void selectSession(sess.id)
        }}
        onKeyDown={(e) => {
          if (isEditing || e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openSessionTab(sess)
            void selectSession(sess.id)
          }
        }}
        className="group relative flex flex-col justify-center px-2 py-1.5 rounded-md cursor-pointer transition-colors outline-none focus-visible:ring-1"
        style={{ backgroundColor: rowBg, minHeight: 32 }}
      >
        {active && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
            style={{ backgroundColor: 'var(--accent)' }}
          />
        )}

        <div className="flex items-center gap-2 min-w-0">
          {/* Chip công cụ AI: chữ cái đầu + màu riêng; đang chạy thì có vòng quay */}
          <span
            className="relative w-[18px] h-[18px] rounded-[5px] shrink-0 flex items-center justify-center text-[10px] font-bold leading-none"
            style={{ backgroundColor: meta.badgeBg, color: meta.color }}
            title={`${meta.name}${sess.model ? ` · ${sess.model}` : ''}`}
          >
            {meta.shortName.charAt(0)}
            {sess.status === 'running' && (
              <span
                className="absolute -inset-[2px] rounded-[7px] border-2 border-transparent animate-spin"
                style={{ borderTopColor: 'var(--ok)' }}
              />
            )}
            {sess.status === 'error' && (
              <span
                className="absolute -right-0.5 -bottom-0.5 w-[7px] h-[7px] rounded-full border"
                style={{ backgroundColor: 'var(--err)', borderColor: 'var(--surface)' }}
              />
            )}
          </span>

          {isEditing ? (
            <input
              autoFocus
              value={editTitle}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => void commitRename(sess)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commitRename(sess)
                } else if (e.key === 'Escape') {
                  setEditingId(null)
                }
              }}
              className="flex-1 min-w-0 px-1.5 py-0.5 rounded border text-[12px] outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--accent)', color: 'var(--text)' }}
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingId(sess.id)
                setEditTitle(sess.title)
              }}
              className={`text-[12.5px] truncate flex-1 min-w-0 ${active || unread ? 'font-semibold' : 'font-normal'} ${isDefaultTitle ? 'italic' : ''}`}
              style={{ color: isDefaultTitle && !active ? 'var(--muted)' : 'var(--text)' }}
              title={`${sess.title}\n${meta.name} · ${wsName}\n(Nhấp đúp để đổi tên)`}
            >
              {displayTitle}
            </span>
          )}

          {!isEditing && (
            <div className="shrink-0 flex items-center gap-1.5">
              {isOpenInSplit && (
                <span
                  className="min-w-[16px] h-4 px-1 rounded text-[9.5px] font-mono font-bold flex items-center justify-center"
                  style={{
                    backgroundColor: active ? 'var(--accent)' : 'var(--accent-soft)',
                    color: active ? '#fff' : 'var(--accent)'
                  }}
                  title={`Đang mở ở khung ${splitIdx + 1}`}
                >
                  {splitIdx + 1}
                </span>
              )}
              {sess.pinned && <Pin className="w-3 h-3" style={{ color: 'var(--accent)' }} />}
              {unread && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: 'var(--accent)' }}
                  title="Có phản hồi mới"
                />
              )}
              <span
                className="text-[10px] tabular-nums min-w-[26px] whitespace-nowrap text-right group-hover:invisible"
                style={{ color: 'var(--muted)' }}
              >
                {relTime}
              </span>
            </div>
          )}
        </div>

        {(sess.worktreeBranch || showWsSubtitle) && (
          <div
            className="flex items-center gap-1.5 pl-[26px] pr-1 text-[10.5px] min-w-0 truncate"
            style={{ color: 'var(--muted)' }}
          >
            {showWsSubtitle && <span className="truncate">{wsName}</span>}
            {sess.worktreeBranch && (
              <span
                className="inline-flex items-center gap-0.5 truncate"
                style={{ color: 'var(--accent)' }}
                title={`Worktree: ${sess.worktreeBranch}`}
              >
                <GitBranch className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{sess.worktreeBranch}</span>
              </span>
            )}
          </div>
        )}

        {/* Thao tác hiện khi rê chuột, đè lên cột thời gian (không làm xô layout) */}
        {!isEditing && (
          <div
            className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity absolute right-1 top-1 flex items-center rounded-md px-0.5"
            style={{ backgroundColor: 'var(--surface-elevated)', boxShadow: '0 0 0 1px var(--border)' }}
          >
            {actionBtn('Mở thêm ở khung chia dọc', <Columns2 className="w-3 h-3" />, () =>
              void openSessionInSplitPane(sess.id)
            )}
            {actionBtn('Đổi tên', <Pencil className="w-3 h-3" />, () => {
              setEditingId(sess.id)
              setEditTitle(sess.title)
            })}
            {actionBtn(sess.pinned ? 'Bỏ ghim' : 'Ghim', <Pin className="w-3 h-3" />, () =>
              void updateSessionMeta(sess.id, { pinned: !sess.pinned })
            )}
            {actionBtn('Nhân bản (fork)', <CopyPlus className="w-3 h-3" />, () => void forkSession(sess.id))}
            {actionBtn(
              'Xóa phiên',
              <Trash2 className="w-3 h-3" />,
              () => {
                if (sess.status === 'running') {
                  showToast('Hãy dừng phiên trước khi xóa', 'err')
                  return
                }
                void deleteSession(sess.id)
              },
              true
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      aria-label="Sidebar phiên làm việc"
      className="shrink-0 flex flex-col min-h-0 select-none"
      style={{
        width: `${sidebarWidth}px`,
        backgroundColor: 'var(--surface)'
      }}
    >
      {/* Header: Search + New Session */}
      <div className="p-2.5 border-b space-y-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1.5">
          <div
            className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm phiên, nhánh..."
              className="w-full bg-transparent outline-none text-xs"
              style={{ color: 'var(--text)' }}
            />
          </div>
          <button
            type="button"
            onClick={openNewDialog}
            className="p-1.5 rounded-lg text-white transition-opacity hover:opacity-90 cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--accent)' }}
            title="Phiên AI mới"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Antigravity-style Filter Tabs */}
        <div
          className="grid grid-cols-3 gap-1 p-0.5 rounded-lg border text-[10.5px]"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {(
            [
              { id: 'all', label: 'Tất cả', count: sessions.length },
              { id: 'running', label: 'Chạy', count: runningCount },
              { id: 'pinned', label: 'Ghim', count: pinnedCount }
            ] as const
          ).map((tab) => {
            const selected = filter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className="flex items-center justify-center gap-1 py-1 px-1.5 rounded-md font-medium transition-colors cursor-pointer truncate"
                style={{
                  backgroundColor: selected ? 'var(--surface-elevated)' : 'transparent',
                  color: selected ? 'var(--text)' : 'var(--muted)'
                }}
              >
                <span className="truncate">{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    className="text-[9.5px] px-1 rounded-full tabular-nums"
                    style={{
                      backgroundColor: selected ? 'var(--accent-soft)' : 'transparent',
                      color: selected ? 'var(--accent)' : 'var(--muted)'
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
        {pinnedSessions.length === 0 && grouped.length === 0 && (
          <div className="px-3 py-8 text-center space-y-2.5">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {filter === 'running'
                ? 'Không có phiên nào đang chạy.'
                : filter === 'pinned'
                  ? 'Chưa ghim phiên nào.'
                  : 'Chưa có phiên làm việc nào.'}
            </p>
            {filter === 'all' && (
              <button
                type="button"
                onClick={openNewDialog}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                + Bắt đầu phiên mới
              </button>
            )}
          </div>
        )}

        {/* Pinned Group (Antigravity Inbox / Pinned) */}
        {pinnedSessions.length > 0 && (
          <div className="space-y-0.5">
            <div
              className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              <span className="flex items-center gap-1.5">
                <Pin className="w-3 h-3 shrink-0" />
                <span>Đã ghim ({pinnedSessions.length})</span>
              </span>
            </div>
            {pinnedSessions.map((sess) => renderSessionRow(sess, true))}
          </div>
        )}

        {/* Workspace Collapsible Groups */}
        {grouped.map((grp) => {
          const isCollapsed = Boolean(collapsedGroups[grp.key])
          return (
            <div key={grp.path} className="space-y-0.5">
              <div
                className="group/hd flex items-center justify-between px-1.5 py-1 text-[11px] font-semibold rounded-md btn-ghost"
                style={{ color: 'var(--muted)' }}
                title={grp.path}
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedGroups((prev) => ({ ...prev, [grp.key]: !prev[grp.key] }))
                  }
                  className="flex items-center gap-1 truncate flex-1 text-left cursor-pointer"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  )}
                  <Folder className="w-3 h-3 shrink-0" />
                  <span className="truncate">{grp.name}</span>
                  <span className="text-[10px] opacity-70 font-normal ml-0.5">({grp.items.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void createSession({
                      workspacePath: grp.path,
                      provider: settings.defaultProvider,
                      permissionMode: settings.defaultMode
                    })
                  }
                  className="p-0.5 rounded btn-ghost cursor-pointer shrink-0 opacity-0 group-hover/hd:opacity-100 focus-visible:opacity-100 transition-opacity"
                  title={`Phiên mới trong ${grp.name}`}
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              {!isCollapsed && grp.items.map((sess) => renderSessionRow(sess, false))}
            </div>
          )
        })}
      </div>

      {/* Footer: Add workspace */}
      <div className="p-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() =>
            void addWorkspace().then((ws) => {
              if (ws) {
                void createSession({
                  workspacePath: ws.path,
                  provider: settings.defaultProvider,
                  permissionMode: settings.defaultMode
                })
              }
            })
          }
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs btn-ghost transition-colors cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span className="truncate">Mở thư mục dự án…</span>
        </button>
      </div>

      {/* New Session Dialog */}
      {newModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setNewModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-sm font-semibold">Tạo phiên làm việc AI mới</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                Thư mục dự án (Workspace)
              </label>
              <div className="flex gap-2">
                <CustomSelect
                  value={newWsPath}
                  onChange={setNewWsPath}
                  placeholder={workspaces.length === 0 ? '-- Chưa có thư mục, bấm Duyệt… --' : 'Chọn workspace...'}
                  className="flex-1 min-w-0"
                  menuMinWidth={300}
                  options={
                    workspaces.length === 0
                      ? []
                      : workspaces.map((w) => ({
                          value: w.path,
                          label: w.name,
                          description: w.path
                        }))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    void addWorkspace().then((ws) => {
                      if (ws) setNewWsPath(ws.path)
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
                >
                  Duyệt…
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                Công cụ AI khởi đầu (có thể đổi bất cứ lúc nào giữ 100% ngữ cảnh)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['claude', 'codex', 'agy'] as ProviderId[]).map((pid) => {
                  const m = PROVIDERS[pid]
                  const selected = newProvider === pid
                  return (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => setNewProvider(pid)}
                      className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium cursor-pointer text-left"
                      style={{
                        borderColor: selected ? m.color : 'var(--border)',
                        backgroundColor: selected ? m.badgeBg : 'var(--bg)'
                      }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                      <span className="truncate">{m.shortName}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div
              className="p-3 rounded-lg border space-y-2"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(e) => setUseWorktree(e.target.checked)}
                />
                <span>Cô lập bằng Git Worktree (chạy song song không đè code nhánh chính)</span>
              </label>
              {useWorktree && (
                <input
                  value={worktreeSlug}
                  onChange={(e) => setWorktreeSlug(e.target.value)}
                  placeholder="Tên slug nhánh (vd: feat-payment, để trống tự tạo)"
                  className="w-full px-2.5 py-1.5 rounded border text-xs outline-none"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {creating ? 'Đang tạo…' : 'Tạo phiên'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
