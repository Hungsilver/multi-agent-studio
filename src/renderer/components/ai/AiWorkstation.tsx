import { useEffect, useState } from 'react'
import { BookOpen, Brain, FileDiff, Sparkles } from 'lucide-react'
import appAvatar from '../../assets/app-avatar.png'
import { useAiStore, type InspectorTab } from '../../stores/useAiStore'
import { useGovernanceStore } from '../../stores/useGovernanceStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { ChangesInspector } from './ChangesInspector'
import { ChatTimeline } from './ChatTimeline'
import { ContextMemoryPanel } from './ContextMemoryPanel'
import { EmbeddedTerminalPane } from './EmbeddedTerminalPane'
import { SessionHeader } from './SessionHeader'
import { SessionSidebar } from './SessionSidebar'
import { SmartComposer } from './SmartComposer'

function SessionSkillsQuickPanel(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const updateMemory = useAiStore((s) => s.updateMemory)
  const skills = useGovernanceStore((s) => s.skills)
  const rules = useGovernanceStore((s) => s.rules)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  if (!detail) return null
  const { session, memory } = detail

  const toggleSkill = (id: string): void => {
    const exists = memory.activeSkillIds.includes(id)
    const next = exists ? memory.activeSkillIds.filter((x) => x !== id) : [...memory.activeSkillIds, id]
    void updateMemory(session.id, { activeSkillIds: next })
  }

  const wsRules = rules.filter((r) => r.scope === 'workspace' && r.exists)

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Skills kích hoạt cho phiên</span>
        <button
          type="button"
          onClick={() => setActiveTab('governance')}
          className="text-[11px] hover:underline cursor-pointer"
          style={{ color: 'var(--accent)' }}
        >
          Quản lý tất cả →
        </button>
      </div>

      {skills.length === 0 && (
        <div className="p-3 rounded-lg border text-center" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          Chưa có Skill nào (`SKILL.md`). Vào mục Skills &amp; Rules để tạo mới.
        </div>
      )}

      <div className="space-y-1.5">
        {skills.map((sk) => {
          const active = memory.activeSkillIds.includes(sk.id) || memory.activeSkillIds.includes(sk.name)
          return (
            <label
              key={sk.id}
              className="flex items-start gap-2 p-2 rounded-lg border cursor-pointer btn-ghost"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg)'
              }}
            >
              <input type="checkbox" checked={active} onChange={() => toggleSkill(sk.id)} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{sk.name}</span>
                  <span className="text-[10px] px-1 rounded bg-subtle" style={{ color: 'var(--muted)' }}>
                    {sk.scope}
                  </span>
                </div>
                <div className="text-[11px] line-clamp-2 mt-0.5" style={{ color: 'var(--muted)' }}>
                  {sk.description}
                </div>
              </div>
            </label>
          )
        })}
      </div>

      <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="font-semibold">Rules đang áp dụng tại Workspace</div>
        {wsRules.length === 0 ? (
          <div style={{ color: 'var(--muted)' }}>Chưa có `AGENTS.md` / `CLAUDE.md` tại workspace này.</div>
        ) : (
          wsRules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <span className="flex items-center gap-1.5 font-mono">
                <BookOpen className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
                {r.name}
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('governance')}
                className="text-[11px] hover:underline cursor-pointer"
                style={{ color: 'var(--info)' }}
              >
                Sửa
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function AiWorkstation(): React.JSX.Element {
  const detail = useAiStore((s) => s.activeDetail)
  const viewMode = useAiStore((s) => s.viewMode)
  const inspectorOpen = useAiStore((s) => s.inspectorOpen)
  const inspectorTab = useAiStore((s) => s.inspectorTab)
  const setInspectorTab = useAiStore((s) => s.setInspectorTab)

  const loadGovernance = useGovernanceStore((s) => s.loadAll)
  const workspaces = useSettingsStore((s) => s.workspaces)
  const settings = useSettingsStore((s) => s.settings)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const createSession = useAiStore((s) => s.createSession)

  const [inspectorWidth, setInspectorWidth] = useState(360)
  const [terminalHeight, setTerminalHeight] = useState(250)

  const workDir = detail ? detail.session.worktreePath || detail.session.workspacePath : workspaces[0]?.path || ''

  useEffect(() => {
    void loadGovernance(workDir || undefined)
  }, [workDir, loadGovernance])

  const startResizeInspector = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = inspectorWidth
    const onMove = (mv: MouseEvent): void => {
      const next = Math.min(600, Math.max(280, startW + (startX - mv.clientX)))
      setInspectorWidth(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResizeTerminal = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = terminalHeight
    const onMove = (mv: MouseEvent): void => {
      const next = Math.min(520, Math.max(150, startH + (startY - mv.clientY)))
      setTerminalHeight(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <SessionSidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {!detail ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <img src={appAvatar} alt="AI Coding Tool" className="w-16 h-16 rounded-2xl shadow-xl" />
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Chào mừng tới AI Coding Tool</h2>
              <p className="text-xs max-w-md" style={{ color: 'var(--muted)' }}>
                Chọn một thư mục dự án để bắt đầu phiên làm việc với Claude Code, OpenAI Codex, Antigravity (AGY) hoặc Gemini CLI.
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
          <>
            <SessionHeader />
            <div className="flex-1 flex flex-col min-h-0">
              {viewMode !== 'terminal' && (
                <div className="flex-1 min-h-0 flex flex-col">
                  <ChatTimeline />
                  <SmartComposer />
                </div>
              )}

              {viewMode === 'split' && (
                <div
                  onMouseDown={startResizeTerminal}
                  className="h-1.5 shrink-0 cursor-row-resize hover:bg-indigo-500/40 transition-colors"
                  style={{ backgroundColor: 'var(--border)' }}
                  title="Kéo để chỉnh chiều cao Terminal"
                />
              )}

              {(viewMode === 'split' || viewMode === 'terminal') && (
                <div
                  className={viewMode === 'terminal' ? 'flex-1 min-h-0' : 'shrink-0'}
                  style={viewMode === 'split' ? { height: `${terminalHeight}px` } : undefined}
                >
                  <EmbeddedTerminalPane defaultCwd={workDir} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {detail && inspectorOpen && (
        <>
          <div
            onMouseDown={startResizeInspector}
            className="w-1 shrink-0 cursor-col-resize hover:bg-indigo-500/50 transition-colors"
            style={{ backgroundColor: 'var(--border)' }}
            title="Kéo để chỉnh độ rộng Inspector"
          />
          <aside
            className="shrink-0 flex flex-col min-h-0"
            style={{ width: `${inspectorWidth}px`, backgroundColor: 'var(--surface)' }}
          >
            <div className="h-10 shrink-0 border-b flex items-center px-1.5 gap-1" style={{ borderColor: 'var(--border)' }}>
              {(
                [
                  { id: 'changes', label: 'Diff & Commit', icon: FileDiff },
                  { id: 'memory', label: 'Bộ nhớ phiên', icon: Brain },
                  { id: 'skills', label: 'Skills', icon: Sparkles }
                ] as Array<{ id: InspectorTab; label: string; icon: typeof FileDiff }>
              ).map((tab) => {
                const Icon = tab.icon
                const active = inspectorTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setInspectorTab(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--sel)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--muted)'
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex-1 min-h-0">
              {inspectorTab === 'changes' && <ChangesInspector />}
              {inspectorTab === 'memory' && <ContextMemoryPanel />}
              {inspectorTab === 'skills' && <SessionSkillsQuickPanel />}
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
