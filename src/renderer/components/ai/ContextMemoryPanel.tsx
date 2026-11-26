import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { PROVIDERS, PROVIDER_LIST } from '@shared/constants/providers'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

export function ContextMemoryPanel(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const updateMemory = useAiStore((s) => s.updateMemory)
  const compactMemory = useAiStore((s) => s.compactMemory)
  const showToast = useSettingsStore((s) => s.showToast)

  const [goal, setGoal] = useState('')
  const [summary, setSummary] = useState('')
  const [newDecision, setNewDecision] = useState('')
  const [newNote, setNewNote] = useState('')

  const session = detail?.session
  const memory = detail?.memory
  const turns = detail?.turns ?? []
  const providerStates = detail?.providerStates ?? []

  useEffect(() => {
    if (memory) {
      setGoal(memory.goal)
      setSummary(memory.summary)
    }
  }, [memory])

  if (!session || !memory) return null

  const lastTurnIndex = turns[turns.length - 1]?.turnIndex ?? 0

  const handleSaveText = async (): Promise<void> => {
    await updateMemory(session.id, { goal, summary })
    showToast('Đã lưu bộ nhớ ngữ cảnh phiên', 'ok')
  }

  const handleCompact = async (): Promise<void> => {
    await compactMemory(session.id)
    showToast('Đã tóm tắt & cập nhật bộ nhớ từ các lượt đã chạy', 'ok')
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Bộ nhớ ngữ cảnh (Session Memory)</div>
          <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Tự động đồng bộ khi chuyển đổi AI tool
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleCompact()}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
        >
          <Sparkles className="w-3 h-3" />
          <span>Tóm tắt</span>
        </button>
      </div>

      {/* Sync Matrix */}
      <div className="p-2.5 rounded-xl border space-y-1.5" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
          Ma trận đồng bộ Provider (Tổng: {lastTurnIndex} lượt)
        </div>
        {PROVIDER_LIST.map((p) => {
          const st = providerStates.find((x) => x.provider === p.id)
          const synced = st?.lastSyncedTurnIndex ?? 0
          const inSync = lastTurnIndex === 0 || synced >= lastTurnIndex
          return (
            <div key={p.id} className="flex items-center justify-between py-0.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PROVIDERS[p.id].color }} />
                <span>{p.shortName}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: inSync ? 'var(--ok)' : 'var(--warn)' }}>
                {inSync ? <CheckCircle2 className="w-3 h-3" /> : null}
                {st ? `${synced}/${lastTurnIndex} lượt` : 'Sẵn sàng handoff'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Goal */}
      <div className="space-y-1">
        <label className="font-medium" style={{ color: 'var(--muted)' }}>
          Mục tiêu chính của phiên
        </label>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onBlur={() => void handleSaveText()}
          placeholder="Vd: Tối ưu API phân trang đơn hàng..."
          className="w-full px-2.5 py-1.5 rounded-lg border outline-none"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </div>

      {/* Summary */}
      <div className="space-y-1">
        <label className="font-medium" style={{ color: 'var(--muted)' }}>
          Tóm tắt tiến độ
        </label>
        <textarea
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => void handleSaveText()}
          placeholder="Tóm tắt những gì đã làm được..."
          className="w-full p-2 rounded-lg border outline-none resize-y"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </div>

      {/* Decisions */}
      <div className="space-y-1.5">
        <label className="font-medium" style={{ color: 'var(--muted)' }}>
          Quyết định kỹ thuật đã chốt
        </label>
        {memory.decisions.map((d, idx) => (
          <div
            key={idx}
            className="flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-lg border"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <span className="leading-snug">{d}</span>
            <button
              type="button"
              onClick={() =>
                void updateMemory(session.id, {
                  decisions: memory.decisions.filter((_, i) => i !== idx)
                })
              }
              className="text-red-400 hover:opacity-75 cursor-pointer shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <input
            value={newDecision}
            onChange={(e) => setNewDecision(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newDecision.trim()) {
                void updateMemory(session.id, { decisions: [...memory.decisions, newDecision.trim()] })
                setNewDecision('')
              }
            }}
            placeholder="Thêm quyết định kỹ thuật..."
            className="flex-1 px-2.5 py-1 rounded-lg border outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => {
              if (!newDecision.trim()) return
              void updateMemory(session.id, { decisions: [...memory.decisions, newDecision.trim()] })
              setNewDecision('')
            }}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Pinned Notes */}
      <div className="space-y-1.5">
        <label className="font-medium" style={{ color: 'var(--muted)' }}>
          Lưu ý ghim (luôn nhắc AI)
        </label>
        {memory.pinnedNotes.map((n, idx) => (
          <div
            key={idx}
            className="flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-lg border"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <span className="leading-snug">{n}</span>
            <button
              type="button"
              onClick={() =>
                void updateMemory(session.id, {
                  pinnedNotes: memory.pinnedNotes.filter((_, i) => i !== idx)
                })
              }
              className="text-red-400 hover:opacity-75 cursor-pointer shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newNote.trim()) {
                void updateMemory(session.id, { pinnedNotes: [...memory.pinnedNotes, newNote.trim()] })
                setNewNote('')
              }
            }}
            placeholder="Thêm lưu ý (vd: không sửa schema DB cũ)..."
            className="flex-1 px-2.5 py-1 rounded-lg border outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => {
              if (!newNote.trim()) return
              void updateMemory(session.id, { pinnedNotes: [...memory.pinnedNotes, newNote.trim()] })
              setNewNote('')
            }}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Key Files */}
      {memory.keyFiles.length > 0 && (
        <div className="space-y-1">
          <div className="font-medium" style={{ color: 'var(--muted)' }}>
            File trọng tâm ({memory.keyFiles.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {memory.keyFiles.map((f) => (
              <span
                key={f}
                className="px-2 py-0.5 rounded border font-mono text-[10.5px] truncate max-w-full"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
