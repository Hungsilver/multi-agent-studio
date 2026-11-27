import { useEffect, useState } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  FolderPlus,
  GitBranch,
  RefreshCw,
  Send,
  Tag
} from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import type { CommitNode, MergeWorktreeResult } from '@shared/types/git'
import { removeWorktreeWithConfirm } from '../../lib/worktree-actions'
import { useAiStore } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { CustomSelect } from '../common/CustomSelect'
import {
  CreateBranchModal,
  CreateTagModal,
  PullPushModal,
  RenameBranchModal,
  ResetCommitModal,
  SaveStashModal
} from './GitDialogs'
import { GitHistoryView } from './GitHistoryView'
import { GitSidebar, type GitMainTab } from './GitSidebar'
import { GitWorkingCopyView } from './GitWorkingCopyView'
import { MergeConflictModal } from './MergeConflictModal'

export function GitWorkspace({ initialDir }: { initialDir?: string } = {}): React.JSX.Element {
  const workspaces = useSettingsStore((s) => s.workspaces)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const themeName = useSettingsStore((s) => s.settings.theme)
  const showToast = useSettingsStore((s) => s.showToast)
  const activeSession = useAiStore((s) => s.activeDetail?.session)
  const sendPrompt = useAiStore((s) => s.sendPrompt)

  const summary = useGitStore((s) => s.summary)
  const changes = useGitStore((s) => s.changes)
  const branches = useGitStore((s) => s.branches)
  const worktrees = useGitStore((s) => s.worktrees)
  const stashes = useGitStore((s) => s.stashes)
  const opState = useGitStore((s) => s.opState)
  const commits = useGitStore((s) => s.commits)
  const graphQuery = useGitStore((s) => s.graphQuery)
  const selectedCommit = useGitStore((s) => s.selectedCommit)
  const commitDetail = useGitStore((s) => s.commitDetail)
  const commitFileDiff = useGitStore((s) => s.commitFileDiff)
  const selectedStashDiff = useGitStore((s) => s.selectedStashDiff)
  const activeDiff = useGitStore((s) => s.activeDiff)
  const selectedFile = useGitStore((s) => s.selectedFile)
  const loading = useGitStore((s) => s.loading)

  const refreshFullRepo = useGitStore((s) => s.refreshFullRepo)
  const setGraphQuery = useGitStore((s) => s.setGraphQuery)
  const selectCommit = useGitStore((s) => s.selectCommit)
  const openCommitFileDiff = useGitStore((s) => s.openCommitFileDiff)
  const openStashDiff = useGitStore((s) => s.openStashDiff)
  const clearStashDiff = useGitStore((s) => s.clearStashDiff)
  const openWorkingDiff = useGitStore((s) => s.openWorkingDiff)

  const [repoDir, setRepoDir] = useState(
    initialDir || activeSession?.worktreePath || activeSession?.workspacePath || workspaces[0]?.path || ''
  )
  const [activeTab, setActiveTab] = useState<GitMainTab>('status')
  const [fetching, setFetching] = useState(false)

  // Modal states
  const [createBranchTarget, setCreateBranchTarget] = useState<string | null>(null)
  const [renameBranchTarget, setRenameBranchTarget] = useState<string | null>(null)
  const [stashModalOpen, setStashModalOpen] = useState(false)
  const [tagTarget, setTagTarget] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<CommitNode | null>(null)
  const [pullPushMode, setPullPushMode] = useState<'pull' | 'push' | null>(null)
  const [conflictModalResult, setConflictModalResult] = useState<MergeWorktreeResult | null>(null)

  const isDark = THEMES[themeName]?.isDark ?? true

  useEffect(() => {
    if (repoDir) void refreshFullRepo(repoDir)
  }, [repoDir, refreshFullRepo])

  useEffect(() => {
    if (repoDir && changes.length > 0 && !selectedFile) {
      void openWorkingDiff(repoDir, changes[0])
    }
  }, [repoDir, changes, selectedFile, openWorkingDiff])

  useEffect(() => {
    if (activeTab === 'history' && repoDir && commits.length > 0 && !selectedCommit && !selectedStashDiff) {
      void selectCommit(repoDir, commits[0])
    }
  }, [activeTab, repoDir, commits, selectedCommit, selectedStashDiff, selectCommit])

  const openConflictModalForRepo = async (sourceBranch: string, message: string): Promise<void> => {
    const st = await window.workspaceApi.getMergeConflictStatus(repoDir)
    setConflictModalResult({
      status: 'conflict',
      message,
      repoRoot: summary?.root || repoDir,
      sourceBranch,
      targetBranch: summary?.branch || 'HEAD',
      conflicts: st.conflicts
    })
  }

  const runAction = async (fn: () => Promise<string | void>): Promise<void> => {
    try {
      const msg = await fn()
      await refreshFullRepo(repoDir)
      if (msg) showToast(msg, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Thao tác Git thất bại', 'err')
    }
  }

  const handleApplyStash = async (ref: string, pop: boolean): Promise<void> => {
    try {
      const res = await window.workspaceApi.applyOrPopGitStash(repoDir, ref, pop)
      clearStashDiff()
      await refreshFullRepo(repoDir)
      if (!res.ok && res.conflicts?.length) {
        await openConflictModalForRepo(ref, res.message)
      } else {
        showToast(res.message, 'ok')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi thao tác Stash', 'err')
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* SourceTree Top Action Toolbar */}
      <div
        className="h-12 shrink-0 px-3 border-b flex items-center justify-between gap-2 overflow-x-auto"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <GitBranch className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <CustomSelect<string>
            value={repoDir}
            onChange={setRepoDir}
            className="max-w-[230px]"
            menuMinWidth={280}
            placeholder="(Chọn repository)"
            options={workspaces.map((w) => ({
              value: w.path,
              label: w.name,
              description: w.path
            }))}
          />
          <button
            type="button"
            onClick={() =>
              void addWorkspace().then((ws) => {
                if (ws) setRepoDir(ws.path)
              })
            }
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            title="Thêm thư mục Git repository"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>

          {summary?.isRepo && (
            <span
              className="text-xs font-mono px-2 py-0.5 rounded-md border shrink-0"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              {summary.branch}
              {summary.ahead ? ` ↑${summary.ahead}` : ''}
              {summary.behind ? ` ↓${summary.behind}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs shrink-0">
          <button
            type="button"
            disabled={!repoDir || fetching}
            onClick={() => {
              setFetching(true)
              void runAction(() => window.workspaceApi.fetchAllRemotes(repoDir, true)).finally(() => setFetching(false))
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            title="Fetch toàn bộ remote & tags (--prune)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{fetching ? 'Fetching…' : 'Fetch'}</span>
          </button>

          <button
            type="button"
            disabled={!repoDir}
            onClick={() => setPullPushMode('pull')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            title="Pull cập nhật từ remote (Merge hoặc Rebase)"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Pull</span>
          </button>

          <button
            type="button"
            disabled={!repoDir}
            onClick={() => setPullPushMode('push')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            title="Push nhánh hiện tại / Tags / Force-with-lease"
          >
            <ArrowUpFromLine className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Push</span>
          </button>

          <button
            type="button"
            disabled={!repoDir}
            onClick={() => setCreateBranchTarget('HEAD')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            title="Tạo nhánh mới hoặc nhánh Git-Flow"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Branch</span>
          </button>

          <button
            type="button"
            disabled={!repoDir}
            onClick={() => setStashModalOpen(true)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            title="Lưu thay đổi vào Stash"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Stash</span>
          </button>

          <button
            type="button"
            disabled={!repoDir}
            onClick={() => setTagTarget('HEAD')}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
            title="Tạo Tag tại HEAD"
          >
            <Tag className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Tag</span>
          </button>

          <button
            type="button"
            disabled={!repoDir}
            onClick={() =>
              void runAction(async () => {
                const res = await window.workspaceApi.pushBranchForMr(repoDir)
                if (res.mrUrl) void window.workspaceApi.openExternalUrl(res.mrUrl)
                return res.message
              })
            }
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white font-medium cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
            title="Push nhánh feature/fix & mở trang tạo Pull/Merge Request"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Push &amp; MR/PR</span>
          </button>

          <button
            type="button"
            disabled={!repoDir || loading}
            onClick={() => void refreshFullRepo(repoDir)}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            title="Làm mới trạng thái Repository"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Split: SourceTree Sidebar + Active View */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <GitSidebar
          activeTab={activeTab}
          onChangeTab={(t) => {
            setActiveTab(t)
            if (t === 'status') clearStashDiff()
          }}
          changesCount={changes.length}
          branches={branches}
          stashes={stashes}
          worktrees={worktrees}
          selectedStashRef={selectedStashDiff?.ref ?? null}
          onCheckoutBranch={(name, isRemote) =>
            void runAction(() => window.workspaceApi.switchBranch(repoDir, name, isRemote))
          }
          onCreateBranch={() => setCreateBranchTarget('HEAD')}
          onRenameBranch={(oldName) => setRenameBranchTarget(oldName)}
          onDeleteBranch={(name) => {
            if (window.confirm(`Xóa nhánh "${name}"?`)) {
              void window.workspaceApi
                .deleteGitBranch(repoDir, name, false)
                .then(async (msg) => {
                  await refreshFullRepo(repoDir)
                  showToast(msg, 'ok')
                })
                .catch((err: Error) => {
                  if (window.confirm(`${err.message}\n\nBạn có muốn Force Delete (-D) nhánh "${name}" không?`)) {
                    void runAction(() => window.workspaceApi.deleteGitBranch(repoDir, name, true))
                  }
                })
            }
          }}
          onMergeBranch={(sourceRef) => {
            if (!window.confirm(`Merge nhánh "${sourceRef}" vào "${summary?.branch || 'HEAD'}"?`)) return
            void (async () => {
              try {
                const res = await window.workspaceApi.mergeGitBranch(repoDir, sourceRef)
                await refreshFullRepo(repoDir)
                if (res.status === 'conflict') {
                  await openConflictModalForRepo(sourceRef, res.message)
                } else {
                  showToast(res.message, 'ok')
                }
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Merge thất bại', 'err')
              }
            })()
          }}
          onRebaseBranch={(targetRef) => {
            if (!window.confirm(`Rebase nhánh "${summary?.branch || 'HEAD'}" lên "${targetRef}"?`)) return
            void (async () => {
              try {
                const res = await window.workspaceApi.rebaseGitBranch(repoDir, targetRef)
                await refreshFullRepo(repoDir)
                if (!res.ok && res.conflicts?.length) {
                  await openConflictModalForRepo(targetRef, res.message)
                } else {
                  showToast(res.message, 'ok')
                }
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Rebase thất bại', 'err')
              }
            })()
          }}
          onSelectStash={(ref) => {
            setActiveTab('history')
            void openStashDiff(repoDir, ref)
          }}
          onApplyStash={(ref, pop) => void handleApplyStash(ref, pop)}
          onDropStash={(ref) => {
            if (window.confirm(`Xóa vĩnh viễn ${ref}?`)) {
              void runAction(async () => {
                const msg = await window.workspaceApi.dropGitStash(repoDir, ref)
                clearStashDiff()
                return msg
              })
            }
          }}
          onCreateTag={() => setTagTarget('HEAD')}
          onDeleteTag={(name) => {
            if (window.confirm(`Xóa tag "${name}"?`)) {
              void runAction(() => window.workspaceApi.deleteGitTag(repoDir, name))
            }
          }}
          onRemoveWorktree={(wtPath) =>
            void removeWorktreeWithConfirm(repoDir, wtPath, false).then(() => refreshFullRepo(repoDir))
          }
        />

        {activeTab === 'status' ? (
          <GitWorkingCopyView
            repoDir={repoDir}
            changes={changes}
            selectedFile={selectedFile}
            activeDiff={activeDiff}
            opState={opState}
            isDark={isDark}
            onSelectFile={(c) => void openWorkingDiff(repoDir, c)}
            onStageFiles={async (paths, stage, all) => {
              try {
                await window.workspaceApi.stageFiles(repoDir, paths, stage, Boolean(all))
                await refreshFullRepo(repoDir)
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Lỗi Stage/Unstage file', 'err')
              }
            }}
            onDiscardFile={async (c) => {
              try {
                await window.workspaceApi.revertWorkingFile(repoDir, c)
                await refreshFullRepo(repoDir)
                showToast(`Đã hoàn tác ${c.path}`, 'ok')
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Lỗi Discard file', 'err')
              }
            }}
            onApplyHunk={async (filePath, staged, action, hunkIndex) => {
              try {
                await window.workspaceApi.applyHunkPatch(repoDir, filePath, staged, action, hunkIndex)
                await refreshFullRepo(repoDir)
                if (action !== 'discard') {
                  const nextChanges = useGitStore.getState().changes
                  const updatedTarget =
                    nextChanges.find((x) => x.path === filePath && x.staged === staged) ??
                    nextChanges.find((x) => x.path === filePath)
                  if (updatedTarget) {
                    await openWorkingDiff(repoDir, updatedTarget)
                  }
                }
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Lỗi xử lý Hunk', 'err')
              }
            }}
            onCommit={async (message, opts) => {
              let msg: string
              try {
                msg = await window.workspaceApi.commitChanges(repoDir, message, { amend: opts.amend })
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Commit thất bại', 'err')
                return false
              }
              if (opts.pushAfter) {
                try {
                  await window.workspaceApi.pushCurrentBranch(repoDir, { forceWithLease: opts.amend })
                  await refreshFullRepo(repoDir)
                  showToast(`${msg} & đã Push!`, 'ok')
                } catch (err) {
                  await refreshFullRepo(repoDir)
                  showToast(
                    `${msg}, nhưng Push lỗi: ${err instanceof Error ? err.message : 'Không rõ lỗi'}`,
                    'err'
                  )
                }
                return true
              }
              await refreshFullRepo(repoDir)
              showToast(msg, 'ok')
              return true
            }}
            onResolveConflicts={() => void openConflictModalForRepo('CONFLICT', 'Đang xử lý xung đột Git')}
            onOpAction={async (op, action) => {
              try {
                const res = await window.workspaceApi.continueOrAbortGitOp(repoDir, op, action)
                await refreshFullRepo(repoDir)
                if (!res.ok && res.conflicts?.length) {
                  await openConflictModalForRepo(op, res.message)
                } else {
                  showToast(res.message, 'ok')
                }
              } catch (err) {
                showToast(err instanceof Error ? err.message : 'Thao tác thất bại', 'err')
              }
            }}
          />
        ) : (
          <GitHistoryView
            commits={commits}
            branches={branches}
            query={graphQuery}
            selectedCommit={selectedCommit}
            commitDetail={commitDetail}
            commitFileDiff={commitFileDiff}
            selectedStashDiff={selectedStashDiff}
            isDark={isDark}
            onChangeQuery={(patch) => void setGraphQuery(repoDir, patch)}
            onSelectCommit={(c) => void selectCommit(repoDir, c)}
            onSelectCommitFile={(hash, filePath) => void openCommitFileDiff(repoDir, hash, filePath)}
            onCloseStashDiff={clearStashDiff}
            onApplyStash={(ref, pop) => void handleApplyStash(ref, pop)}
            onDropStash={(ref) => {
              if (window.confirm(`Xóa vĩnh viễn ${ref}?`)) {
                void runAction(async () => {
                  const msg = await window.workspaceApi.dropGitStash(repoDir, ref)
                  clearStashDiff()
                  return msg
                })
              }
            }}
            onCreateBranchAt={(hash) => setCreateBranchTarget(hash)}
            onCreateTagAt={(hash) => setTagTarget(hash)}
            onCherryPick={(hash) =>
              void (async () => {
                try {
                  const res = await window.workspaceApi.cherryPickGitCommit(repoDir, hash)
                  await refreshFullRepo(repoDir)
                  if (!res.ok && res.conflicts?.length) {
                    await openConflictModalForRepo(hash.slice(0, 7), res.message)
                  } else {
                    showToast(res.message, 'ok')
                  }
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Cherry-pick thất bại', 'err')
                }
              })()
            }
            onRevertCommit={(hash) =>
              void (async () => {
                try {
                  const res = await window.workspaceApi.revertGitCommit(repoDir, hash)
                  await refreshFullRepo(repoDir)
                  if (!res.ok && res.conflicts?.length) {
                    await openConflictModalForRepo(hash.slice(0, 7), res.message)
                  } else {
                    showToast(res.message, 'ok')
                  }
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Revert thất bại', 'err')
                }
              })()
            }
            onCheckoutCommit={(hash) => {
              if (window.confirm(`Checkout detached HEAD tại commit ${hash.slice(0, 7)}?`)) {
                void runAction(() => window.workspaceApi.checkoutGitCommit(repoDir, hash))
              }
            }}
            onResetCommit={(commit) => setResetTarget(commit)}
            onCopySha={(hash) => {
              void navigator.clipboard.writeText(hash)
              showToast(`Đã sao chép SHA ${hash.slice(0, 10)}`, 'ok')
            }}
          />
        )}
      </div>

      {/* Dialogs */}
      {createBranchTarget !== null && (
        <CreateBranchModal
          defaultStartPoint={createBranchTarget}
          branches={branches}
          onClose={() => setCreateBranchTarget(null)}
          onCreateStandard={async (name, startPoint, checkout) => {
            await runAction(() =>
              window.workspaceApi.createGitBranch(repoDir, name, { startPoint, checkout })
            )
            setCreateBranchTarget(null)
          }}
          onCreateFlow={async (type, name, carry) => {
            await runAction(() => window.workspaceApi.createFlowBranch(repoDir, type, name, carry))
            setCreateBranchTarget(null)
          }}
        />
      )}

      {renameBranchTarget !== null && (
        <RenameBranchModal
          oldName={renameBranchTarget}
          onClose={() => setRenameBranchTarget(null)}
          onSubmit={async (newName) => {
            await runAction(() => window.workspaceApi.renameGitBranch(repoDir, renameBranchTarget, newName))
            setRenameBranchTarget(null)
          }}
        />
      )}

      {stashModalOpen && (
        <SaveStashModal
          onClose={() => setStashModalOpen(false)}
          onSubmit={async (message, includeUntracked) => {
            await runAction(() => window.workspaceApi.saveGitStash(repoDir, message, includeUntracked))
            setStashModalOpen(false)
          }}
        />
      )}

      {tagTarget !== null && (
        <CreateTagModal
          defaultTarget={tagTarget}
          onClose={() => setTagTarget(null)}
          onSubmit={async (name, target, message) => {
            await runAction(() => window.workspaceApi.createGitTag(repoDir, name, target, message))
            setTagTarget(null)
          }}
        />
      )}

      {resetTarget !== null && (
        <ResetCommitModal
          commitHash={resetTarget.hash}
          commitSubject={resetTarget.subject}
          onClose={() => setResetTarget(null)}
          onSubmit={async (mode) => {
            await runAction(() => window.workspaceApi.resetGitToCommit(repoDir, resetTarget.hash, mode))
            setResetTarget(null)
          }}
        />
      )}

      {pullPushMode !== null && (
        <PullPushModal
          mode={pullPushMode}
          branch={summary?.branch || 'HEAD'}
          onClose={() => setPullPushMode(null)}
          onPull={async (rebase) => {
            const res = await window.workspaceApi.pullCurrentBranch(repoDir, { rebase })
            setPullPushMode(null)
            await refreshFullRepo(repoDir)
            if (!res.ok && res.conflicts?.length) {
              await openConflictModalForRepo('remote', res.message)
            } else {
              showToast(res.message, 'ok')
            }
          }}
          onPush={async (forceWithLease, pushTags) => {
            await runAction(() =>
              window.workspaceApi.pushCurrentBranch(repoDir, { forceWithLease, pushTags })
            )
            setPullPushMode(null)
          }}
        />
      )}

      {conflictModalResult && (
        <MergeConflictModal
          result={conflictModalResult}
          worktreePath={null}
          themeName={themeName}
          onClose={() => setConflictModalResult(null)}
          onMinimizeToBanner={() => setConflictModalResult(null)}
          onUpdateResult={setConflictModalResult}
          onRetryAutoCommitMain={async () => {}}
          onAskAiMerge={async (prompt) => {
            if (!activeSession) {
              showToast('Hãy mở một phiên AI trong AI Studio trước để nhờ AI hỗ trợ merge.', 'info')
              return
            }
            await sendPrompt({ sessionId: activeSession.id, prompt })
            showToast('Đã gửi yêu cầu xử lý xung đột tới AI Agent!', 'ok')
          }}
          onMergedDone={async () => {
            setConflictModalResult(null)
            await refreshFullRepo(repoDir)
            showToast('Đã hoàn tất giải quyết xung đột!', 'ok')
          }}
        />
      )}
    </div>
  )
}
