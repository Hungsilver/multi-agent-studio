import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Code2,
  Columns2,
  FileCode2,
  GitCommit,
  Minus,
  Plus,
  RotateCcw,
  Search
} from 'lucide-react'
import type { DiffResult, FileChange, HunkAction, RepoOperationState } from '@shared/types/git'
import { parseUnifiedDiff } from '@shared/utils/diff-hunks'
import { detectMonacoLanguage } from '../../lib/monaco-setup'
import { openInVsCodeWithToast } from '../../lib/os-actions'
import { MonacoDiffView } from '../common/MonacoDiffView'

interface GitWorkingCopyViewProps {
  repoDir: string
  changes: FileChange[]
  selectedFile: FileChange | null
  activeDiff: DiffResult | null
  opState: RepoOperationState | null
  isDark: boolean
  onSelectFile: (change: FileChange) => void
  onStageFiles: (paths: string[], stage: boolean, all?: boolean) => Promise<void>
  onDiscardFile: (change: FileChange) => Promise<void>
  onApplyHunk: (filePath: string, staged: boolean, action: HunkAction, hunkIndex: number) => Promise<void>
  onCommit: (message: string, opts: { amend: boolean; pushAfter: boolean }) => Promise<boolean>
  onResolveConflicts: () => void
  onOpAction: (op: 'merge' | 'rebase' | 'cherry-pick' | 'revert', action: 'continue' | 'abort') => Promise<void>
}

