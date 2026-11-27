import { useEffect, useState } from 'react'
import { Activity, BarChart3, Clock, Coins, Cpu, RefreshCw, ShieldCheck } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { QuotaWindow, UsageSummary } from '@shared/types/ai'
import { getDefaultModelForProvider, useSettingsStore } from '../../stores/useSettingsStore'

function formatResetTime(iso: string | null): string {
  if (!iso) return 'Chưa có mốc reset'
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const diffMs = ts - Date.now()
  const dt = new Date(ts)
  const timeStr = dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const dateStr = dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  if (diffMs <= 0) return `Sắp reset · ${timeStr} ${dateStr}`
  const mins = Math.round(diffMs / 60_000)
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  const countdown = days > 0 ? `${days}n ${remHrs}g` : hrs > 0 ? `${hrs}g ${remMins}p` : `${remMins}p`
  return `Reset sau ${countdown} · ${timeStr} ${dateStr}`
}

function sourceBadgeLabel(source: 'live-api' | 'local-session' | 'local-db' | 'unavailable'): string {
  if (source === 'live-api') return 'Trực tiếp'
  if (source === 'local-session') return 'Phiên CLI'
  if (source === 'local-db') return 'Nội bộ'
  return 'N/A'
}

function barColorFor(win: QuotaWindow): string {
  if (win.severity === 'critical' || win.usedPercent >= 90) return 'var(--err)'
  if (win.severity === 'warning' || win.usedPercent >= 75) return 'var(--warn)'
  return 'var(--accent)'
}

