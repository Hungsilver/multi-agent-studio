import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileWarning, GitMerge, Minimize2, RefreshCw, Sparkles, X } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import type { MergeWorktreeResult } from '@shared/types/git'
import type { ThemeName } from '@shared/types/workspace'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { MonacoCodeView } from '../common/MonacoCodeView'
import { MonacoDiffView } from '../common/MonacoDiffView'

interface MergeConflictModalProps {
  result: MergeWorktreeResult
  worktreePath: string | null
  themeName: ThemeName
  onClose: () => void
  onMinimizeToBanner: () => void
  onUpdateResult: (next: MergeWorktreeResult) => void
  onRetryAutoCommitMain: () => Promise<void>
  onAskAiMerge: (prompt: string) => Promise<void>
  onMergedDone: (opts: { removeWorktree: boolean }) => Promise<void>
}

function guessLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    cs: 'csharp',
    py: 'python',
    sql: 'sql'
  }
  return map[ext] ?? 'plaintext'
}

export function MergeConflictModal({
  result,
  worktreePath,
  themeName,
  onClose,
  onMinimizeToBanner,
  onUpdateResult,
  onRetryAutoCommitMain,
  onAskAiMerge,
  onMergedDone
}: MergeConflictModalProps): React.JSX.Element {
  const showToast = useSettingsStore((s) => s.showToast)
  const isDark = THEMES[themeName]?.isDark ?? true
  const monacoTheme = isDark ? 'vs-dark' : 'light'

  const [selectedFile, setSelectedFile] = useState<string>(result.conflicts[0]?.filePath ?? '')
  const [editorTab, setEditorTab] = useState<'edit' | 'diff'>('edit')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [removeAfter, setRemoveAfter] = useState(true)

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, string> = {}
      for (const c of result.conflicts) {
        next[c.filePath] = prev[c.filePath] ?? c.mergedContent
      }
      return next
    })
  }, [result.conflicts])

  useEffect(() => {
    if (result.conflicts.length > 0 && !result.conflicts.some((c) => c.filePath === selectedFile)) {
      setSelectedFile(result.conflicts[0].filePath)
    }
  }, [result.conflicts, selectedFile])

  const activeConflict = useMemo(
    () => result.conflicts.find((c) => c.filePath === selectedFile) ?? result.conflicts[0] ?? null,
    [result.conflicts, selectedFile]
  )

  const handleResolveOne = async (strategy: 'ours' | 'theirs' | 'custom'): Promise<void> => {
    if (!activeConflict) return
    setBusy(true)
    try {
      const content = strategy === 'custom' ? drafts[activeConflict.filePath] ?? activeConflict.mergedContent : undefined
      const { remaining } = await window.workspaceApi.resolveMergeConflictFile(
        result.repoRoot,
        activeConflict.filePath,
        strategy,
        content
      )
      onUpdateResult({ ...result, conflicts: remaining })
      if (remaining.length > 0) {
        setSelectedFile(remaining[0].filePath)
      }
      showToast(`Đã xử lý xung đột file ${activeConflict.filePath}`, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xử lý file xung đột', 'err')
    } finally {
      setBusy(false)
    }
  }

  const handleRefreshStatus = async (): Promise<void> => {
    setBusy(true)
    try {
      const st = await window.workspaceApi.getMergeConflictStatus(result.repoRoot)
      onUpdateResult({ ...result, conflicts: st.conflicts })
      showToast(
        st.conflicts.length === 0 ? 'Tất cả xung đột đã được giải quyết — sẵn sàng Hoàn tất Merge!' : `Còn ${st.conflicts.length} file xung đột`,
        st.conflicts.length === 0 ? 'ok' : 'info'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleFinalize = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.workspaceApi.finalizeWorktreeMerge(
        result.repoRoot,
        'complete',
        `merge: hợp nhất nhánh ${result.sourceBranch} vào ${result.targetBranch}`
      )
      await onMergedDone({ removeWorktree: removeAfter })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không hoàn tất được Merge', 'err')
    } finally {
      setBusy(false)
    }
  }

  const handleAbort = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.workspaceApi.finalizeWorktreeMerge(result.repoRoot, 'abort')
      showToast('Đã hủy Merge và khôi phục nhánh chính sạch sẽ.', 'info')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi hủy Merge', 'err')
    } finally {
      setBusy(false)
    }
  }

  const handleAiResolve = async (): Promise<void> => {
    const fileList = result.conflicts.map((c) => `- ${c.filePath}`).join('\n')
    const prompt = [
      `Đang merge nhánh \`${result.sourceBranch}\` vào \`${result.targetBranch}\` tại \`${result.repoRoot}\` và bị xung đột ở các file sau:`,
      fileList,
      '',
      'Hãy đọc từng file đang chứa conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), hợp nhất logic của cả hai khung sao cho không mất thay đổi của bên nào, ghi lại file sạch sẽ, kiểm tra syntax/test rồi chạy `git add <file>`.'
    ].join('\n')
    onMinimizeToBanner()
    await onAskAiMerge(prompt)
  }

  if (result.status === 'merged') {
    return (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4">
        <div
          role="dialog"
          aria-label="Merge Worktree thành công"
          className="w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 text-xs"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--ok)' }} />
              <span>Merge sạch sẽ — Không có xung đột</span>
            </div>
            <button type="button" onClick={onClose} className="p-1 rounded btn-ghost cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className="p-3 rounded-xl border text-[11.5px] space-y-1"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div className="font-mono font-semibold" style={{ color: 'var(--ok)' }}>
              {result.sourceBranch} → {result.targetBranch}
            </div>
            <div style={{ color: 'var(--muted)' }}>{result.message}</div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={removeAfter}
              onChange={(e) => setRemoveAfter(e.target.checked)}
              disabled={!worktreePath}
            />
            <span>Dọn Worktree &amp; đóng khung phụ ngay</span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setBusy(true)
                void onMergedDone({ removeWorktree: false }).finally(() => setBusy(false))
              }}
              className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              Giữ lại khung &amp; đóng
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void onMergedDone({ removeWorktree: removeAfter }).finally(() => setBusy(false))
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold text-white cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--ok)' }}
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>{busy ? 'Đang hoàn tất…' : 'Hoàn tất'}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (result.status === 'main-dirty') {
    return (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4">
        <div
          className="w-full max-w-lg rounded-2xl border shadow-2xl p-5 space-y-4 text-xs"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <FileWarning className="w-4 h-4" style={{ color: 'var(--warn)' }} />
              <span>Nhánh chính đang có thay đổi chưa commit</span>
            </div>
            <button type="button" onClick={onClose} className="p-1 rounded btn-ghost cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p style={{ color: 'var(--muted)' }}>
            Trước khi merge <code className="font-mono px-1 rounded bg-subtle">{result.sourceBranch}</code> vào{' '}
            <code className="font-mono px-1 rounded bg-subtle">{result.targetBranch}</code>, nhánh chính cần lưu lại các thay đổi hiện tại để không bị mất code và có thể rollback an toàn:
          </p>

          <div
            className="max-h-36 overflow-y-auto rounded-lg border p-2.5 font-mono text-[11px] space-y-1"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            {(result.dirtyFiles ?? []).map((f) => (
              <div key={f} className="truncate">{f}</div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              Để sau
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void onRetryAutoCommitMain().finally(() => setBusy(false))
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold text-white cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>{busy ? 'Đang xử lý…' : 'Tự commit tạm & Tiếp tục Merge'}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const allResolved = result.conflicts.length === 0

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-label="Xử lý xung đột Merge Code"
        className="w-full max-w-5xl h-[82vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden text-xs"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {allResolved ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--ok)' }} />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--warn)' }} />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {allResolved
                  ? 'Đã giải quyết hết xung đột — Sẵn sàng hoàn tất Merge'
                  : `Giải quyết xung đột Merge (${result.conflicts.length} file)`}
              </div>
              <div className="text-[11px] font-mono truncate" style={{ color: 'var(--muted)' }}>
                {result.sourceBranch} → {result.targetBranch}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!allResolved && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAiResolve()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-medium cursor-pointer btn-ghost"
                style={{
                  borderColor: 'color-mix(in srgb, var(--accent) 50%, transparent)',
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent)'
                }}
                title="Thu gọn hộp thoại và gửi file xung đột sang AI để tự hợp nhất"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Nhờ AI tự Merge</span>
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRefreshStatus()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              title="Kiểm tra lại danh sách file xung đột trên Git"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>Kiểm tra lại</span>
            </button>
            <button
              type="button"
              onClick={onMinimizeToBanner}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              title="Thu gọn về thanh trạng thái (giữ nguyên phiên Merge)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Thu gọn</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left File List */}
          <div
            className="w-64 shrink-0 border-r flex flex-col min-h-0"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <div className="px-3 py-2 border-b font-semibold text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              File xung đột còn lại ({result.conflicts.length})
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {result.conflicts.map((c) => {
                const active = activeConflict?.filePath === c.filePath
                return (
                  <button
                    key={c.filePath}
                    type="button"
                    onClick={() => setSelectedFile(c.filePath)}
                    className="w-full text-left px-2.5 py-2 rounded-lg font-mono text-[11px] truncate cursor-pointer btn-ghost"
                    style={{
                      backgroundColor: active ? 'var(--sel)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--muted)'
                    }}
                    title={c.filePath}
                  >
                    {c.filePath}
                  </button>
                )
              })}
              {allResolved && (
                <div className="p-4 text-center space-y-2" style={{ color: 'var(--ok)' }}>
                  <CheckCircle2 className="w-6 h-6 mx-auto" />
                  <div>Không còn file xung đột nào. Hãy bấm &quot;Hoàn tất Merge &amp; Commit&quot; ở bên dưới.</div>
                </div>
              )}
            </div>
          </div>

          {/* Right Conflict Editor / Diff */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {activeConflict ? (
              <>
                <div
                  className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => setEditorTab('edit')}
                      className="px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: editorTab === 'edit' ? 'var(--sel)' : 'transparent',
                        color: editorTab === 'edit' ? 'var(--text)' : 'var(--muted)'
                      }}
                    >
                      Bản Merge (sửa trực tiếp)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorTab('diff')}
                      className="px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: editorTab === 'diff' ? 'var(--sel)' : 'transparent',
                        color: editorTab === 'diff' ? 'var(--text)' : 'var(--muted)'
                      }}
                    >
                      So sánh Nhánh chính ↔ Worktree
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleResolveOne('ours')}
                      className="px-2.5 py-1 rounded-lg border btn-ghost cursor-pointer font-medium"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {worktreePath ? 'Giữ Nhánh chính (Pane 1)' : `Giữ ${result.targetBranch} (Ours)`}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleResolveOne('theirs')}
                      className="px-2.5 py-1 rounded-lg border btn-ghost cursor-pointer font-medium"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {worktreePath ? 'Giữ Worktree (Pane 2)' : `Giữ ${result.sourceBranch} (Theirs)`}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleResolveOne('custom')}
                      className="px-2.5 py-1 rounded-lg font-semibold text-white cursor-pointer"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      Lưu bản đã sửa
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {editorTab === 'edit' ? (
                    <MonacoCodeView
                      key={activeConflict.filePath}
                      value={drafts[activeConflict.filePath] ?? activeConflict.mergedContent}
                      language={guessLang(activeConflict.filePath)}
                      theme={monacoTheme}
                      readOnly={false}
                      onChange={(val) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [activeConflict.filePath]: val
                        }))
                      }
                      onSave={() => void handleResolveOne('custom')}
                    />
                  ) : (
                    <MonacoDiffView
                      original={activeConflict.oursContent}
                      modified={activeConflict.theirsContent}
                      language={guessLang(activeConflict.filePath)}
                      theme={monacoTheme}
                      sideBySide
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2" style={{ color: 'var(--muted)' }}>
                <CheckCircle2 className="w-8 h-8" style={{ color: 'var(--ok)' }} />
                <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  Mọi file xung đột đã được đánh dấu hoàn tất (staged).
                </div>
                <div>Bấm &quot;Hoàn tất Merge &amp; Commit&quot; để chốt vào nhánh {result.targetBranch}.</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t flex items-center justify-between gap-3 shrink-0"
          style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
        >
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--muted)' }}>
            <input
              type="checkbox"
              checked={removeAfter}
              onChange={(e) => setRemoveAfter(e.target.checked)}
              disabled={!worktreePath}
            />
            <span>Dọn Worktree &amp; đóng khung phụ sau khi Merge xong</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAbort()}
              className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
            >
              Hủy Merge (Rollback)
            </button>
            <button
              type="button"
              disabled={busy || !allResolved}
              onClick={() => void handleFinalize()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold text-white cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: 'var(--ok)' }}
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>Hoàn tất Merge &amp; Commit</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
