import { FileCode2, History, RotateCcw } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import { useAiStore } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'

export function CheckpointsPanel(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const setSelectedTurnForDiff = useAiStore((s) => s.setSelectedTurnForDiff)
  const ensureSessionDetail = useAiStore((s) => s.ensureSessionDetail)
  const refreshWorking = useGitStore((s) => s.refreshWorking)
  const showToast = useSettingsStore((s) => s.showToast)
  const openInspectorTab = useWorkspaceTabsStore((s) => s.openInspectorTab)

  if (!detail) return null
  const { session, turns } = detail
  const workDir = session.worktreePath || session.workspacePath
  const checkpointTurns = turns.filter((t) => Boolean(t.preTreeHash)).slice().reverse()

  const handleRestore = async (turnId: string, turnIndex: number): Promise<void> => {
    if (!window.confirm(`Khôi phục toàn bộ code trong workspace về trạng thái TRƯỚC lượt #${turnIndex}?`)) {
      return
    }
    try {
      await window.workspaceApi.restoreTurnCheckpoint(session.id, turnId)
      await refreshWorking(workDir)
      await ensureSessionDetail(session.id)
      showToast(`Đã khôi phục toàn bộ code về trước lượt #${turnIndex}`, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Khôi phục checkpoint thất bại', 'err')
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 text-xs">
      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1.5 font-semibold">
          <History className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          <span>Checkpoints</span>
          <code className="font-mono text-[10.5px] px-1 py-0.5 rounded bg-subtle font-normal" style={{ color: 'var(--muted)' }}>
            git write-tree
          </code>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {checkpointTurns.length} mốc
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {checkpointTurns.length === 0 ? (
          <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>
            Chưa có checkpoint nào được chụp trong phiên này.
          </div>
        ) : (
          checkpointTurns.map((t) => {
            const meta = PROVIDERS[t.provider]
            return (
              <div
                key={t.id}
                className="p-2.5 rounded-xl border space-y-2"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="font-semibold">Lượt #{t.turnIndex}</span>
                    <span style={{ color: 'var(--muted)' }}>· {meta.shortName}</span>
                  </div>
                  <span className="text-[10.5px] font-mono" style={{ color: 'var(--muted)' }}>
                    {t.preTreeHash?.slice(0, 7)}
                  </span>
                </div>

                <div className="text-[11.5px] line-clamp-2" style={{ color: 'var(--muted)' }}>
                  {t.userPrompt}
                </div>

                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTurnForDiff(t.id)
                      openInspectorTab({ kind: 'changes', title: 'Diff & Commit' })
                    }}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg border btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--info)' }}
                  >
                    <FileCode2 className="w-3 h-3" />
                    <span>Xem Diff lượt</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRestore(t.id, t.turnIndex)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg border btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', color: 'var(--warn)' }}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Khôi phục</span>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