export function GitWorkingCopyView({
  repoDir,
  changes,
  selectedFile,
  activeDiff,
  opState,
  isDark,
  onSelectFile,
  onStageFiles,
  onDiscardFile,
  onApplyHunk,
  onCommit,
  onResolveConflicts,
  onOpAction
}: GitWorkingCopyViewProps): React.JSX.Element {
  const [filterText, setFilterText] = useState('')
  const [diffMode, setDiffMode] = useState<'hunks' | 'sideBySide'>('hunks')
  const [commitMsg, setCommitMsg] = useState('')
  const [amend, setAmend] = useState(false)
  const [pushAfter, setPushAfter] = useState(false)
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return changes
    return changes.filter((c) => c.path.toLowerCase().includes(q))
  }, [changes, filterText])

  const stagedFiles = useMemo(() => filtered.filter((c) => c.staged), [filtered])
  const unstagedFiles = useMemo(() => filtered.filter((c) => !c.staged), [filtered])
  const conflictCount = useMemo(() => changes.filter((c) => c.code === 'U').length, [changes])

  const parsedHunks = useMemo(
    () => (activeDiff?.unifiedDiff ? parseUnifiedDiff(activeDiff.unifiedDiff) : null),
    [activeDiff?.unifiedDiff]
  )

  const firstLineLen = (commitMsg.split(/\r?\n/)[0] || '').length

  const handleToggleAmend = async (checked: boolean): Promise<void> => {
    setAmend(checked)
    if (checked && !commitMsg.trim() && repoDir) {
      const lastMsg = await window.workspaceApi.getLastCommitMessage(repoDir)
      if (lastMsg) setCommitMsg(lastMsg)
    }
  }

  const submitCommit = async (): Promise<void> => {
    if (!commitMsg.trim() || (!amend && stagedFiles.length === 0 && changes.filter((c) => c.staged).length === 0)) return
    setBusy(true)
    try {
      const ok = await onCommit(commitMsg, { amend, pushAfter })
      if (ok) {
        setCommitMsg('')
        setAmend(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const renderFileRow = (c: FileChange, idx: number): React.JSX.Element => {
    const isSelected = selectedFile?.path === c.path && selectedFile?.staged === c.staged
    const codeColor =
      c.code === 'U'
        ? 'var(--err)'
        : c.code === 'D'
          ? 'var(--err)'
          : c.staged
            ? 'var(--ok)'
            : c.code === '?' || c.code === 'A'
              ? 'var(--info)'
              : 'var(--warn)'

    return (
      <div
        key={`${c.path}-${c.staged}-${idx}`}
        onClick={() => onSelectFile(c)}
        className="group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border cursor-pointer btn-ghost text-xs"
        style={{
          backgroundColor: isSelected ? 'var(--sel)' : 'var(--bg)',
          borderColor: isSelected ? 'var(--accent)' : 'var(--border)'
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-mono font-bold w-3.5 text-center shrink-0" style={{ color: codeColor }}>
            {c.code}
          </span>
          <span className="truncate font-mono text-[11px]" title={c.path}>
            {c.path}
          </span>
          {(c.additions !== undefined || c.deletions !== undefined) && (
            <span className="text-[10px] font-mono shrink-0 opacity-75">
              <span style={{ color: 'var(--ok)' }}>+{c.additions ?? 0}</span>{' '}
              <span style={{ color: 'var(--err)' }}>-{c.deletions ?? 0}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!c.staged && c.code !== 'U' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (window.confirm(`Hoàn tác (Discard) mọi thay đổi chưa stage trong "${c.path}"?`)) {
                  void onDiscardFile(c)
                }
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
              title="Discard (Hoàn tác thay đổi file này)"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void onStageFiles([c.path], !c.staged)
            }}
            className="px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-pointer btn-ghost"
            style={{
              borderColor: 'var(--border)',
              color: c.staged ? 'var(--muted)' : 'var(--ok)'
            }}
            title={c.staged ? 'Bỏ Stage (Unstage)' : 'Stage file này'}
          >
            {c.staged ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Active Git Operation / Conflict Banner */}
      {((opState && opState.state !== 'none') || conflictCount > 0) && (
        <div
          className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs shrink-0"
          style={{
            backgroundColor: conflictCount > 0 ? 'var(--err-bg)' : 'var(--accent-soft)',
            borderColor: conflictCount > 0 ? 'var(--err)' : 'var(--accent)',
            color: 'var(--text)'
          }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: conflictCount > 0 ? 'var(--err)' : 'var(--accent)' }} />
            <span>
              <strong>
                {opState?.state && opState.state !== 'none'
                  ? `Đang tiến hành ${opState.state.toUpperCase()}`
                  : 'Đang có xung đột Merge'}
              </strong>
              {conflictCount > 0 ? ` — Còn ${conflictCount} file xung đột cần xử lý.` : ' — Có thể Tiếp tục hoặc Hủy.'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {conflictCount > 0 && (
              <button
                type="button"
                onClick={onResolveConflicts}
                className="px-2.5 py-1 rounded-md text-white font-semibold cursor-pointer"
                style={{ backgroundColor: 'var(--err)' }}
              >
                Giải quyết xung đột ({conflictCount})
              </button>
            )}
            {opState && opState.state !== 'none' && (
              <>
                <button
                  type="button"
                  disabled={conflictCount > 0}
                  onClick={() => void onOpAction(opState.state as 'merge' | 'rebase' | 'cherry-pick' | 'revert', 'continue')}
                  className="px-2.5 py-1 rounded-md border font-medium cursor-pointer disabled:opacity-40"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                >
                  Tiếp tục ({opState.state})
                </button>
                <button
                  type="button"
                  onClick={() => void onOpAction(opState.state as 'merge' | 'rebase' | 'cherry-pick' | 'revert', 'abort')}
                  className="px-2.5 py-1 rounded-md border font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--err)' }}
                >
                  Hủy ({opState.state})
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Split Left (Staged/Unstaged Lists) + Right (Hunk/Monaco Diff Viewer) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* File Lists */}
        <div
          className="w-80 shrink-0 border-r flex flex-col min-h-0"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Lọc file thay đổi..."
                className="w-full bg-transparent outline-none text-xs"
                style={{ color: 'var(--text)' }}
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 divide-y" style={{ borderColor: 'var(--border)' }}>
            {/* Staged Files */}
            <div className="flex-1 flex flex-col min-h-0 p-2 space-y-1.5 overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span style={{ color: 'var(--ok)' }}>Staged Files ({stagedFiles.length})</span>
                {stagedFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void onStageFiles([], false, true)}
                    className="px-1.5 py-0.5 rounded border text-[10px] btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Unstage All
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {stagedFiles.length === 0 ? (
                  <div className="text-[11px] py-4 text-center" style={{ color: 'var(--muted)' }}>
                    Chưa có file nào được Stage
                  </div>
                ) : (
                  stagedFiles.map(renderFileRow)
                )}
              </div>
            </div>

            {/* Unstaged Files */}
            <div className="flex-1 flex flex-col min-h-0 p-2 space-y-1.5 overflow-hidden">
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span style={{ color: 'var(--warn)' }}>Unstaged Files ({unstagedFiles.length})</span>
                {unstagedFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void onStageFiles([], true, true)}
                    className="px-1.5 py-0.5 rounded border text-[10px] btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--ok)' }}
                  >
                    Stage All
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {unstagedFiles.length === 0 ? (
                  <div className="text-[11px] py-4 text-center" style={{ color: 'var(--muted)' }}>
                    {stagedFiles.length > 0 ? 'Không còn file Unstaged' : 'Working tree sạch!'}
                  </div>
                ) : (
                  unstagedFiles.map(renderFileRow)
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Diff / Hunk Staging Pane */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0" style={{ backgroundColor: 'var(--bg)' }}>
          {selectedFile && activeDiff ? (
            <>
              <div
                className="px-3 py-1.5 border-b flex items-center justify-between gap-2 text-xs shrink-0"
                style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
                    style={{
                      backgroundColor: selectedFile.staged ? 'rgba(16,163,127,0.16)' : 'rgba(245,158,11,0.16)',
                      color: selectedFile.staged ? 'var(--ok)' : 'var(--warn)'
                    }}
                  >
                    {selectedFile.staged ? 'STAGED' : 'UNSTAGED'}
                  </span>
                  <span className="font-mono truncate">{activeDiff.path}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div
                    className="flex items-center rounded-md border p-0.5"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setDiffMode('hunks')}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer"
                      style={{
                        backgroundColor: diffMode === 'hunks' ? 'var(--sel)' : 'transparent',
                        color: diffMode === 'hunks' ? 'var(--text)' : 'var(--muted)'
                      }}
                    >
                      <FileCode2 className="w-3 h-3" />
                      <span>Hunk / Patch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiffMode('sideBySide')}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer"
                      style={{
                        backgroundColor: diffMode === 'sideBySide' ? 'var(--sel)' : 'transparent',
                        color: diffMode === 'sideBySide' ? 'var(--text)' : 'var(--muted)'
                      }}
                    >
                      <Columns2 className="w-3 h-3" />
                      <span>Side-by-Side</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => void onStageFiles([selectedFile.path], !selectedFile.staged)}
                    className="px-2 py-1 rounded-md border text-[11px] font-medium btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: selectedFile.staged ? 'var(--muted)' : 'var(--ok)' }}
                  >
                    {selectedFile.staged ? 'Unstage File' : 'Stage File'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void openInVsCodeWithToast(`${repoDir}\\${selectedFile.path.replace(/\//g, '\\')}`)}
                    className="p-1 rounded-md border btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                    title="Mở trong VS Code"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                {activeDiff.isBinary ? (
                  <div className="p-6 text-center text-xs" style={{ color: 'var(--muted)' }}>
                    {activeDiff.modified || 'File nhị phân không thể hiển thị diff.'}
                  </div>
                ) : diffMode === 'sideBySide' || !parsedHunks || parsedHunks.hunks.length === 0 ? (
                  <div className="h-full min-h-[240px]">
                    <MonacoDiffView
                      original={activeDiff.original}
                      modified={activeDiff.modified}
                      language={detectMonacoLanguage(activeDiff.path)}
                      theme={isDark ? 'vs-dark' : 'light'}
                      sideBySide
                      fontSize={12}
                    />
                  </div>
                ) : (
                  <div className="p-3 space-y-3 font-mono text-[11.5px]">
                    {parsedHunks.hunks.map((hunk) => (
                      <div
                        key={hunk.index}
                        data-git-hunk={hunk.index}
                        className="rounded-xl border overflow-hidden"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                      >
                        {/* Hunk Header & SourceTree Per-Hunk Action Buttons */}
                        <div
                          className="px-3 py-1.5 border-b flex items-center justify-between gap-2 text-[11px]"
                          style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
                        >
                          <span className="truncate font-mono" style={{ color: 'var(--info)' }}>
                            {hunk.header}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0 font-sans">
                            {!selectedFile.staged ? (
                              <>
                                <button
                                  type="button"
                                  data-hunk-action="stage"
                                  onClick={() => void onApplyHunk(selectedFile.path, false, 'stage', hunk.index)}
                                  className="px-2 py-0.5 rounded border text-[10.5px] font-semibold cursor-pointer btn-ghost"
                                  style={{ borderColor: 'var(--ok)', color: 'var(--ok)' }}
                                >
                                  Stage Hunk
                                </button>
                                <button
                                  type="button"
                                  data-hunk-action="discard"
                                  onClick={() => {
                                    if (window.confirm(`Hoàn tác (Discard) Hunk #${hunk.index + 1} trong ${selectedFile.path}?`)) {
                                      void onApplyHunk(selectedFile.path, false, 'discard', hunk.index)
                                    }
                                  }}
                                  className="px-2 py-0.5 rounded border text-[10.5px] font-semibold cursor-pointer hover:bg-red-500/20"
                                  style={{ borderColor: 'var(--err)', color: 'var(--err)' }}
                                >
                                  Discard Hunk
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                data-hunk-action="unstage"
                                onClick={() => void onApplyHunk(selectedFile.path, true, 'unstage', hunk.index)}
                                className="px-2 py-0.5 rounded border text-[10.5px] font-semibold cursor-pointer btn-ghost"
                                style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
                              >
                                Unstage Hunk
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Diff Lines */}
                        <div className="overflow-x-auto leading-5">
                          {hunk.lines.map((line, lineIdx) => {
                            const bg =
                              line.type === 'add'
                                ? 'rgba(16, 163, 127, 0.14)'
                                : line.type === 'del'
                                  ? 'rgba(239, 68, 68, 0.14)'
                                  : 'transparent'
                            const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
                            const txtColor =
                              line.type === 'add'
                                ? 'var(--ok)'
                                : line.type === 'del'
                                  ? 'var(--err)'
                                  : 'var(--text)'
                            return (
                              <div
                                key={lineIdx}
                                className="flex items-stretch whitespace-pre"
                                style={{ backgroundColor: bg }}
                              >
                                <span
                                  className="w-10 px-1.5 text-right select-none shrink-0 border-r opacity-50"
                                  style={{ borderColor: 'var(--border)' }}
                                >
                                  {line.oldLine ?? ''}
                                </span>
                                <span
                                  className="w-10 px-1.5 text-right select-none shrink-0 border-r opacity-50"
                                  style={{ borderColor: 'var(--border)' }}
                                >
                                  {line.newLine ?? ''}
                                </span>
                                <span className="px-2 flex-1" style={{ color: txtColor }}>
                                  {prefix}
                                  {line.content}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-xs gap-1.5" style={{ color: 'var(--muted)' }}>
              <Check className="w-6 h-6 opacity-50" />
              <span>Chọn một file bên trái để xem Diff hoặc Stage/Discard từng Hunk</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom SourceTree Commit Composer */}
      <div
        className="border-t p-3 shrink-0 space-y-2 text-xs"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex-1 space-y-1">
            <textarea
              rows={2}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void submitCommit()
                }
              }}
              placeholder="Nhập Commit message (tiêu đề ngắn ở dòng đầu · Ctrl+Enter để Commit)..."
              className="w-full p-2 rounded-xl border outline-none resize-none text-xs"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>

          <div className="w-56 shrink-0 flex flex-col gap-1.5">
            <button
              type="button"
              data-git-commit-btn="true"
              disabled={busy || !commitMsg.trim() || (!amend && changes.filter((c) => c.staged).length === 0)}
              onClick={() => void submitCommit()}
              className="w-full py-2 px-3 rounded-xl text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <GitCommit className="w-3.5 h-3.5" />
              <span>
                {busy
                  ? 'Đang commit…'
                  : amend
                    ? 'Amend Commit'
                    : `Commit (${changes.filter((c) => c.staged).length} file)`}
              </span>
            </button>

            <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  data-git-amend-checkbox="true"
                  checked={amend}
                  onChange={(e) => void handleToggleAmend(e.target.checked)}
                />
                <span>Amend</span>
              </label>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pushAfter}
                  onChange={(e) => setPushAfter(e.target.checked)}
                />
                <span>Commit &amp; Push</span>
              </label>
              <span
                className="font-mono text-[10px]"
                style={{ color: firstLineLen > 72 ? 'var(--warn)' : 'var(--muted)' }}
              >
                {firstLineLen}/72
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
