import { describe, expect, it } from 'vitest'
import { fetchAgyQuota, parseClaudeUsagePayload, parseCodexRateLimitEvent } from '../src/main/ai/quota-service'

const dummyStats = {
  todayTurns: 3,
  todayTokens: 12000,
  weekTurns: 10,
  weekTokens: 450000,
  weekCostUsd: 0.25,
  fiveHourTurns: 2,
  fiveHourTokens: 250000,
  fiveHourResetsAt: '2026-11-26T16:00:00Z'
}

describe('quota-service parsers', () => {
  it('parses Claude OAuth usage payload into QuotaWindow list', () => {
    const res = parseClaudeUsagePayload(
      {
        five_hour: { utilization: 27.0, resets_at: '2026-11-26T11:00:00Z' },
        seven_day: { utilization: 78.4, resets_at: '2026-11-29T14:00:00Z' },
        seven_day_sonnet: null,
        extra_usage: { is_enabled: false }
      },
      'Claude Team',
      dummyStats
    )

    expect(res.provider).toBe('claude')
    expect(res.source).toBe('live-api')
    expect(res.planLabel).toBe('Claude Team')
    expect(res.windows).toHaveLength(2)
    expect(res.windows[0]).toMatchObject({ label: 'Cửa sổ 5 giờ', usedPercent: 27, severity: 'normal' })
    expect(res.windows[1]).toMatchObject({ label: 'Giới hạn 7 ngày', usedPercent: 78.4, severity: 'warning' })
  })

  it('parses Codex rate_limits event with unix epoch resets_at and plan_type', () => {
    const res = parseCodexRateLimitEvent(
      {
        limit_id: 'codex',
        plan_type: 'free',
        primary: { used_percent: 2.0, window_minutes: 43200, resets_at: 1797916910 },
        secondary: null,
        credits: { has_credits: false, unlimited: false, balance: null }
      },
      dummyStats
    )

    expect(res.provider).toBe('codex')
    expect(res.source).toBe('local-session')
    expect(res.planLabel).toBe('ChatGPT Free')
    expect(res.windows).toHaveLength(1)
    expect(res.windows[0].label).toBe('Hạn mức tháng (30 ngày)')
    expect(res.windows[0].usedPercent).toBe(2)
    expect(res.windows[0].resetsAt).toBe(new Date(1797916910 * 1000).toISOString())
  })

  it('computes AGY 5h and 7d quota windows from rolling token usage and reference cap', () => {
    const res = fetchAgyQuota(dummyStats, '2026-11-26T12:00:00Z', 1_000_000)
    expect(res.provider).toBe('agy')
    expect(res.windows).toHaveLength(2)
    expect(res.windows[0]).toMatchObject({
      usedPercent: 25,
      resetsAt: '2026-11-26T16:00:00Z',
      windowMinutes: 300,
      severity: 'normal'
    })
    expect(res.windows[1]).toMatchObject({
      usedPercent: 9,
      windowMinutes: 10080,
      severity: 'normal'
    })

    const resTight = fetchAgyQuota({ ...dummyStats, fiveHourTokens: 820_000 }, '2026-11-26T12:00:00Z', 1_000_000)
    expect(resTight.windows[0]).toMatchObject({ usedPercent: 82, severity: 'warning' })
  })
})