export function UsageDashboard(): React.JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const cliStatuses = useSettingsStore((s) => s.cliStatuses)
  const providerQuotas = useSettingsStore((s) => s.providerQuotas)
  const quotasLoading = useSettingsStore((s) => s.quotasLoading)
  const agyQuotaCap5h = useSettingsStore((s) => s.agyQuotaCap5h)
  const setAgyQuotaCap5h = useSettingsStore((s) => s.setAgyQuotaCap5h)
  const refreshProviderQuotas = useSettingsStore((s) => s.refreshProviderQuotas)

  const load = (forceQuotas = false): void => {
    void window.workspaceApi.getUsageSummary().then(setSummary)
    void refreshProviderQuotas(forceQuotas)
  }

  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const maxDailyTokens = Math.max(1, ...(summary?.daily.map((d) => d.inputTokens + d.outputTokens) ?? [1]))

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <h1 className="text-base font-semibold">Hạn mức AI &amp; Thống kê Token, Chi phí</h1>
          </div>
          <button
            type="button"
            disabled={quotasLoading}
            onClick={() => load(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs btn-ghost cursor-pointer disabled:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${quotasLoading ? 'animate-spin' : ''}`} />
            <span>{quotasLoading ? 'Đang cập nhật…' : 'Làm mới'}</span>
          </button>
        </div>

        {/* Live Quotas & Rate Limits */}
        <section
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="text-sm font-semibold">Hạn mức sử dụng AI hiện tại (Quota &amp; Rate Limits)</h2>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              Tự động đọc trực tiếp từ phiên OAuth / CLI &amp; dữ liệu phiên làm việc
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {providerQuotas.map((q) => {
              const meta = PROVIDERS[q.provider]
              const defModel = getDefaultModelForProvider(cliStatuses, q.provider)
              return (
                <div
                  key={q.provider}
                  className="p-3.5 rounded-xl border space-y-2.5 text-xs"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                      <span className="font-semibold truncate">{meta.name}</span>
                      {q.planLabel && (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10.5px] font-medium truncate max-w-[170px]"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          title={q.planLabel}
                        >
                          {q.planLabel}
                        </span>
                      )}
                    </div>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 border"
                      style={{
                        borderColor: 'var(--border)',
                        color: q.source === 'live-api' ? 'var(--ok)' : 'var(--muted)'
                      }}
                    >
                      {sourceBadgeLabel(q.source)}
                    </span>
                  </div>

                  {defModel.model && (
                    <div className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                      <span>Model mặc định CLI:</span>
                      <code className="font-mono px-1.5 py-0.2 rounded bg-subtle" style={{ color: 'var(--text)' }}>
                        {defModel.model}
                      </code>
                    </div>
                  )}

                  {q.windows.length > 0 ? (
                    <div className="space-y-2">
                      {q.windows.map((w) => {
                        const pct = Math.max(0, Math.min(100, w.usedPercent))
                        const remaining = Math.max(0, Math.round((100 - pct) * 10) / 10)
                        return (
                          <div key={w.label} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-medium">{w.label}</span>
                              <span className="font-mono">
                                <strong>{pct}%</strong> đã dùng · <span style={{ color: 'var(--muted)' }}>còn {remaining}%</span>
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${Math.max(2, pct)}%`, backgroundColor: barColorFor(w) }}
                              />
                            </div>
                            {w.resetsAt && (
                              <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                                {formatResetTime(w.resetsAt)}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] py-1" style={{ color: 'var(--muted)' }}>
                      Chưa có thanh % hạn mức từ CLI.
                    </div>
                  )}

                  <div
                    className="pt-2 border-t flex items-center justify-between gap-2 text-[11px]"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      Hôm nay: <strong style={{ color: 'var(--text)' }}>{q.localStats.todayTurns}</strong> lượt ·{' '}
                      {(q.localStats.todayTokens / 1000).toFixed(1)}k tok
                    </span>
                    <span>
                      7 ngày: <strong style={{ color: 'var(--text)' }}>{q.localStats.weekTurns}</strong> lượt ·{' '}
                      {(q.localStats.weekTokens / 1000).toFixed(1)}k tok
                    </span>
                  </div>

                  {q.provider === 'agy' && (
                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span style={{ color: 'var(--muted)' }}>Ngưỡng 5 giờ:</span>
                      <div className="flex items-center gap-1">
                        {[
                          { value: 500_000, label: '500K' },
                          { value: 1_000_000, label: '1M' },
                          { value: 2_000_000, label: '2M' },
                          { value: 5_000_000, label: '5M' }
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setAgyQuotaCap5h(opt.value)}
                            className="px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer"
                            style={{
                              borderColor: agyQuotaCap5h === opt.value ? 'var(--accent)' : 'var(--border)',
                              backgroundColor: agyQuotaCap5h === opt.value ? 'var(--accent-soft)' : 'transparent',
                              color: agyQuotaCap5h === opt.value ? 'var(--accent)' : 'var(--muted)'
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {q.note && (
                    <div className="text-[10.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                      {q.note}
                    </div>
                  )}
                </div>
              )
            })}

            {providerQuotas.length === 0 && (
              <div className="text-xs col-span-2 py-4 text-center" style={{ color: 'var(--muted)' }}>
                {quotasLoading ? 'Đang tải hạn mức AI…' : 'Chưa có dữ liệu hạn mức. Bấm "Làm mới" để kiểm tra.'}
              </div>
            )}
          </div>
        </section>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Tổng lượt chạy', value: String(summary?.totalTurns ?? 0), icon: Cpu },
            {
              label: 'Tổng Token (In / Out)',
              value: `${((summary?.totalInputTokens ?? 0) / 1000).toFixed(1)}k / ${((summary?.totalOutputTokens ?? 0) / 1000).toFixed(1)}k`,
              icon: BarChart3
            },
            { label: 'Ước tính chi phí', value: `$${(summary?.totalCostUsd ?? 0).toFixed(4)}`, icon: Coins },
            { label: 'Tổng thời gian', value: `${Math.round((summary?.totalDurationMs ?? 0) / 1000)}s`, icon: Clock }
          ].map((c) => {
            const Icon = c.icon
            return (
              <div
                key={c.label}
                className="p-4 rounded-xl border space-y-2"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                  <span>{c.label}</span>
                  <Icon className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                </div>
                <div className="text-xl font-bold">{c.value}</div>
              </div>
            )
          })}
        </div>

        {/* By Provider */}
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold">Phân bổ theo Công cụ AI</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(summary?.byProvider ?? []).map((p) => {
              const meta = PROVIDERS[p.provider]
              return (
                <div
                  key={p.provider}
                  className="p-3 rounded-lg border space-y-1 text-xs"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span>{meta.name}</span>
                  </div>
                  <div style={{ color: 'var(--muted)' }}>{p.turns} lượt · {Math.round(p.durationMs / 1000)}s</div>
                  <div className="font-mono text-[11px]">
                    In: {p.inputTokens.toLocaleString()} · Out: {p.outputTokens.toLocaleString()}
                  </div>
                  <div className="font-semibold" style={{ color: 'var(--ok)' }}>
                    ${p.costUsd.toFixed(4)}
                  </div>
                </div>
              )
            })}
            {(summary?.byProvider.length ?? 0) === 0 && (
              <div className="text-xs col-span-4 py-4 text-center" style={{ color: 'var(--muted)' }}>
                Chưa có dữ liệu lượt chạy nào.
              </div>
            )}
          </div>
        </div>

        {/* Daily Bar Chart */}
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold">14 ngày gần nhất</h2>
          <div className="space-y-2 text-xs">
            {(summary?.daily ?? []).map((d) => {
              const total = d.inputTokens + d.outputTokens
              const pct = Math.max(4, Math.round((total / maxDailyTokens) * 100))
              return (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="w-24 font-mono shrink-0" style={{ color: 'var(--muted)' }}>
                    {d.date}
                  </span>
                  <div className="flex-1 h-4 rounded overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
                    <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
                  </div>
                  <span className="w-36 text-right font-mono shrink-0">
                    {d.turns} lượt · {(total / 1000).toFixed(1)}k tok
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
