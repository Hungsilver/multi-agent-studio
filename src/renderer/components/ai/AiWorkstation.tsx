import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileDiff, GitMerge, RefreshCw, Sparkles, X } from 'lucide-react'
import type { MergeWorktreeResult } from '@shared/types/git'
import appAvatar from '../../assets/app-avatar.png'
import { useAiStore, type SessionDetailData } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useGovernanceStore } from '../../stores/useGovernanceStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { MergeConflictModal } from '../git/MergeConflictModal'
import { InspectorContainer } from '../inspector/InspectorContainer'
import { ChatTimeline } from './ChatTimeline'
import { SessionHeader } from './SessionHeader'
import { SmartComposer } from './SmartComposer'

function normalizePathKey(p: string): string {
  return p.replace(/[\\/]+$/, '').toLowerCase()
}

function collectEditedFilesFromDetail(detail: SessionDetailData | undefined): Set<string> {
  const edited = new Set<string>()
  if (!detail) return edited
  for (const turn of detail.turns) {
    for (const ev of turn.events) {
      if (ev.event.type !== 'tool.start' || ev.event.category !== 'edit') continue
      const inp = ev.event.input
      for (const k of ['file_path', 'path', 'TargetFile', 'AbsolutePath']) {
        const val = inp[k]
        if (typeof val === 'string' && val.trim()) {
          edited.add(val.trim())
        }
      }
    }
  }
  return edited
}

