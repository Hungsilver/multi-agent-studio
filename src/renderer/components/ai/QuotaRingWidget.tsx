import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, ArrowRight, Coins, Cpu, RefreshCw } from 'lucide-react'
import { PROVIDERS, PROVIDER_LIST } from '@shared/constants/providers'
import type { AiTurn, ProviderId, QuotaWindow } from '@shared/types/ai'
import { useSettingsStore } from '../../stores/useSettingsStore'

const AGY_CAP_OPTIONS = [
  { value: 500_000, label: '500K' },
  { value: 1_000_000, label: '1M' },
  { value: 2_000_000, label: '2M' },
  { value: 5_000_000, label: '5M' }
]

function formatResetCountdown(iso: string | null): string {
  if (!iso) return 'Bắt đầu từ tin nhắn đầu tiên'
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const diffMs = ts - Date.now()
  const dt = new Date(ts)
  const timeStr = dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  if (diffMs <= 0) return `Sắp reset · ${timeStr}`
  const mins = Math.round(diffMs / 60_000)
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  const countdown = days > 0 ? `${days}n ${remHrs}g` : hrs > 0 ? `${hrs}g ${remMins}p` : `${remMins}p`
  return `Reset sau ${countdown} · ${timeStr}`
}

function formatCompactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function colorForPercent(pct: number, severity?: QuotaWindow['severity']): string {
  if (severity === 'critical' || pct >= 90) return 'var(--err)'
  if (severity === 'warning' || pct >= 75) return 'var(--warn)'
  return 'var(--accent)'
}

interface QuotaRingWidgetProps {
  activeProvider: ProviderId
  turns: AiTurn[]
}

