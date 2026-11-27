import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Brain,
  CheckSquare,
  FileCode2,
  FileDiff,
  FolderTree,
  Globe,
  History,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Plus,
  Sparkles,
  TerminalSquare,
  X
} from 'lucide-react'
import {
  INSPECTOR_PRESETS,
  useWorkspaceTabsStore,
  type InspectorPanelKind,
  type InspectorTabItem
} from '../../stores/useWorkspaceTabsStore'
import { ChangesInspector } from '../ai/ChangesInspector'
import { ContextMemoryPanel } from '../ai/ContextMemoryPanel'
import { ArtifactPreviewPanel } from './ArtifactPreviewPanel'
import { CheckpointsPanel } from './CheckpointsPanel'
import { FileExplorerPanel } from './FileExplorerPanel'
import { FileViewerPanel } from './FileViewerPanel'
import { InspectorTerminalPanel } from './InspectorTerminalPanel'
import { LiveWebPreviewPanel } from './LiveWebPreviewPanel'
import { SessionSkillsQuickPanel } from './SessionSkillsQuickPanel'
import { TasksPlanPanel } from './TasksPlanPanel'

function getInspectorIcon(kind: InspectorPanelKind): typeof FileDiff {
  switch (kind) {
    case 'changes':
      return FileDiff
    case 'files':
      return FolderTree
    case 'file-viewer':
      return FileCode2
    case 'artifact':
      return LayoutGrid
    case 'preview':
      return Globe
    case 'tasks':
      return CheckSquare
    case 'memory':
      return Brain
    case 'checkpoints':
      return History
    case 'skills':
      return Sparkles
    case 'terminal':
      return TerminalSquare
  }
}

const SESSION_TOOL_OPTIONS: Array<{ kind: InspectorPanelKind; label: string; desc: string }> = [
  { kind: 'changes', label: 'Diff & Commit', desc: 'Xem thay đổi code & commit nhanh' },
  { kind: 'files', label: 'Files (Cây thư mục)', desc: 'Duyệt & mở sửa file trong dự án' },
  { kind: 'tasks', label: 'Tasks & Plan', desc: 'Checklist tiến độ phiên làm việc' },
  { kind: 'memory', label: 'Bộ nhớ phiên', desc: 'Context Memory & đồng bộ provider' },
  { kind: 'checkpoints', label: 'Checkpoints', desc: 'Lịch sử git write-tree & khôi phục' },
  { kind: 'skills', label: 'Skills & Rules', desc: 'Bật/tắt SKILL.md cho phiên' }
]

const VERSATILE_OPTIONS: Array<{ kind: InspectorPanelKind; label: string; desc: string; previewUrl?: string }> = [
  { kind: 'preview', label: 'Live Web Preview', desc: 'Xem trực tiếp localhost:5173 / 3000', previewUrl: 'http://localhost:5173' },
  { kind: 'terminal', label: 'Terminal (ConPTY)', desc: 'Mở shell PowerShell ngay cạnh chat' }
]

interface InspectorContainerProps {
  workDir: string
  onRequestWorktreeMerge?: (sessionId: string, repoRoot: string, worktreePath: string, worktreeBranch: string) => void
}