export function AiWorkstation(): React.JSX.Element {
  const sessions = useAiStore((s) => s.sessions)
  const activeDetail = useAiStore((s) => s.activeDetail)
  const detailsBySessionId = useAiStore((s) => s.detailsBySessionId)
  const paneSessionIds = useAiStore((s) => s.paneSessionIds)
  const focusedPaneIdx = useAiStore((s) => s.focusedPaneIdx)
  const splitRatio = useAiStore((s) => s.splitRatio)

  const focusPane = useAiStore((s) => s.focusPane)
  const closeSplitPane = useAiStore((s) => s.closeSplitPane)
  const openSessionInSplitPane = useAiStore((s) => s.openSessionInSplitPane)
  const setSplitRatio = useAiStore((s) => s.setSplitRatio)
  const createSession = useAiStore((s) => s.createSession)
  const deleteSession = useAiStore((s) => s.deleteSession)
  const sendPrompt = useAiStore((s) => s.sendPrompt)
  const setInspectorOpen = useAiStore((s) => s.setInspectorOpen)
  const setInspectorTab = useAiStore((s) => s.setInspectorTab)

  const loadGovernance = useGovernanceStore((s) => s.loadAll)
  const refreshWorking = useGitStore((s) => s.refreshWorking)
  const workspaces = useSettingsStore((s) => s.workspaces)
  const settings = useSettingsStore((s) => s.settings)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const showToast = useSettingsStore((s) => s.showToast)

  const [mergeModalOpen, setMergeModalOpen] = useState(false)
  const [mergeModalState, setMergeModalState] = useState<{
    result: MergeWorktreeResult
    paneSessionId: string
    worktreePath: string
    worktreeBranch: string
    repoRoot: string
  } | null>(null)

  const effectivePaneIds = useMemo(() => {
    const valid = paneSessionIds.filter((id) => sessions.some((s) => s.id === id))
    if (valid.length > 0) return valid
    return activeDetail ? [activeDetail.session.id] : []
  }, [paneSessionIds, sessions, activeDetail])

  const safeFocusedIdx = Math.max(0, Math.min(effectivePaneIds.length - 1, focusedPaneIdx))
  const focusedSessionId = effectivePaneIds[safeFocusedIdx] ?? activeDetail?.session.id ?? ''
  const focusedDetail = detailsBySessionId[focusedSessionId] ?? activeDetail
  const workDir = focusedDetail
    ? focusedDetail.session.worktreePath || focusedDetail.session.workspacePath
    : workspaces[0]?.path || ''

  useEffect(() => {
    void loadGovernance(workDir || undefined)
  }, [workDir, loadGovernance])

  // Tự động kiểm tra lại trạng thái xung đột khi AI vừa chạy xong lượt xử lý merge
  const anyRunning = sessions.some((s) => s.status === 'running')
  const prevRunningRef = useRef(anyRunning)
  useEffect(() => {
    const wasRunning = prevRunningRef.current
    prevRunningRef.current = anyRunning
    if (wasRunning && !anyRunning && mergeModalState?.result.status === 'conflict') {
      void window.workspaceApi.getMergeConflictStatus(mergeModalState.repoRoot).then((st) => {
        setMergeModalState((prev) =>
          prev ? { ...prev, result: { ...prev.result, conflicts: st.conflicts } } : null
        )
        if (st.conflicts.length === 0) {
          showToast('AI đã xử lý xong xung đột — hãy mở Trình Merge để Hoàn tất Commit!', 'ok')
        }
      })
    }
  }, [anyRunning, mergeModalState?.repoRoot, mergeModalState?.result.status, showToast])

  // Cảnh báo nếu 2+ khung đang chạy trực tiếp chung 1 thư mục & đụng vào cùng file
  const sameFolderWarning = useMemo(() => {
    if (effectivePaneIds.length < 2) return null
    const groups = new Map<string, { rawDir: string; paneIndices: number[]; sessionIds: string[] }>()
    effectivePaneIds.forEach((sid, idx) => {
      const det = detailsBySessionId[sid]
      const sess = det?.session ?? sessions.find((s) => s.id === sid)
      if (!sess) return
      const dir = sess.worktreePath || sess.workspacePath
      const key = normalizePathKey(dir)
      if (!groups.has(key)) groups.set(key, { rawDir: dir, paneIndices: [], sessionIds: [] })
      const g = groups.get(key)!
      g.paneIndices.push(idx)
      g.sessionIds.push(sid)
    })

    for (const g of groups.values()) {
      if (g.sessionIds.length < 2) continue
      const fileOwners = new Map<string, number[]>()
      g.sessionIds.forEach((sid, i) => {
        const files = collectEditedFilesFromDetail(detailsBySessionId[sid])
        for (const f of files) {
          const norm = normalizePathKey(f)
          if (!fileOwners.has(norm)) fileOwners.set(norm, [])
          fileOwners.get(norm)!.push(g.paneIndices[i] + 1)
        }
      })
      const overlaps: string[] = []
      for (const [f, owners] of fileOwners.entries()) {
        if (owners.length >= 2) overlaps.push(f.split(/[\\/]/).pop() || f)
      }
      return {
        rawDir: g.rawDir,
        paneLabels: g.paneIndices.map((i) => `Khung ${i + 1}`).join(' & '),
        overlaps
      }
    }
    return null
  }, [effectivePaneIds, detailsBySessionId, sessions])

  const startResizeHorizontal = (e: React.MouseEvent): void => {
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (mv: MouseEvent): void => {
      if (rect.width <= 0) return
      const ratio = (mv.clientX - rect.left) / rect.width
      setSplitRatio(ratio)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleSplitWorktree = async (baseSessionId: string): Promise<void> => {
    const base = sessions.find((s) => s.id === baseSessionId)
    if (!base) return
    try {
      await createSession(
        {
          workspacePath: base.workspacePath,
          provider: base.provider,
          permissionMode: base.permissionMode,
          title: `${base.title} · Song song`,
          useWorktree: true
        },
        { openInSplitPane: true }
      )
      showToast('Đã mở khung chia dọc với Git Worktree cô lập (hỗ trợ Merge & xử lý xung đột).', 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không tạo được Worktree cô lập', 'err')
    }
  }

  const handleSplitSameFolder = async (baseSessionId: string): Promise<void> => {
    const base = sessions.find((s) => s.id === baseSessionId)
    if (!base) return
    try {
      await createSession(
        {
          workspacePath: base.workspacePath,
          provider: base.provider,
          permissionMode: base.permissionMode,
          title: `${base.title} · Tab 2`,
          useWorktree: false
        },
        { openInSplitPane: true }
      )
      showToast('Đã mở khung chia dọc dùng chung thư mục trực tiếp.', 'info')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không mở được khung song song', 'err')
    }
  }

  const handleMergeWorktree = async (
    paneSessionId: string,
    repoRoot: string,
    worktreePath: string,
    worktreeBranch: string,
    autoCommitMain = false
  ): Promise<void> => {
    try {
      const res = await window.workspaceApi.prepareAndMergeWorktree(repoRoot, worktreePath, worktreeBranch, {
        autoCommitWorktree: true,
        autoCommitMain
      })
      setMergeModalState({
        result: res,
        paneSessionId,
        worktreePath,
        worktreeBranch,
        repoRoot: res.repoRoot
      })
      setMergeModalOpen(true)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi kiểm tra Merge worktree', 'err')
    }
  }

  const handleAskAiReconcileSameFolder = async (): Promise<void> => {
    if (!sameFolderWarning || !focusedSessionId) return
    const overlapText =
      sameFolderWarning.overlaps.length > 0
        ? `Các file bị 2 khung chỉnh sửa cùng lúc: ${sameFolderWarning.overlaps.join(', ')}.`
        : 'Hai khung đang chạy song song trong cùng thư mục.'
    await sendPrompt({
      sessionId: focusedSessionId,
      prompt: `${overlapText}\nHãy kiểm tra \`git status\` và \`git diff\` tại \`${sameFolderWarning.rawDir}\`, rà soát lại mọi thay đổi của hai luồng công việc để đảm bảo code hợp nhất sạch sẽ, không ghi đè lẫn nhau và không lỗi syntax/logic.`
    })
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {effectivePaneIds.length === 0 || !focusedDetail ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <img src={appAvatar} alt="Multi-Agent Studio" className="w-16 h-16 rounded-2xl shadow-xl" />
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Chào mừng tới Multi-Agent Studio</h2>
              <p className="text-xs max-w-md" style={{ color: 'var(--muted)' }}>
                Chọn một thư mục dự án để bắt đầu phiên làm việc với Claude Code, OpenAI Codex hoặc Antigravity (AGY).
              </p>
            </div>
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
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              + Mở thư mục &amp; Tạo phiên đầu tiên
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Minimized Merge-In-Progress Banner */}
            {mergeModalState && !mergeModalOpen && mergeModalState.result.status === 'conflict' && (
              <div
                data-merge-banner="true"
                className="px-3 py-1.5 border-b flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0"
                style={{
                  backgroundColor: mergeModalState.result.conflicts.length === 0 ? 'rgba(16, 163, 127, 0.14)' : 'var(--accent-soft)',
                  borderColor: mergeModalState.result.conflicts.length === 0 ? 'var(--ok)' : 'var(--accent)',
                  color: 'var(--text)'
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {mergeModalState.result.conflicts.length === 0 ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ok)' }} />
                  ) : (
                    <GitMerge className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                  )}
                  <span className="truncate">
                    {mergeModalState.result.conflicts.length === 0 ? (
                      <>
                        <strong>Đã hết xung đột ({mergeModalState.worktreeBranch} → {mergeModalState.result.targetBranch})</strong> — Sẵn sàng Hoàn tất Merge!
                      </>
                    ) : (
                      <>
                        Đang xử lý Merge <strong>{mergeModalState.worktreeBranch}</strong> → <strong>{mergeModalState.result.targetBranch}</strong> · Còn{' '}
                        <strong>{mergeModalState.result.conflicts.length}</strong> file xung đột
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMergeModalOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded font-semibold text-white cursor-pointer"
                    style={{ backgroundColor: mergeModalState.result.conflicts.length === 0 ? 'var(--ok)' : 'var(--accent)' }}
                  >
                    <GitMerge className="w-3 h-3" />
                    <span>Mở lại Trình Merge</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.workspaceApi.getMergeConflictStatus(mergeModalState.repoRoot).then((st) => {
                        setMergeModalState((prev) =>
                          prev ? { ...prev, result: { ...prev.result, conflicts: st.conflicts } } : null
                        )
                      })
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Kiểm tra lại</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.workspaceApi.finalizeWorktreeMerge(mergeModalState.repoRoot, 'abort').then(() => {
                        setMergeModalState(null)
                        setMergeModalOpen(false)
                        showToast('Đã hủy Merge và khôi phục nhánh chính.', 'info')
                      })
                    }
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
                    title="Hủy Merge (Rollback)"
                  >
                    <X className="w-3 h-3" />
                    <span>Hủy</span>
                  </button>
                </div>
              </div>
            )}

            {/* Same-folder parallel warning banner */}
            {sameFolderWarning && (
              <div
                data-same-folder-banner="true"
                className="px-3 py-1.5 border-b flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0"
                style={{
                  backgroundColor: sameFolderWarning.overlaps.length > 0 ? 'var(--err-bg)' : 'var(--surface)',
                  borderColor: sameFolderWarning.overlaps.length > 0 ? 'var(--err)' : 'var(--border)',
                  color: sameFolderWarning.overlaps.length > 0 ? 'var(--err)' : 'var(--muted)'
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: sameFolderWarning.overlaps.length > 0 ? 'var(--err)' : 'var(--warn)' }}
                  />
                  <span className="truncate">
                    <strong>{sameFolderWarning.paneLabels}</strong> đang chạy trực tiếp chung thư mục.
                    {sameFolderWarning.overlaps.length > 0
                      ? ` Cảnh báo sửa trùng file: ${sameFolderWarning.overlaps.join(', ')}`
                      : ' Hãy chú ý xung đột code nếu sửa cùng file (hoặc dùng + Chia dọc → Worktree cô lập).'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setInspectorTab('changes')
                      setInspectorOpen(true)
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <FileDiff className="w-3 h-3" />
                    <span>Xem Diff</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAskAiReconcileSameFolder()}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium cursor-pointer"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Nhờ AI rà soát &amp; merge</span>
                  </button>
                </div>
              </div>
            )}

            {/* Vertical Split Chat Panes */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
                {effectivePaneIds.map((sid, idx) => {
                  const isFocused = idx === safeFocusedIdx
                  const total = effectivePaneIds.length
                  const widthStyle =
                    total === 2
                      ? {
                          width:
                            idx === 0
                              ? `calc(${(splitRatio * 100).toFixed(2)}% - 3px)`
                              : `calc(${((1 - splitRatio) * 100).toFixed(2)}% - 3px)`
                        }
                      : undefined

                  return (
                    <div key={sid} className="contents">
                      {idx > 0 && total === 2 && (
                        <div
                          onMouseDown={startResizeHorizontal}
                          onDoubleClick={() => setSplitRatio(0.5)}
                          className="w-1.5 shrink-0 cursor-col-resize hover:bg-indigo-500/40 transition-colors"
                          style={{ backgroundColor: 'var(--border)' }}
                          title="Kéo để chỉnh tỉ lệ 2 khung chat (Double-click về 50/50)"
                        />
                      )}
                      {idx > 0 && total > 2 && (
                        <div className="w-px shrink-0" style={{ backgroundColor: 'var(--border)' }} />
                      )}

                      <section
                        data-split-pane={idx}
                        aria-label={`Khung làm việc ${idx + 1}`}
                        onMouseDown={() => {
                          if (!isFocused) void focusPane(idx)
                        }}
                        className={`${total === 2 ? 'shrink-0' : 'flex-1'} flex flex-col min-w-0 min-h-0 overflow-hidden transition-colors`}
                        style={{
                          ...(widthStyle ?? {}),
                          boxShadow:
                            total > 1 && isFocused
                              ? 'inset 0 2px 0 var(--accent)'
                              : undefined
                        }}
                      >
                        <SessionHeader
                          sessionId={sid}
                          paneIndex={idx}
                          totalPanes={total}
                          isFocused={isFocused}
                          onFocusPane={() => void focusPane(idx)}
                          onClosePane={() => void closeSplitPane(idx)}
                          onSplitWorktree={() => void handleSplitWorktree(sid)}
                          onSplitSameFolder={() => void handleSplitSameFolder(sid)}
                          onSplitExistingSession={(targetId) => void openSessionInSplitPane(targetId)}
                          onMergeWorktree={(repoRoot, wtPath, wtBranch) =>
                            void handleMergeWorktree(sid, repoRoot, wtPath, wtBranch, false)
                          }
                        />
                        <ChatTimeline
                          sessionId={sid}
                          compact={total > 1}
                          onFocusPane={() => {
                            if (!isFocused) void focusPane(idx)
                          }}
                        />
                        <SmartComposer
                          sessionId={sid}
                          compact={total > 1}
                          onFocusPane={() => {
                            if (!isFocused) void focusPane(idx)
                          }}
                        />
                      </section>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {focusedDetail && (
        <InspectorContainer
          workDir={workDir}
          onRequestWorktreeMerge={(sid, repoRoot, wtPath, wtBranch) =>
            void handleMergeWorktree(sid, repoRoot, wtPath, wtBranch, false)
          }
        />
      )}

      {mergeModalState && mergeModalOpen && (
        <MergeConflictModal
          result={mergeModalState.result}
          worktreePath={mergeModalState.worktreePath}
          themeName={settings.theme}
          onClose={() => {
            setMergeModalOpen(false)
            setMergeModalState(null)
          }}
          onMinimizeToBanner={() => setMergeModalOpen(false)}
          onUpdateResult={(next) =>
            setMergeModalState((prev) => (prev ? { ...prev, result: next } : null))
          }
          onRetryAutoCommitMain={() =>
            handleMergeWorktree(
              mergeModalState.paneSessionId,
              mergeModalState.repoRoot,
              mergeModalState.worktreePath,
              mergeModalState.worktreeBranch,
              true
            )
          }
          onAskAiMerge={async (prompt) => {
            const targetPaneSessionId =
              effectivePaneIds.find((id) => id !== mergeModalState.paneSessionId) ??
              mergeModalState.paneSessionId
            await sendPrompt({ sessionId: targetPaneSessionId, prompt })
          }}
          onMergedDone={async ({ removeWorktree }) => {
            const { repoRoot, worktreePath, paneSessionId, worktreeBranch } = mergeModalState
            setMergeModalOpen(false)
            setMergeModalState(null)

            if (removeWorktree) {
              // Đóng khung phụ & xóa phiên trước để Inspector quay về repo chính, giải phóng lock Windows
              const paneIdx = effectivePaneIds.indexOf(paneSessionId)
              if (effectivePaneIds.length > 1 && paneIdx >= 0) {
                await closeSplitPane(paneIdx)
              }
              const targetSess = useAiStore.getState().sessions.find((s) => s.id === paneSessionId)
              if (targetSess && targetSess.status !== 'running') {
                await deleteSession(paneSessionId)
              }
              if (worktreePath) {
                try {
                  await window.workspaceApi.removeWorktree(repoRoot, worktreePath, true)
                } catch (err) {
                  showToast(
                    `Đã merge nhánh ${worktreeBranch}, nhưng dọn thư mục worktree gặp lock: ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                    'info'
                  )
                }
              }
            }

            await refreshWorking(repoRoot)
            showToast(`Đã merge nhánh ${worktreeBranch} vào repo chính thành công!`, 'ok')
          }}
        />
      )}
    </div>
  )
}
