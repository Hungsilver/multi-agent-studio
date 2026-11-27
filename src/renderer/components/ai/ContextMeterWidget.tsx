import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cpu, Minimize2 } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiSession, AiTurn, SessionMemory } from '@shared/types/ai'
import { estimateSessionContextUsage } from '@shared/utils/context-window'
import { useAiStore } from '../../stores/useAiStore'
import { useGovernanceStore } from '../../stores/useGovernanceStore'
import { getDefaultModelForProvider, useSettingsStore } from '../../stores/useSettingsStore'

const THRESHOLD_OPTIONS = [70, 80, 85, 90]

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function severityColor(severity: 'normal' | 'warning' | 'critical'): string {
  if (severity === 'critical') return 'var(--err)'
  if (severity === 'warning') return 'var(--warn)'
  return 'var(--accent)'
}

interface ContextMeterWidgetProps {
  session: AiSession
  turns: AiTurn[]
  memory: SessionMemory
  compact?: boolean
}

export function ContextMeterWidget({
  session,
  turns,
  memory,
  compact = false
}: ContextMeterWidgetProps): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const cliStatuses = useSettingsStore((s) => s.cliStatuses)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const showToast = useSettingsStore((s) => s.showToast)
  const compactSessionContext = useAiStore((s) => s.compactSessionContext)
  const skills = useGovernanceStore((s) => s.skills)

  const [hovered, setHovered] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [compacting, setCompacting] = useState(false)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  const [tooltipCoords, setTooltipCoords] = useState<{ top: number; left: number } | null>(null)
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const activeSkillsChars = useMemo(
    () =>
      skills
        .filter((s) => memory.activeSkillIds.includes(s.id) || memory.activeSkillIds.includes(s.name))
        .reduce((sum, s) => sum + s.body.length, 0),
    [skills, memory.activeSkillIds]
  )

  const effectiveModel = session.model || getDefaultModelForProvider(cliStatuses, session.provider).model || ''
  const usage = useMemo(
    () =>
      estimateSessionContextUsage({
        provider: session.provider,
        model: effectiveModel,
        turns,
        memory,
        activeSkillsChars
      }),
    [session.provider, effectiveModel, turns, memory, activeSkillsChars]
  )

  const barColor = severityColor(usage.severity)
  const autoEnabled = settings.autoCompactEnabled ?? true
  const autoThreshold = settings.autoCompactThreshold ?? 80

  const computeFloatingPos = useCallback((width: number, estimatedHeight: number) => {
    const el = triggerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const margin = 10
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.right - width))
    let top = rect.top - estimatedHeight - 8
    if (top < margin) {
      top = Math.min(window.innerHeight - estimatedHeight - margin, rect.bottom + 8)
    }
    return { top: Math.max(margin, top), left, width }
  }, [])

  useEffect(() => {
    if (hovered && !popoverOpen) {
      const pos = computeFloatingPos(246, 92)
      if (pos) setTooltipCoords({ top: pos.top, left: pos.left })
    }
  }, [hovered, popoverOpen, computeFloatingPos])

  useEffect(() => {
    if (!popoverOpen) return
    const updatePos = (): void => {
      const pos = computeFloatingPos(348, 300)
      if (pos) setPopoverCoords(pos)
    }
    updatePos()

    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setPopoverOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPopoverOpen(false)
    }
    const onCloseOthers = (): void => setPopoverOpen(false)

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('aict:close-selects', onCloseOthers)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('aict:close-selects', onCloseOthers)
    }
  }, [popoverOpen, computeFloatingPos])

  const handleManualCompact = async (): Promise<void> => {
    if (session.status === 'running') {
      showToast('Hãy dừng phiên chạy trước khi nén ngữ cảnh', 'err')
      return
    }
    setCompacting(true)
    try {
      const res = await compactSessionContext(session.id)
      showToast(
        `Đã nén ${res.compactedTurnsCount} lượt (${formatTokensCompact(res.beforeTokens)} → ${formatTokensCompact(res.afterTokens)} token)`,
        'ok'
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Nén ngữ cảnh thất bại', 'err')
    } finally {
      setCompacting(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-context-meter-trigger="true"
        aria-label={`Ngữ cảnh phiên: ${usage.percent}% (${formatTokensCompact(usage.usedTokens)} / ${formatTokensCompact(usage.limitTokens)})`}
        aria-expanded={popoverOpen}
        onMouseEnter={() => {
          if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current)
          setHovered(true)
        }}
        onMouseLeave={() => {
          hoverTimerRef.current = window.setTimeout(() => setHovered(false), 90)
        }}
        onClick={() => {
          if (!popoverOpen) {
            window.dispatchEvent(new CustomEvent('aict:close-selects'))
            setHovered(false)
            setPopoverOpen(true)
          } else {
            setPopoverOpen(false)
          }
        }}
        className="h-6 px-2 rounded-md border flex items-center gap-1.5 text-[10.5px] transition-colors btn-ghost cursor-pointer shrink-0"
        style={{
          borderColor: popoverOpen ? 'var(--accent)' : 'var(--border)',
          backgroundColor: popoverOpen ? 'var(--accent-soft)' : 'var(--surface)',
          color: usage.severity === 'normal' ? 'var(--muted)' : barColor
        }}
      >
        <span className="w-8 h-1.5 rounded-full overflow-hidden shrink-0" style={{ backgroundColor: 'var(--bg)' }}>
          <span
            className="block h-full rounded-full transition-all"
            style={{ width: `${usage.percent > 0 ? Math.max(6, usage.percent) : 0}%`, backgroundColor: barColor }}
          />
        </span>
        <span className="font-mono tabular-nums">
          {compact ? `${usage.percent}%` : `Ngữ cảnh ${usage.percent}%`}
        </span>
      </button>

      {hovered && !popoverOpen && tooltipCoords && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            data-context-tooltip="true"
            className="fixed z-[125] rounded-xl border px-3 py-2 shadow-2xl pointer-events-none space-y-1 text-xs"
            style={{
              top: `${tooltipCoords.top}px`,
              left: `${tooltipCoords.left}px`,
              width: '246px',
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <div className="flex items-center justify-between font-semibold">
              <span>Cửa sổ ngữ cảnh</span>
              <span className="font-mono tabular-nums" style={{ color: barColor }}>
                {usage.percent}%
              </span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {formatTokensCompact(usage.usedTokens)} / {formatTokensCompact(usage.limitTokens)} token · {usage.activeTurnsCount} lượt hoạt động
            </div>
            <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
              Tự động nén: {autoEnabled ? `Bật (${autoThreshold}%)` : 'Tắt'} · Bấm để Compact
            </div>
          </div>,
          document.body
        )}

      {popoverOpen && popoverCoords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Chi tiết cửa sổ ngữ cảnh & Compact"
            data-context-popover="true"
            className="fixed z-[125] rounded-2xl border shadow-2xl p-3.5 space-y-3 text-xs"
            style={{
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
              width: `${popoverCoords.width}px`,
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[12.5px]">
                <Cpu className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span>Ngữ cảnh phiên ({PROVIDERS[session.provider].shortName})</span>
              </div>
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                Max {formatTokensCompact(usage.limitTokens)}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: 'var(--muted)' }}>
                  {formatTokensCompact(usage.usedTokens)} / {formatTokensCompact(usage.limitTokens)} token
                  {usage.source === 'estimated' ? ' (ước tính)' : ''}
                </span>
                <span className="font-mono font-semibold" style={{ color: barColor }}>
                  {usage.percent}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${usage.percent > 0 ? Math.max(3, usage.percent) : 0}%`, backgroundColor: barColor }}
                />
              </div>
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
              <div className="p-2 rounded-lg border" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div style={{ color: 'var(--muted)' }}>Hội thoại</div>
                <div className="font-mono font-semibold mt-0.5">{formatTokensCompact(usage.historyTokens)}</div>
              </div>
              <div className="p-2 rounded-lg border" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div style={{ color: 'var(--muted)' }}>Memory</div>
                <div className="font-mono font-semibold mt-0.5">{formatTokensCompact(usage.memoryTokens)}</div>
              </div>
              <div className="p-2 rounded-lg border" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div style={{ color: 'var(--muted)' }}>Skills</div>
                <div className="font-mono font-semibold mt-0.5">{formatTokensCompact(usage.skillsTokens)}</div>
              </div>
            </div>

            {/* Manual Compact CTA */}
            <button
              type="button"
              data-compact-now-btn="true"
              disabled={compacting || session.status === 'running' || usage.activeTurnsCount === 0}
              onClick={() => void handleManualCompact()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold text-white cursor-pointer disabled:opacity-45 transition-opacity"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>
                {compacting
                  ? 'Đang nén ngữ cảnh…'
                  : usage.activeTurnsCount === 0
                    ? 'Không có lượt mới cần nén'
                    : `Nén ngữ cảnh ngay (${usage.activeTurnsCount} lượt · /compact)`}
              </span>
            </button>

            {/* Auto-Compact Controls */}
            <div
              className="pt-2 border-t space-y-2 text-[11px]"
              style={{ borderColor: 'var(--border)' }}
            >
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span style={{ color: 'var(--text)' }}>Tự động nén khi ngữ cảnh đầy</span>
                <input
                  type="checkbox"
                  checked={autoEnabled}
                  onChange={(e) => void updateSettings({ autoCompactEnabled: e.target.checked })}
                />
              </label>

              {autoEnabled && (
                <div className="flex items-center justify-between gap-2">
                  <span style={{ color: 'var(--muted)' }}>Ngưỡng kích hoạt:</span>
                  <div className="flex items-center gap-1">
                    {THRESHOLD_OPTIONS.map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => void updateSettings({ autoCompactThreshold: pct })}
                        className="px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer"
                        style={{
                          borderColor: autoThreshold === pct ? 'var(--accent)' : 'var(--border)',
                          backgroundColor: autoThreshold === pct ? 'var(--accent-soft)' : 'transparent',
                          color: autoThreshold === pct ? 'var(--accent)' : 'var(--muted)'
                        }}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {memory.compactedUpToTurnIndex > 0 && (
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  Đã nén lịch sử tới lượt #{memory.compactedUpToTurnIndex} vào Session Memory.
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
