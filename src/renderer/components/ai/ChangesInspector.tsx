import { useEffect, useState } from 'react'
import { Check, GitCommit, GitMerge, Maximize2, RefreshCw, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import type { FileChange } from '@shared/types/git'
import { THEMES } from '@shared/constants/themes'
import { detectMonacoLanguage } from '../../lib/monaco-setup'
import { useAiStore } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { MonacoDiffView } from '../common/MonacoDiffView'

export function ChangesInspector(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const selectedTurnForDiff = useAiStore((s) => s.selectedTurnForDiff)
  const setSelectedTurnForDiff = useAiStore((s) => s.setSelectedTurnForDiff)

  const summary = useGitStore((s) => s.summary)
  const changes = useGitStore((s) => s.changes)
  const activeDiff = useGitStore((s) => s.activeDiff)
  const refreshWorking = useGitStore((s) => s.refreshWorking)
  const openWorkingDiff = useGitStore((s) => s.openWorkingDiff)
  const openTurnFileDiff = useGitStore((s) => s.openTurnFileDiff)
  const clearDiff = useGitStore((s) => s.clearDiff)

  const themeName = useSettingsStore((s) => s.settings.theme)
  const showToast = useSettingsStore((s) => s.showToast)
  const isDark = THEMES[themeName]?.isDark ?? true

  const [turnFiles, setTurnFiles] = useState<FileChange[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [diffModalOpen, setDiffModalOpen] = useState(false)

  const session = detail?.session
  const workDir = session ? session.worktreePath || session.workspacePath : ''
  const selectedTurn = detail?.turns.find((t) => t.id === selectedTurnForDiff) ?? null

  useEffect(() => {
    if (workDir) {
      void refreshWorking(workDir)
    }
  }, [workDir, detail?.turns.length, session?.status, refreshWorking])

  // Tự động chọn file đầu tiên để hiện Monaco Diff nếu chưa chọn file nào
  useEffect(() => {
    if (!selectedTurn && workDir && changes.length > 0 && !activeDiff) {
      void openWorkingDiff(workDir, changes[0])
    }
  }, [selectedTurn, workDir, changes, activeDiff, openWorkingDiff])

  useEffect(() => {
    if (!workDir || !selectedTurn?.preTreeHash) {
      setTurnFiles([])
      return
    }
    void window.workspaceApi.getTurnDiff(workDir, selectedTurn.preTreeHash, selectedTurn.postTreeHash).then(setTurnFiles)
  }, [workDir, selectedTurn])

  if (!session) return null

  const displayedFiles = selectedTurn ? turnFiles : changes

  const handleStageAllAndCommit = async (): Promise<void> => {
    if (!commitMsg.trim()) {
      showToast('Nhập commit message trước', 'err')
      return
    }
    try {
      await window.workspaceApi.stageFiles(workDir, [], true, true)
      const out = await window.workspaceApi.commitChanges(workDir, commitMsg)
      setCommitMsg('')
      await refreshWorking(workDir)
      showToast(out, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Commit thất bại', 'err')
    }
  }

  const handleMergeWorktree = async (): Promise<void> => {
    if (!session.worktreeBranch) return
    try {
      const msg = await window.workspaceApi.mergeWorktreeToCurrent(session.workspacePath, session.worktreeBranch)
      showToast(msg, 'ok')
      await refreshWorking(workDir)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Merge worktree thất bại', 'err')
    }
  }

  const handleRevertOne = async (c: FileChange): Promise<void> => {
    try {
      if (selectedTurn?.preTreeHash) {
        await window.workspaceApi.restoreFileFromTurn(session.id, selectedTurn.id, c.path)
      } else {
        await window.workspaceApi.revertWorkingFile(workDir, c)
      }
      await refreshWorking(workDir)
      showToast(`Đã hoàn tác ${c.path}`, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Hoàn tác thất bại', 'err')
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header / Turn filter */}
      <div className="p-2.5 border-b space-y-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold truncate">
            {summary?.isRepo ? `${summary.branch} (+${summary.addedLines} / -${summary.deletedLines})` : 'Thư mục không phải Git'}
          </div>
          <button
            type="button"
            onClick={() => void refreshWorking(workDir)}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Làm mới Git"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <select
          value={selectedTurnForDiff ?? ''}
          onChange={(e) => {
            clearDiff()
            setSelectedTurnForDiff(e.target.value || null)
          }}
          className="w-full px-2 py-1 rounded-lg border text-xs outline-none"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          <option value="">Tất cả thay đổi hiện tại (Working Tree)</option>
          {(detail?.turns ?? [])
            .filter((t) => Boolean(t.preTreeHash))
            .map((t) => (
              <option key={t.id} value={t.id}>
                Chỉ lượt #{t.turnIndex}: {t.userPrompt.slice(0, 32)}
              </option>
            ))}
        </select>

        {session.worktreeBranch && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void handleMergeWorktree()}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border text-[11px] font-medium btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--ok)' }}
            >
              <GitMerge className="w-3 h-3" />
              Merge về repo chính
            </button>
            <button
              type="button"
              onClick={() => {
                if (session.worktreePath && window.confirm('Xóa Worktree này?')) {
                  void window.workspaceApi.removeWorktree(session.workspacePath, session.worktreePath, false).then(() => {
                    showToast('Đã xóa Worktree', 'ok')
                  })
                }
              }}
              className="p-1 rounded border hover:bg-red-500/20 cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
              title="Xóa Worktree"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 min-h-[120px]">
        {displayedFiles.length === 0 && (
          <div className="py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
            Không có file thay đổi nào.
          </div>
        )}
        {displayedFiles.map((c, idx) => {
          const isSelected = activeDiff?.path === c.path
          return (
            <div
              key={`${c.path}-${c.staged}-${idx}`}
              onClick={() => {
                if (selectedTurn?.preTreeHash) {
                  void openTurnFileDiff(workDir, selectedTurn.preTreeHash, selectedTurn.postTreeHash, c.path)
                } else {
                  void openWorkingDiff(workDir, c)
                }
              }}
              className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors"
              style={{ backgroundColor: isSelected ? 'var(--sel)' : 'transparent' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="font-mono text-[10.5px] font-bold w-4 text-center shrink-0"
                  style={{
                    color: c.code === 'D' ? 'var(--err)' : c.code === '?' || c.code === 'A' ? 'var(--ok)' : 'var(--warn)'
                  }}
                >
                  {c.code}
                </span>
                <span className="truncate font-mono text-[11.5px]" title={c.path}>
                  {c.path}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {c.staged && (
                  <span title="Đã stage">
                    <Check className="w-3 h-3" style={{ color: 'var(--ok)' }} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleRevertOne(c)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded btn-ghost"
                  style={{ color: 'var(--warn)' }}
                  title="Hoàn tác file này"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Inline Monaco Preview if file selected */}
      {activeDiff && (
        <div className="h-56 border-t flex flex-col" style={{ borderColor: 'var(--border)' }}>
          <div
            className="px-2.5 py-1 flex items-center justify-between text-[11px] border-b"
            style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
          >
            <span className="font-mono truncate">{activeDiff.path}</span>
            <button
              type="button"
              onClick={() => setDiffModalOpen(true)}
              className="flex items-center gap-1 hover:underline cursor-pointer shrink-0"
              style={{ color: 'var(--accent)' }}
            >
              <Maximize2 className="w-3 h-3" />
              <span>Phóng to</span>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <MonacoDiffView
              original={activeDiff.original}
              modified={activeDiff.modified}
              language={detectMonacoLanguage(activeDiff.path)}
              theme={isDark ? 'vs-dark' : 'light'}
              sideBySide={false}
              fontSize={11.5}
            />
          </div>
        </div>
      )}

      {/* Quick Commit */}
      {summary?.isRepo && !selectedTurn && changes.length > 0 && (
        <div className="p-2.5 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--muted)' }}>
            <span>Commit nhanh ({changes.length} file)</span>
            <button
              type="button"
              onClick={() => {
                const sample = changes.slice(0, 3).map((c) => c.path.split(/[\\/]/).pop()).join(', ')
                const prefix = changes.every((c) => c.code === '?' || c.code === 'A') ? 'feat' : 'chore'
                setCommitMsg(`${prefix}: update ${sample}${changes.length > 3 ? ` (+${changes.length - 3} files)` : ''}`)
              }}
              className="inline-flex items-center gap-1 hover:underline cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              <Sparkles className="w-3 h-3" />
              <span>Gợi ý message</span>
            </button>
          </div>
          <textarea
            rows={2}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message (sẽ stage tất cả & commit)..."
            className="w-full p-2 rounded-lg border text-xs outline-none resize-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => void handleStageAllAndCommit()}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Stage All &amp; Commit</span>
          </button>
        </div>
      )}

      {/* Fullscreen Diff Modal */}
      {diffModalOpen && activeDiff && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setDiffModalOpen(false)}
        >
          <div
            className="w-full h-full max-w-6xl rounded-xl border flex flex-col overflow-hidden shadow-2xl"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-4 py-2.5 border-b flex items-center justify-between"
              style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
            >
              <span className="font-mono text-xs font-semibold">{activeDiff.path}</span>
              <button type="button" onClick={() => setDiffModalOpen(false)} className="p-1 rounded btn-ghost cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <MonacoDiffView
                original={activeDiff.original}
                modified={activeDiff.modified}
                language={detectMonacoLanguage(activeDiff.path)}
                theme={isDark ? 'vs-dark' : 'light'}
                sideBySide={true}
                fontSize={12.5}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