export function InspectorContainer({ workDir, onRequestWorktreeMerge }: InspectorContainerProps): React.JSX.Element | null {
  const tabs = useWorkspaceTabsStore((s) => s.tabs)
  const activeWorkspaceTabId = useWorkspaceTabsStore((s) => s.activeTabId)
  const sidebarCollapsed = useWorkspaceTabsStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useWorkspaceTabsStore((s) => s.sidebarWidth)
  const navRailCollapsed = useWorkspaceTabsStore((s) => s.navRailCollapsed)
  const openInspectorTab = useWorkspaceTabsStore((s) => s.openInspectorTab)
  const closeInspectorTab = useWorkspaceTabsStore((s) => s.closeInspectorTab)
  const setActiveInspectorTab = useWorkspaceTabsStore((s) => s.setActiveInspectorTab)
  const reorderInspectorTabs = useWorkspaceTabsStore((s) => s.reorderInspectorTabs)
  const setInspectorOpen = useWorkspaceTabsStore((s) => s.setInspectorOpen)
  const setInspectorWidth = useWorkspaceTabsStore((s) => s.setInspectorWidth)
  const toggleInspectorExpanded = useWorkspaceTabsStore((s) => s.toggleInspectorExpanded)
  const applyInspectorPreset = useWorkspaceTabsStore((s) => s.applyInspectorPreset)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const tabStripRef = useRef<HTMLDivElement | null>(null)

  const activeWsTab = tabs.find((t) => t.id === activeWorkspaceTabId)
  const activeInspTabId = activeWsTab?.inspector.activeTabId ?? activeWsTab?.inspector.tabs[0]?.id ?? null

  const computeAddPos = useCallback((): void => {
    const btn = addBtnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const width = Math.min(296, window.innerWidth - 16)
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 360))
    setAddMenuPos({ top, left, width })
  }, [])

  useEffect(() => {
    const onOtherSelect = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== 'inspector-add-menu') {
        setAddMenuOpen(false)
      }
    }
    window.addEventListener('aict:close-selects', onOtherSelect)
    return () => window.removeEventListener('aict:close-selects', onOtherSelect)
  }, [])

  useEffect(() => {
    if (!addMenuOpen) return
    window.dispatchEvent(new CustomEvent('aict:close-selects', { detail: 'inspector-add-menu' }))
    computeAddPos()

    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (addBtnRef.current?.contains(target) || addMenuRef.current?.contains(target)) {
        return
      }
      setAddMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAddMenuOpen(false)
    }
    const onRepos = (): void => computeAddPos()

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onRepos)
    window.addEventListener('scroll', onRepos, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onRepos)
      window.removeEventListener('scroll', onRepos, true)
    }
  }, [addMenuOpen, computeAddPos])

  useEffect(() => {
    const el = tabStripRef.current?.querySelector('[data-active-tab="true"]') as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeInspTabId, activeWorkspaceTabId])

  if (!activeWsTab || !activeWsTab.inspector.open) {
    return null
  }

  const insp = activeWsTab.inspector
  const activeInspTab: InspectorTabItem | undefined =
    insp.tabs.find((t) => t.id === insp.activeTabId) ?? insp.tabs[0]

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1440
  const occupiedLeft = (navRailCollapsed ? 0 : 74) + (sidebarCollapsed ? 0 : sidebarWidth)
  const maxSafeW = Math.max(260, Math.min(Math.floor(winW * 0.72), winW - occupiedLeft - 240))
  const effectiveWidth = insp.expanded
    ? Math.min(maxSafeW, Math.max(460, Math.floor(winW * 0.55)))
    : Math.min(maxSafeW, Math.max(240, insp.width))

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = effectiveWidth
    const onMove = (mv: MouseEvent): void => {
      const curWinW = typeof window !== 'undefined' ? window.innerWidth : 1440
      const st = useWorkspaceTabsStore.getState()
      const leftOcc = (st.navRailCollapsed ? 0 : 74) + (st.sidebarCollapsed ? 0 : st.sidebarWidth)
      const curMax = Math.max(260, Math.min(Math.floor(curWinW * 0.72), curWinW - leftOcc - 240))
      const next = Math.min(curMax, Math.max(240, startW + (startX - mv.clientX)))
      setInspectorWidth(next, activeWsTab.id)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleOpenOption = (kind: InspectorPanelKind, label: string, previewUrl?: string): void => {
    setAddMenuOpen(false)
    openInspectorTab(
      {
        kind,
        title: label === 'Files (Cây thư mục)' ? 'Files' : label === 'Terminal (ConPTY)' ? 'Terminal' : label,
        workspacePath: workDir,
        previewUrl
      },
      activeWsTab.id
    )
  }

  return (
    <>
      {/* Splitter */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setInspectorWidth(400, activeWsTab.id)}
        className="w-1 shrink-0 cursor-col-resize hover:bg-indigo-500/50 transition-colors"
        style={{ backgroundColor: 'var(--border)' }}
        title="Kéo để chỉnh độ rộng Inspector (Double-click đặt lại 400px)"
      />

      <aside
        aria-label="Dynamic Inspector"
        className="shrink-0 flex flex-col min-h-0 border-l"
        style={{ width: `${effectiveWidth}px`, backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Dynamic Inspector Tab Bar */}
        <div
          className="h-10 shrink-0 border-b flex items-center justify-between px-1.5 gap-1 select-none"
          style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
        >
          <div
            ref={tabStripRef}
            onWheel={(e) => {
              if (e.deltaY !== 0 && tabStripRef.current) {
                tabStripRef.current.scrollLeft += e.deltaY
              }
            }}
            className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0"
          >
            {insp.tabs.map((tab, idx) => {
              const Icon = getInspectorIcon(tab.kind)
              const active = activeInspTab?.id === tab.id
              return (
                <div
                  key={tab.id}
                  data-active-tab={active ? 'true' : undefined}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) {
                      reorderInspectorTabs(dragIdx, idx, activeWsTab.id)
                    }
                    setDragIdx(null)
                  }}
                  onClick={() => setActiveInspectorTab(tab.id, activeWsTab.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && tab.closable !== false) {
                      e.preventDefault()
                      closeInspectorTab(tab.id, activeWsTab.id)
                    }
                  }}
                  className="group flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 btn-ghost max-w-[148px]"
                  style={{
                    backgroundColor: active ? 'var(--sel)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--muted)'
                  }}
                  title={tab.filePath || tab.previewUrl || tab.title}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: active ? 'var(--accent)' : undefined }} />
                  <span className="truncate">{tab.title}</span>
                  {tab.closable !== false && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeInspectorTab(tab.id, activeWsTab.id)
                      }}
                      className={`p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-opacity cursor-pointer shrink-0 ${
                        active ? 'opacity-80 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                      title="Đóng tab Inspector"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Right Controls: + Add Panel, Expand, Close Inspector */}
          <div className="flex items-center gap-0.5 shrink-0">
            <div className="relative">
              <button
                ref={addBtnRef}
                type="button"
                onClick={() => setAddMenuOpen((o) => !o)}
                className="p-1.5 rounded-lg btn-ghost cursor-pointer"
                style={{ color: addMenuOpen ? 'var(--accent)' : 'var(--muted)' }}
                title="Mở thêm tab Inspector (+)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              {addMenuOpen &&
                addMenuPos &&
                createPortal(
                  <div
                    ref={addMenuRef}
                    role="menu"
                    aria-label="Thêm tab Inspector"
                    className="fixed rounded-xl border shadow-2xl p-1.5 z-[120] space-y-1 text-xs max-h-[72vh] overflow-y-auto"
                    style={{
                      top: addMenuPos.top,
                      left: addMenuPos.left,
                      width: addMenuPos.width,
                      backgroundColor: 'var(--surface-elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  >
                  <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    Công cụ phiên
                  </div>
                  {SESSION_TOOL_OPTIONS.map((opt) => {
                    const Icon = getInspectorIcon(opt.kind)
                    return (
                      <button
                        key={opt.kind}
                        type="button"
                        onClick={() => handleOpenOption(opt.kind, opt.label)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{opt.label}</div>
                          <div className="text-[10.5px] truncate" style={{ color: 'var(--muted)' }}>
                            {opt.desc}
                          </div>
                        </div>
                      </button>
                    )
                  })}

                  <div className="px-2 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide border-t" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Đa năng (Claude Style)
                  </div>
                  {VERSATILE_OPTIONS.map((opt) => {
                    const Icon = getInspectorIcon(opt.kind)
                    return (
                      <button
                        key={opt.kind}
                        type="button"
                        onClick={() => handleOpenOption(opt.kind, opt.label, opt.previewUrl)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{opt.label}</div>
                          <div className="text-[10.5px] truncate" style={{ color: 'var(--muted)' }}>
                            {opt.desc}
                          </div>
                        </div>
                      </button>
                    )
                  })}

                  <div className="px-2 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide border-t" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    Bố cục nhanh
                  </div>
                  <div className="grid grid-cols-1 gap-0.5">
                    {(Object.keys(INSPECTOR_PRESETS) as Array<keyof typeof INSPECTOR_PRESETS>).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          applyInspectorPreset(key, activeWsTab.id)
                          setAddMenuOpen(false)
                        }}
                        className="px-2.5 py-1 rounded-lg text-left text-[11px] btn-ghost cursor-pointer"
                        style={{ color: 'var(--text)' }}
                      >
                        {INSPECTOR_PRESETS[key].label}
                      </button>
                    ))}
                  </div>
                </div>,
                document.body
              )}
            </div>

            <button
              type="button"
              onClick={() => toggleInspectorExpanded(activeWsTab.id)}
              className="p-1.5 rounded-lg btn-ghost cursor-pointer"
              style={{ color: insp.expanded ? 'var(--accent)' : 'var(--muted)' }}
              title={insp.expanded ? 'Thu về kích thước thường' : 'Mở rộng Inspector (52%)'}
            >
              {insp.expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={() => setInspectorOpen(false, activeWsTab.id)}
              className="p-1.5 rounded-lg btn-ghost cursor-pointer"
              style={{ color: 'var(--muted)' }}
              title="Thu gọn Inspector (Ctrl+\)"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Active Inspector Panel Content */}
        <div className="flex-1 min-h-0">
          {!activeInspTab ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs gap-2" style={{ color: 'var(--muted)' }}>
              <p>Chưa có tab Inspector nào đang mở.</p>
              <button
                type="button"
                onClick={() => setAddMenuOpen(true)}
                className="px-3 py-1.5 rounded-lg text-white font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                + Mở công cụ
              </button>
            </div>
          ) : (
            <>
              {activeInspTab.kind === 'changes' && (
                <ChangesInspector onRequestWorktreeMerge={onRequestWorktreeMerge} />
              )}
              {activeInspTab.kind === 'memory' && <ContextMemoryPanel />}
              {activeInspTab.kind === 'skills' && <SessionSkillsQuickPanel />}
              {activeInspTab.kind === 'files' && <FileExplorerPanel workDir={workDir} />}
              {activeInspTab.kind === 'file-viewer' && activeInspTab.filePath && (
                <FileViewerPanel
                  key={`${activeInspTab.workspacePath || workDir}:${activeInspTab.filePath}`}
                  workspacePath={activeInspTab.workspacePath || workDir}
                  relPath={activeInspTab.filePath}
                />
              )}
              {activeInspTab.kind === 'artifact' && activeInspTab.artifact && (
                <ArtifactPreviewPanel artifact={activeInspTab.artifact} />
              )}
              {activeInspTab.kind === 'preview' && (
                <LiveWebPreviewPanel
                  inspTabId={activeInspTab.id}
                  initialUrl={activeInspTab.previewUrl}
                />
              )}
              {activeInspTab.kind === 'tasks' && <TasksPlanPanel />}
              {activeInspTab.kind === 'checkpoints' && <CheckpointsPanel />}
              {activeInspTab.kind === 'terminal' && (
                <InspectorTerminalPanel
                  inspTabId={activeInspTab.id}
                  workDir={activeInspTab.workspacePath || workDir}
                  ptyId={activeInspTab.ptyId}
                />
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
