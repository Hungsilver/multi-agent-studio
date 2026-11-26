import { useEffect, useState } from 'react'
import { BarChart3, Clock, Coins, Cpu, RefreshCw } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { UsageSummary } from '@shared/types/ai'

export function UsageDashboard(): React.JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)

  const load = (): void => {
    void window.workspaceApi.getUsageSummary().then(setSummary)
  }

  useEffect(() => {
    load()
  }, [])

  const maxDailyTokens = Math.max(1, ...(summary?.daily.map((d) => d.inputTokens + d.outputTokens) ?? [1]))

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <h1 className="text-base font-semibold">Thống kê Token, Thời gian &amp; Chi phí AI</h1>
          </div>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
        </div>

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
