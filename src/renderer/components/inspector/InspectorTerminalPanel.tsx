import { useEffect } from 'react'
import { RotateCw, TerminalSquare } from 'lucide-react'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'
import { XTermInstance } from '../ai/EmbeddedTerminalPane'

interface InspectorTerminalPanelProps {
  inspTabId: string
  workDir: string
  ptyId?: string
}

export function InspectorTerminalPanel({ inspTabId, workDir, ptyId }: InspectorTerminalPanelProps): React.JSX.Element {
  const openShellTab = useTerminalStore((s) => s.openShellTab)
  const tabs = useTerminalStore((s) => s.tabs)
  const updateInspectorTab = useWorkspaceTabsStore((s) => s.updateInspectorTab)

  const ptyTab = tabs.find((t) => t.id === ptyId)

  const spawnPty = async (): Promise<void> => {
    const info = await openShellTab(workDir || '.', 'Inspector Shell')
    updateInspectorTab(inspTabId, { ptyId: info.id })
  }

  useEffect(() => {
    if (!ptyId || !ptyTab) {
      void spawnPty()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspTabId])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="px-2.5 py-1 border-b flex items-center justify-between gap-2 text-[11px] shrink-0"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <TerminalSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="font-mono truncate" title={workDir}>
            {workDir || 'Workspace'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void spawnPty()}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded btn-ghost cursor-pointer shrink-0"
          title="Khởi chạy lại PowerShell mới"
        >
          <RotateCw className="w-3 h-3" />
          <span>Shell mới</span>
        </button>
      </div>

      <div className="flex-1 min-h-0" style={{ backgroundColor: 'var(--bg)' }}>
        {ptyId && ptyTab ? (
          <XTermInstance key={ptyId} ptyId={ptyId} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
            Đang khởi tạo PowerShell ConPTY…
          </div>
        )}
      </div>
    </div>
  )
}
