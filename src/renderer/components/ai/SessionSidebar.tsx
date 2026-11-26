import { useMemo, useState } from 'react'
import { Folder, GitBranch, Pin, Plus, Search, Trash2, CopyPlus, FolderPlus } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiSession, ProviderId } from '@shared/types/ai'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

export function SessionSidebar(): React.JSX.Element {
  const sessions = useAiStore((s) => s.sessions)
  const activeSessionId = useAiStore((s) => s.activeSessionId)
  const selectSession = useAiStore((s) => s.selectSession)
  const createSession = useAiStore((s) => s.createSession)
  const deleteSession = useAiStore((s) => s.deleteSession)
  const forkSession = useAiStore((s) => s.forkSession)
  const updateSessionMeta = useAiStore((s) => s.updateSessionMeta)

  const workspaces = useSettingsStore((s) => s.workspaces)
  const settings = useSettingsStore((s) => s.settings)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const showToast = useSettingsStore((s) => s.showToast)

  const [search, setSearch] = useState('')
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [newWsPath, setNewWsPath] = useState('')
  const [newProvider, setNewProvider] = useState<ProviderId>(settings.defaultProvider)
  const [useWorktree, setUseWorktree] = useState(false)
  const [worktreeSlug, setWorktreeSlug] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.workspacePath.toLowerCase().includes(q) ||
        PROVIDERS[s.provider].name.toLowerCase().includes(q)
    )
  }, [sessions, search])

  const grouped = useMemo(() => {
    const map = new Map<string, { path: string; name: string; items: AiSession[] }>()
    for (const s of filtered) {
      const key = s.workspacePath.toLowerCase()
      if (!map.has(key)) {
        const name = s.workspacePath.split(/[\\/]/).filter(Boolean).pop() || s.workspacePath
        map.set(key, { path: s.workspacePath, name, items: [] })
      }
      map.get(key)!.items.push(s)
    }
    return Array.from(map.values())
  }, [filtered])

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

  return (
    <aside
      className="w-64 shrink-0 border-r flex flex-col min-h-0 select-none"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="p-2.5 border-b flex items-center gap-1.5" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm phiên..."
            className="w-full bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)' }}
          />
        </div>
        <button
          type="button"
          onClick={openNewDialog}
          className="p-1.5 rounded-lg text-white transition-opacity hover:opacity-90 cursor-pointer"
          style={{ backgroundColor: 'var(--accent)' }}
          title="Phiên AI mới"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
        {grouped.length === 0 && (
          <div className="px-3 py-8 text-center space-y-2.5">
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Chưa có phiên làm việc nào.
            </p>
            <button
              type="button"
              onClick={openNewDialog}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              + Bắt đầu phiên mới
            </button>
          </div>
        )}

        {grouped.map((grp) => (
          <div key={grp.path} className="space-y-0.5">
            <div
              className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
              title={grp.path}
            >
              <span className="flex items-center gap-1.5 truncate">
                <Folder className="w-3 h-3 shrink-0" />
                <span className="truncate">{grp.name}</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  void createSession({
                    workspacePath: grp.path,
                    provider: settings.defaultProvider,
                    permissionMode: settings.defaultMode
                  })
                }
                className="p-0.5 rounded btn-ghost cursor-pointer"
                title={`Phiên mới trong ${grp.name}`}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {grp.items.map((sess) => {
              const active = sess.id === activeSessionId
              const meta = PROVIDERS[sess.provider]
              return (
                <div
                  key={sess.id}
                  onClick={() => void selectSession(sess.id)}
                  className="group relative flex flex-col gap-1 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--sel)' : 'transparent'
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {sess.status === 'running' ? (
                      <span
                        className="w-2 h-2 rounded-full shrink-0 animate-ping"
                        style={{ backgroundColor: 'var(--ok)' }}
                        title="Đang chạy"
                      />
                    ) : (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: sess.status === 'error' ? 'var(--err)' : meta.color }}
                      />
                    )}
                    <span
                      className="text-[12.5px] font-medium truncate flex-1"
                      style={{ color: active ? 'var(--text)' : 'var(--text)' }}
                    >
                      {sess.title}
                    </span>
                    {sess.pinned && <Pin className="w-3 h-3 shrink-0" style={{ color: 'var(--accent)' }} />}
                  </div>

                  <div className="flex items-center justify-between gap-1 text-[10.5px]" style={{ color: 'var(--muted)' }}>
                    <div className="flex items-center gap-1.5 truncate">
                      <span>{meta.shortName}</span>
                      {sess.worktreeBranch && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded border text-[9.5px] truncate max-w-[100px]"
                          style={{
                            borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
                            color: 'var(--accent)'
                          }}
                          title={`Worktree: ${sess.worktreeBranch}`}
                        >
                          <GitBranch className="w-2.5 h-2.5 shrink-0" />
                          {sess.worktreeBranch}
                        </span>
                      )}
                    </div>

                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void updateSessionMeta(sess.id, { pinned: !sess.pinned })
                        }}
                        className="p-1 rounded btn-ghost"
                        title={sess.pinned ? 'Bỏ ghim' : 'Ghim phiên'}
                      >
                        <Pin className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void forkSession(sess.id)
                        }}
                        className="p-1 rounded btn-ghost"
                        title="Nhân bản / Fork phiên"
                      >
                        <CopyPlus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (sess.status === 'running') {
                            showToast('Hãy dừng phiên trước khi xóa', 'err')
                            return
                          }
                          void deleteSession(sess.id)
                        }}
                        className="p-1 rounded hover:bg-red-500/20 hover:text-red-400"
                        title="Xóa phiên"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
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
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium btn-ghost transition-colors cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          <FolderPlus className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          <span>Mở thư mục dự án…</span>
        </button>
      </div>

      {/* New Session Modal */}
      {newModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
          onClick={() => setNewModalOpen(false)}
        >
          <div
            className="w-[460px] max-w-[92vw] rounded-xl border p-5 space-y-4 shadow-2xl"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">Tạo phiên AI Coding mới</h3>

            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                Thư mục dự án (Workspace)
              </label>
              <div className="flex gap-2">
                <select
                  value={newWsPath}
                  onChange={(e) => setNewWsPath(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  {workspaces.length === 0 && <option value="">(Chọn thư mục...)</option>}
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.path}>
                      {w.name} — {w.path}
                    </option>
                  ))}
                </select>
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
              <div className="grid grid-cols-2 gap-2">
                {(['claude', 'codex', 'agy', 'gemini'] as ProviderId[]).map((pid) => {
                  const m = PROVIDERS[pid]
                  const selected = newProvider === pid
                  return (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => setNewProvider(pid)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer text-left"
                      style={{
                        borderColor: selected ? m.color : 'var(--border)',
                        backgroundColor: selected ? m.badgeBg : 'var(--bg)'
                      }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                      <span>{m.name}</span>
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