export function QuotaRingWidget({ activeProvider, turns }: QuotaRingWidgetProps): React.JSX.Element | null {
  const providerQuotas = useSettingsStore((s) => s.providerQuotas)
  const quotasLoading = useSettingsStore((s) => s.quotasLoading)
  const refreshProviderQuotas = useSettingsStore((s) => s.refreshProviderQuotas)
  const agyQuotaCap5h = useSettingsStore((s) => s.agyQuotaCap5h)
  const setAgyQuotaCap5h = useSettingsStore((s) => s.setAgyQuotaCap5h)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  const [hovered, setHovered] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(activeProvider)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  const [tooltipCoords, setTooltipCoords] = useState<{ top: number; left: number } | null>(null)
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    setSelectedProvider(activeProvider)
  }, [activeProvider])

  const activeQuota = useMemo(
    () => providerQuotas.find((q) => q.provider === activeProvider) ?? providerQuotas[0] ?? null,
    [providerQuotas, activeProvider]
  )

  const viewedQuota = useMemo(
    () => providerQuotas.find((q) => q.provider === selectedProvider) ?? activeQuota,
    [providerQuotas, selectedProvider, activeQuota]
  )

  const sessionStats = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let costUsd = 0
    for (const t of turns) {
      inputTokens += t.inputTokens ?? 0
      outputTokens += t.outputTokens ?? 0
      costUsd += t.costUsd ?? 0
    }
    return {
      turns: turns.length,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd
    }
  }, [turns])

  const primaryWindow = activeQuota?.windows?.[0] ?? null
  const ringPercent = primaryWindow
    ? Math.max(0, Math.min(100, primaryWindow.usedPercent))
    : activeQuota
      ? Math.min(100, Math.round((activeQuota.localStats.todayTurns / 100) * 100))
      : 0

  const ringStroke = colorForPercent(ringPercent, primaryWindow?.severity)
  const radius = 6.5
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - ringPercent / 100)

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
      const pos = computeFloatingPos(248, 86)
      if (pos) setTooltipCoords({ top: pos.top, left: pos.left })
    }
  }, [hovered, popoverOpen, computeFloatingPos])

  useEffect(() => {
    if (!popoverOpen) return
    const updatePos = (): void => {
      const pos = computeFloatingPos(368, 360)
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

  if (!activeQuota) return null

  const viewedMeta = PROVIDERS[viewedQuota?.provider ?? activeProvider]
  const activeMeta = PROVIDERS[activeProvider]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-quota-ring-trigger="true"
        aria-label={`Hạn mức ${activeMeta.name}: ${ringPercent}%`}
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
            setSelectedProvider(activeProvider)
            setHovered(false)
            setPopoverOpen(true)
          } else {
            setPopoverOpen(false)
          }
        }}
        className="w-7 h-6 rounded-md border flex items-center justify-center transition-colors btn-ghost cursor-pointer shrink-0"
        style={{
          borderColor: popoverOpen ? 'var(--accent)' : 'var(--border)',
          backgroundColor: popoverOpen ? 'var(--accent-soft)' : 'var(--surface)'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 18 18" className="block -rotate-90" aria-hidden="true">
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke="color-mix(in srgb, var(--muted) 28%, transparent)"
            strokeWidth="2.3"
          />
          <circle
            cx="9"
            cy="9"
            r={radius}
            fill="none"
            stroke={ringStroke}
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={ringPercent <= 0 ? circumference * 0.99 : dashOffset}
          />
        </svg>
      </button>

      {/* Hover Tooltip */}
      {hovered && !popoverOpen && tooltipCoords && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            data-quota-tooltip="true"
            className="fixed z-[125] rounded-xl border px-3 py-2 shadow-2xl pointer-events-none space-y-1 text-xs"
            style={{
              top: `${tooltipCoords.top}px`,
              left: `${tooltipCoords.left}px`,
              width: '248px',
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span className="truncate">
                {primaryWindow ? primaryWindow.label : `${activeMeta.shortName} · Hạn mức`}
              </span>
              <span className="tabular-nums shrink-0" style={{ color: ringStroke }}>
                {primaryWindow ? `${primaryWindow.usedPercent}%` : `${activeQuota.localStats.todayTurns} lượt`}
              </span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {primaryWindow ? formatResetCountdown(primaryWindow.resetsAt) : `Hôm nay: ${formatCompactTokens(activeQuota.localStats.todayTokens)} token`}
            </div>
            <div
              className="pt-1 border-t flex items-center justify-between text-[10.5px]"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              <span>Phiên: {formatCompactTokens(sessionStats.inputTokens)} in / {formatCompactTokens(sessionStats.outputTokens)} out</span>
              {sessionStats.costUsd > 0 && <span className="font-mono">${sessionStats.costUsd.toFixed(3)}</span>}
            </div>
          </div>,
          document.body
        )}

      {/* Detailed Click Popover */}
      {popoverOpen && popoverCoords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Chi tiết hạn mức & token"
            data-quota-popover="true"
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
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-[12.5px] truncate">
                  Hạn mức sử dụng · {viewedQuota?.planLabel || viewedMeta.shortName}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={quotasLoading}
                  onClick={() => void refreshProviderQuotas(true)}
                  className="p-1 rounded-md border btn-ghost cursor-pointer disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  title="Làm mới hạn mức"
                >
                  <RefreshCw className={`w-3 h-3 ${quotasLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPopoverOpen(false)
                    setActiveTab('usage')
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium hover:underline cursor-pointer"
                  style={{ color: 'var(--accent)' }}
                >
                  <span>Xem tất cả</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Provider mini tabs */}
            <div
              className="grid grid-cols-3 gap-1 p-0.5 rounded-lg border"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              {PROVIDER_LIST.map((p) => {
                const pq = providerQuotas.find((x) => x.provider === p.id)
                const topPct = pq?.windows?.[0]?.usedPercent
                const selected = (viewedQuota?.provider ?? activeProvider) === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProvider(p.id)}
                    className="flex items-center justify-center gap-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                    style={{
                      backgroundColor: selected ? 'var(--surface-elevated)' : 'transparent',
                      color: selected ? 'var(--text)' : 'var(--muted)'
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="truncate">{p.shortName}</span>
                    {typeof topPct === 'number' && (
                      <span className="text-[10px] font-mono opacity-80">{topPct}%</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Quota Windows Bars */}
            <div className="space-y-2.5">
              {(viewedQuota?.windows ?? []).length > 0 ? (
                viewedQuota!.windows.map((w) => {
                  const pct = Math.max(0, Math.min(100, w.usedPercent))
                  const color = colorForPercent(pct, w.severity)
                  return (
                    <div key={w.label} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="font-medium truncate">{w.label}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                            {formatResetCountdown(w.resetsAt)}
                          </span>
                          <span className="font-mono font-semibold tabular-nums" style={{ color }}>
                            {pct}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct > 0 ? Math.max(3, pct) : 0}%`,
                            backgroundColor: color
                          }}
                        />
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-[11px] py-1" style={{ color: 'var(--muted)' }}>
                  Chưa có thanh % hạn mức từ CLI này.
                </div>
              )}
            </div>

            {/* AGY Reference Threshold Selector */}
            {viewedQuota?.provider === 'agy' && (
              <div
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[10.5px]"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <span style={{ color: 'var(--muted)' }}>Ngưỡng AGY (5g):</span>
                <div className="flex items-center gap-1">
                  {AGY_CAP_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAgyQuotaCap5h(opt.value)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors"
                      style={{
                        backgroundColor: agyQuotaCap5h === opt.value ? 'var(--accent-soft)' : 'transparent',
                        color: agyQuotaCap5h === opt.value ? 'var(--accent)' : 'var(--muted)',
                        fontWeight: agyQuotaCap5h === opt.value ? 600 : 400
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Token Breakdown Grid */}
            <div className="grid grid-cols-3 gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="p-2 rounded-lg border space-y-0.5" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                  <Cpu className="w-3 h-3" />
                  <span>Phiên này</span>
                </div>
                <div className="font-mono text-[11px] font-semibold">
                  {formatCompactTokens(sessionStats.totalTokens)} tok
                </div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {formatCompactTokens(sessionStats.inputTokens)} in · {formatCompactTokens(sessionStats.outputTokens)} out
                </div>
              </div>

              <div className="p-2 rounded-lg border space-y-0.5" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                  <Activity className="w-3 h-3" />
                  <span>Hôm nay</span>
                </div>
                <div className="font-mono text-[11px] font-semibold">
                  {formatCompactTokens(viewedQuota?.localStats.todayTokens ?? 0)} tok
                </div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {viewedQuota?.localStats.todayTurns ?? 0} lượt chạy
                </div>
              </div>

              <div className="p-2 rounded-lg border space-y-0.5" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                  <Coins className="w-3 h-3" />
                  <span>7 ngày</span>
                </div>
                <div className="font-mono text-[11px] font-semibold">
                  {formatCompactTokens(viewedQuota?.localStats.weekTokens ?? 0)} tok
                </div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {viewedQuota?.localStats.weekTurns ?? 0} lượt · ${(viewedQuota?.localStats.weekCostUsd ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            {viewedQuota?.note && (
              <div className="text-[10px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                {viewedQuota.note}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
