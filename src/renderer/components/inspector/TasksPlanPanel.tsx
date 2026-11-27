import { useMemo, useState } from 'react'
import { CheckSquare, Plus, Send, Square, Trash2 } from 'lucide-react'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

const CHECKBOX_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/gm

export function TasksPlanPanel(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const customTasksBySession = useAiStore((s) => s.customTasksBySession)
  const addSessionTask = useAiStore((s) => s.addSessionTask)
  const toggleSessionTask = useAiStore((s) => s.toggleSessionTask)
  const deleteSessionTask = useAiStore((s) => s.deleteSessionTask)
  const appendToDraft = useAiStore((s) => s.appendToDraft)
  const showToast = useSettingsStore((s) => s.showToast)

  const [newTask, setNewTask] = useState('')

  const extractedFromAi = useMemo(() => {
    if (!detail) return []
    const items: Array<{ id: string; text: string; done: boolean; turnIndex: number }> = []
    const seen = new Set<string>()
    for (const turn of detail.turns) {
      const fullText = turn.events
        .filter((e) => e.event.type === 'text.delta')
        .map((e) => (e.event.type === 'text.delta' ? e.event.text : ''))
        .join('')
      for (const m of fullText.matchAll(CHECKBOX_RE)) {
        const done = m[1].toLowerCase() === 'x'
        const text = m[2].trim()
        const key = text.toLowerCase()
        if (text && !seen.has(key)) {
          seen.add(key)
          items.push({ id: `ai-${turn.turnIndex}-${items.length}`, text, done, turnIndex: turn.turnIndex })
        }
      }
    }
    return items
  }, [detail])

  if (!detail) return null
  const { session } = detail
  const customTasks = customTasksBySession[session.id] ?? []

  const totalCount = customTasks.length + extractedFromAi.length
  const doneCount =
    customTasks.filter((t) => t.done).length + extractedFromAi.filter((t) => t.done).length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  const handleAdd = (): void => {
    if (!newTask.trim()) return
    addSessionTask(session.id, newTask)
    setNewTask('')
  }

  return (
    <div className="flex flex-col h-full min-h-0 text-xs">
      {/* Progress & Add */}
      <div className="p-3 border-b space-y-2.5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Tiến độ công việc phiên</span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>
            {doneCount}/{totalCount} ({pct}%)
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: pct === 100 && totalCount > 0 ? 'var(--ok)' : 'var(--accent)' }}
          />
        </div>

        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            handleAdd()
          }}
        >
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Thêm đầu việc cần làm..."
            className="flex-1 px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="submit"
            className="px-2.5 py-1.5 rounded-lg text-white font-medium cursor-pointer flex items-center gap-1"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Lists */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Custom Tasks */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Checklist của bạn ({customTasks.length})
          </div>
          {customTasks.length === 0 ? (
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              Thêm đầu việc ở trên để theo dõi ngay cạnh cuộc trò chuyện.
            </div>
          ) : (
            customTasks.map((t) => (
              <div
                key={t.id}
                className="group flex items-start justify-between gap-2 p-2 rounded-lg border"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <button
                  type="button"
                  onClick={() => toggleSessionTask(session.id, t.id)}
                  className="flex items-start gap-2 text-left flex-1 min-w-0 cursor-pointer"
                >
                  {t.done ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--ok)' }} />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--muted)' }} />
                  )}
                  <span className={t.done ? 'line-through opacity-60' : ''}>{t.text}</span>
                </button>
                <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                  {!t.done && (
                    <button
                      type="button"
                      onClick={() => {
                        appendToDraft(session.id, `Hãy thực hiện công việc này: ${t.text}`)
                        showToast('Đã điền công việc vào ô chat', 'ok')
                      }}
                      className="p-1 rounded btn-ghost cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                      title="Gửi cho AI làm bước này"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteSessionTask(session.id, t.id)}
                    className="p-1 rounded hover:bg-red-500/20 cursor-pointer"
                    style={{ color: 'var(--err)' }}
                    title="Xóa task"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* AI Checklist items */}
        <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Trích từ câu trả lời &amp; Plan của AI ({extractedFromAi.length})
          </div>
          {extractedFromAi.length === 0 ? (
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              Chưa phát hiện danh sách checklist (<code className="font-mono px-1 rounded bg-subtle">- [ ] ...</code>) từ AI trong phiên này.
            </div>
          ) : (
            extractedFromAi.map((item) => (
              <div
                key={item.id}
                className="group flex items-start justify-between gap-2 p-2 rounded-lg border"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start gap-2 min-w-0">
                  {item.done ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--ok)' }} />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--muted)' }} />
                  )}
                  <span className={item.done ? 'line-through opacity-60' : ''}>{item.text}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                    #{item.turnIndex}
                  </span>
                  {!item.done && (
                    <button
                      type="button"
                      onClick={() => {
                        appendToDraft(session.id, `Hãy triển khai bước tiếp theo: ${item.text}`)
                        showToast('Đã điền bước vào ô chat', 'ok')
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded btn-ghost cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                      title="Gửi cho AI thực hiện"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
