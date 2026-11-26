import { useEffect, useState } from 'react'
import { GitBranch, GitCommit, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import { detectMonacoLanguage } from '../../lib/monaco-setup'
import { useAiStore } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { MonacoDiffView } from '../common/MonacoDiffView'

const LANE_COLORS = ['#6366F1', '#10A37F', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6']

export function GitWorkspace(): React.JSX.Element {
  const workspaces = useSettingsStore((s) => s.workspaces)
  const themeName = useSettingsStore((s) => s.settings.theme)
  const showToast = useSettingsStore((s) => s.showToast)
  const activeSession = useAiStore((s) => s.activeDetail?.session)

  const summary = useGitStore((s) => s.summary)
  const changes = useGitStore((s) => s.changes)
  const branches = useGitStore((s) => s.branches)
  const worktrees = useGitStore((s) => s.worktrees)
  const commits = useGitStore((s) => s.commits)
  const activeDiff = useGitStore((s) => s.activeDiff)
  const refreshFullRepo = useGitStore((s) => s.refreshFullRepo)
  const openWorkingDiff = useGitStore((s) => s.openWorkingDiff)

  const [repoDir, setRepoDir] = useState(
    activeSession?.worktreePath || activeSession?.workspacePath || workspaces[0]?.path || ''
  )
  const [flowOpen, setFlowOpen] = useState(false)
  const [flowType, setFlowType] = useState<'feature' | 'fix' | 'bugfix' | 'hotfix'>('feature')
  const [flowName, setFlowName] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const isDark = THEMES[themeName]?.isDark ?? true

  useEffect(() => {
    if (repoDir) void refreshFullRepo(repoDir)
  }, [repoDir, refreshFullRepo])

  useEffect(() => {
    if (repoDir && changes.length > 0 && !activeDiff) {
      void openWorkingDiff(repoDir, changes[0])
    }
  }, [repoDir, changes, activeDiff, openWorkingDiff])

  const handleStage = async (pathStr: string, stage: boolean): Promise<void> => {
    await window.workspaceApi.stageFiles(repoDir, [pathStr], stage, false)
    await refreshFullRepo(repoDir)
  }

  const handleCommit = async (): Promise<void> => {
    try {
      const msg = await window.workspaceApi.commitChanges(repoDir, commitMsg)
      setCommitMsg('')
      await refreshFullRepo(repoDir)
      showToast(msg, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Commit lỗi', 'err')
    }
  }

  const handlePushMr = async (): Promise<void> => {
    try {
      const res = await window.workspaceApi.pushBranchForMr(repoDir)
      showToast(res.message, 'ok')
      if (res.mrUrl) {
        void window.workspaceApi.openExternalUrl(res.mrUrl)
      }
      await refreshFullRepo(repoDir)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Push lỗi', 'err')
    }
  }

  const handleCreateFlow = async (): Promise<void> => {
    try {
      const msg = await window.workspaceApi.createFlowBranch(repoDir, flowType, flowName.trim(), true)
      setFlowOpen(false)
      setFlowName('')
      await refreshFullRepo(repoDir)
      showToast(msg, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Tạo nhánh lỗi', 'err')
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div
        className="h-12 shrink-0 px-4 border-b flex items-center justify-between gap-3"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2.5">
          <GitBranch className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <select
            value={repoDir}
            onChange={(e) => setRepoDir(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border text-xs outline-none max-w-[300px]"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.path}>
                {w.name} — {w.path}
              </option>
            ))}
          </select>
          {summary?.isRepo && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-subtle">
              {summary.branch} {summary.ahead ? `↑${summary.ahead}` : ''} {summary.behind ? `↓${summary.behind}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setFlowOpen((o) => !o)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nhánh Git-Flow</span>
          </button>
          <button
            type="button"
            onClick={() => void handlePushMr()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Push &amp; Mở MR/PR</span>
          </button>
          <button
            type="button"
            onClick={() => void refreshFullRepo(repoDir)}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {flowOpen && (
        <div
          className="px-4 py-2.5 border-b flex items-center gap-2 text-xs"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <select
            value={flowType}
            onChange={(e) => setFlowType(e.target.value as 'feature' | 'fix' | 'bugfix' | 'hotfix')}
            className="px-2 py-1 rounded border"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <option value="feature">feature/</option>
            <option value="fix">fix/</option>
            <option value="bugfix">bugfix/</option>
            <option value="hotfix">hotfix/</option>
          </select>
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            placeholder="ten-nhanh (chữ thường, gạch ngang)"
            className="px-2.5 py-1 rounded border w-64 outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => void handleCreateFlow()}
            className="px-3 py-1 rounded text-white font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Tạo từ origin
          </button>
        </div>
      )}

      {/* Main 3 columns */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Branches & Worktrees */}
        <aside
          className="w-60 shrink-0 border-r overflow-y-auto p-2.5 space-y-4 text-xs"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div>
            <div className="font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>
              Nhánh Local
            </div>
            <div className="space-y-0.5">
              {branches
                .filter((b) => b.kind === 'local')
                .map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() =>
                      void window.workspaceApi.switchBranch(repoDir, b.name, false).then((msg) => {
                        showToast(msg, 'ok')
                        void refreshFullRepo(repoDir)
                      }).catch((e: Error) => showToast(e.message, 'err'))
                    }
                    className="w-full text-left px-2 py-1 rounded truncate btn-ghost cursor-pointer"
                    style={{
                      backgroundColor: b.current ? 'var(--sel)' : 'transparent',
                      color: b.current ? 'var(--accent)' : 'var(--text)'
                    }}
                  >
                    {b.current ? '● ' : '○ '}
                    {b.name}
                  </button>
                ))}
            </div>
          </div>

          <div>
            <div className="font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>
              Worktrees ({worktrees.length})
            </div>
            <div className="space-y-1">
              {worktrees.map((w) => (
                <div
                  key={w.path}
                  className="p-2 rounded-lg border flex items-center justify-between gap-1"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{w.branch}</div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--muted)' }}>
                      {w.path}
                    </div>
                  </div>
                  {!w.isMain && (
                    <button
                      type="button"
                      onClick={() =>
                        void window.workspaceApi.removeWorktree(repoDir, w.path, false).then(() => refreshFullRepo(repoDir))
                      }
                      className="text-red-400 hover:opacity-75 cursor-pointer shrink-0"
                      title="Xóa Worktree"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center: Commit Graph + Diff */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 overflow-y-auto border-b" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0" style={{ backgroundColor: 'var(--header)' }}>
                <tr className="text-left border-b" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  <th className="py-2 px-3 w-24">Graph</th>
                  <th className="py-2 px-2">Nội dung Commit</th>
                  <th className="py-2 px-2 w-32">Tác giả</th>
                  <th className="py-2 px-3 w-32">Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {commits.map((c) => {
                  const rowH = 28
                  const laneW = 14
                  const svgW = Math.max(24, c.lanes * laneW + 10)
                  return (
                    <tr key={c.hash} className="border-b btn-ghost" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-0">
                        <svg width={svgW} height={rowH} className="block">
                          {c.segments.map((s, idx) => {
                            const x1 = 8 + s.fromCol * laneW
                            const x2 = 8 + s.toCol * laneW
                            const y1 = s.kind === 2 ? rowH / 2 : 0
                            const y2 = s.kind === 1 ? rowH / 2 : rowH
                            const col = LANE_COLORS[s.colorIndex % LANE_COLORS.length]
                            return <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={2} />
                          })}
                          <circle
                            cx={8 + c.col * laneW}
                            cy={rowH / 2}
                            r={4}
                            fill={LANE_COLORS[c.colorIndex % LANE_COLORS.length]}
                          />
                        </svg>
                      </td>
                      <td className="px-2 py-1 truncate max-w-[420px]">
                        <span className="font-mono text-[11px] mr-2" style={{ color: 'var(--muted)' }}>
                          {c.shortHash}
                        </span>
                        {c.refs && (
                          <span
                            className="mr-2 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            {c.refs}
                          </span>
                        )}
                        <span>{c.subject}</span>
                      </td>
                      <td className="px-2 py-1 truncate" style={{ color: 'var(--muted)' }}>
                        {c.author}
                      </td>
                      <td className="px-3 py-1 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                        {c.date}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {activeDiff && (
            <div className="h-72 shrink-0">
              <MonacoDiffView
                original={activeDiff.original}
                modified={activeDiff.modified}
                language={detectMonacoLanguage(activeDiff.path)}
                theme={isDark ? 'vs-dark' : 'light'}
                sideBySide={true}
                fontSize={12}
              />
            </div>
          )}
        </div>

        {/* Right: Stage & Commit */}
        <aside
          className="w-72 shrink-0 border-l flex flex-col min-h-0 p-2.5 gap-2.5 text-xs"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="font-semibold">Thay đổi ({changes.length})</div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {changes.map((c, idx) => (
              <div
                key={`${c.path}-${c.staged}-${idx}`}
                onClick={() => void openWorkingDiff(repoDir, c)}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border cursor-pointer btn-ghost"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-bold" style={{ color: c.staged ? 'var(--ok)' : 'var(--warn)' }}>
                    {c.code}
                  </span>
                  <span className="truncate font-mono text-[11px]">{c.path}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleStage(c.path, !c.staged)
                  }}
                  className="px-1.5 py-0.5 rounded border text-[10px] shrink-0 cursor-pointer"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {c.staged ? 'Unstage' : 'Stage'}
                </button>
              </div>
            ))}
          </div>

          <textarea
            rows={3}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            className="w-full p-2 rounded-lg border outline-none resize-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => void handleCommit()}
            className="w-full py-1.5 rounded-lg text-white font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Commit các file đã Stage</span>
          </button>
        </aside>
      </div>
    </div>
  )
}
