import { BookOpen, Sparkles } from 'lucide-react'
import { useAiStore } from '../../stores/useAiStore'
import { useGovernanceStore } from '../../stores/useGovernanceStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

export function SessionSkillsQuickPanel(): React.JSX.Element | null {
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
          Chưa có Skill nào (<code className="font-mono px-1 rounded bg-subtle">SKILL.md</code>). Vào mục Skills &amp; Rules để tạo mới.
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
                  <span className="text-[10px] px-1 rounded bg-subtle shrink-0" style={{ color: 'var(--muted)' }}>
                    {sk.source === 'plugin' ? 'plugin' : sk.scope}
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
          <div style={{ color: 'var(--muted)' }}>
            Chưa có <code className="font-mono px-1 rounded bg-subtle">AGENTS.md</code> /{' '}
            <code className="font-mono px-1 rounded bg-subtle">CLAUDE.md</code> tại workspace này.
          </div>
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
