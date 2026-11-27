import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProviderId, ProviderQuotaStatus, QuotaWindow } from '@shared/types/ai'
import type { WorkspaceRepository } from '../storage/repositories'

const QUOTA_CACHE_TTL_MS = 60_000
let quotaCache: { ts: number; cap5h: number; data: ProviderQuotaStatus[] } | null = null

function severityFor(pct: number): QuotaWindow['severity'] {
  if (pct >= 90) return 'critical'
  if (pct >= 75) return 'warning'
  return 'normal'
}

export function parseClaudeUsagePayload(
  payload: Record<string, unknown>,
  planLabel: string | null,
  localStats: ProviderQuotaStatus['localStats'],
  fetchedAt = new Date().toISOString()
): ProviderQuotaStatus {
  const windows: QuotaWindow[] = []
  const candidates: Array<{ key: string; label: string; mins: number }> = [
    { key: 'five_hour', label: 'Cửa sổ 5 giờ', mins: 300 },
    { key: 'seven_day', label: 'Giới hạn 7 ngày', mins: 10080 },
    { key: 'seven_day_sonnet', label: '7 ngày (Sonnet)', mins: 10080 },
    { key: 'seven_day_opus', label: '7 ngày (Opus)', mins: 10080 }
  ]

  for (const c of candidates) {
    const raw = payload[c.key]
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as { utilization?: unknown; resets_at?: unknown }
    if (typeof obj.utilization !== 'number' || Number.isNaN(obj.utilization)) continue
    const pct = Math.round(obj.utilization * 10) / 10
    windows.push({
      label: c.label,
      usedPercent: pct,
      resetsAt: typeof obj.resets_at === 'string' ? obj.resets_at : null,
      windowMinutes: c.mins,
      severity: severityFor(pct)
    })
  }

  let note: string | undefined
  const extra = payload.extra_usage as { is_enabled?: boolean; monthly_limit?: number | null; used_credits?: number | null } | undefined
  if (extra?.is_enabled) {
    note = `Extra usage đang bật${typeof extra.used_credits === 'number' ? ` · Đã dùng $${extra.used_credits}` : ''}`
  }

  return {
    provider: 'claude',
    available: true,
    planLabel,
    source: windows.length > 0 ? 'live-api' : 'local-db',
    fetchedAt,
    windows,
    localStats,
    note
  }
}

export function parseCodexRateLimitEvent(
  rateLimits: Record<string, unknown>,
  localStats: ProviderQuotaStatus['localStats'],
  fetchedAt = new Date().toISOString()
): ProviderQuotaStatus {
  const windows: QuotaWindow[] = []
  const labelForWindow = (mins?: number, fallback = 'Giới hạn phiên'): string => {
    if (!mins || !Number.isFinite(mins)) return fallback
    if (mins <= 360) return `Cửa sổ ${Math.max(1, Math.round(mins / 60))} giờ`
    if (mins === 10080) return 'Giới hạn 7 ngày'
    if (mins >= 40000) return 'Hạn mức tháng (30 ngày)'
    return `Cửa sổ ${Math.round(mins / 60)} giờ`
  }

  const pushWin = (raw: unknown, fallbackLabel: string): void => {
    if (!raw || typeof raw !== 'object') return
    const w = raw as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown }
    if (typeof w.used_percent !== 'number' || Number.isNaN(w.used_percent)) return
    const mins = typeof w.window_minutes === 'number' ? w.window_minutes : undefined
    const pct = Math.round(w.used_percent * 10) / 10
    windows.push({
      label: labelForWindow(mins, fallbackLabel),
      usedPercent: pct,
      resetsAt: typeof w.resets_at === 'number' ? new Date(w.resets_at * 1000).toISOString() : null,
      windowMinutes: mins,
      severity: severityFor(pct)
    })
  }

  pushWin(rateLimits.primary, 'Cửa sổ chính')
  pushWin(rateLimits.secondary, 'Cửa sổ phụ')

  const planRaw = typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : ''
  const planMap: Record<string, string> = {
    free: 'ChatGPT Free',
    plus: 'ChatGPT Plus',
    pro: 'ChatGPT Pro',
    team: 'ChatGPT Team',
    enterprise: 'ChatGPT Enterprise'
  }
  const planLabel = planRaw ? planMap[planRaw.toLowerCase()] ?? `Codex (${planRaw})` : 'OpenAI Codex'

  const credits = rateLimits.credits as { has_credits?: boolean; unlimited?: boolean; balance?: string | number | null } | undefined
  let note: string | undefined
  if (credits?.unlimited) {
    note = 'Gói không giới hạn credits.'
  } else if (credits?.has_credits && credits.balance !== null && credits.balance !== undefined) {
    note = `Credits còn lại: ${String(credits.balance)}`
  }

  return {
    provider: 'codex',
    available: true,
    planLabel,
    source: windows.length > 0 ? 'local-session' : 'local-db',
    fetchedAt,
    windows,
    localStats,
    note
  }
}

function readTailText(filePath: string, maxBytes = 96_000): string {
  const stat = fs.statSync(filePath)
  if (stat.size <= maxBytes) {
    return fs.readFileSync(filePath, 'utf8')
  }
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

async function fetchClaudeQuota(
  localStats: ProviderQuotaStatus['localStats'],
  fetchedAt: string
): Promise<ProviderQuotaStatus> {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!fs.existsSync(credPath)) {
    return {
      provider: 'claude',
      available: false,
      planLabel: null,
      source: 'local-db',
      fetchedAt,
      windows: [],
      localStats,
      note: 'Chưa đăng nhập Claude OAuth (/login). Đang hiển thị số liệu sử dụng nội bộ.'
    }
  }

  let subscriptionType = ''
  let rateLimitTier = ''
  let accessToken = ''
  try {
    const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8')) as {
      claudeAiOauth?: {
        accessToken?: string
        subscriptionType?: string
        rateLimitTier?: string
      }
    }
    accessToken = parsed.claudeAiOauth?.accessToken ?? ''
    subscriptionType = parsed.claudeAiOauth?.subscriptionType ?? ''
    rateLimitTier = parsed.claudeAiOauth?.rateLimitTier ?? ''
  } catch {
    return {
      provider: 'claude',
      available: false,
      planLabel: null,
      source: 'local-db',
      fetchedAt,
      windows: [],
      localStats,
      note: 'Không đọc được ~/.claude/.credentials.json.'
    }
  }

  const subMap: Record<string, string> = {
    team: 'Claude Team',
    pro: 'Claude Pro',
    max: 'Claude Max',
    enterprise: 'Claude Enterprise',
    free: 'Claude Free'
  }
  const planLabel = subscriptionType
    ? subMap[subscriptionType.toLowerCase()] ?? `Claude (${subscriptionType})`
    : rateLimitTier || 'Claude OAuth'

  if (!accessToken) {
    return {
      provider: 'claude',
      available: false,
      planLabel,
      source: 'local-db',
      fetchedAt,
      windows: [],
      localStats,
      note: 'Thiếu access token OAuth của Claude. Hãy chạy `claude /login`.'
    }
  }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1'
      },
      signal: AbortSignal.timeout(6000)
    })
    if (!res.ok) {
      return {
        provider: 'claude',
        available: false,
        planLabel,
        source: 'local-db',
        fetchedAt,
        windows: [],
        localStats,
        note: `Không lấy được hạn mức trực tuyến (HTTP ${res.status}). Hãy mở lại Claude CLI để làm mới phiên đăng nhập.`,
        error: `HTTP ${res.status}`
      }
    }
    const data = (await res.json()) as Record<string, unknown>
    return parseClaudeUsagePayload(data, planLabel, localStats, fetchedAt)
  } catch (err) {
    return {
      provider: 'claude',
      available: false,
      planLabel,
      source: 'local-db',
      fetchedAt,
      windows: [],
      localStats,
      note: 'Không kết nối được API hạn mức Anthropic. Đang hiển thị số liệu nội bộ.',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function findNewestCodexRollouts(sessionsRoot: string, maxFiles = 5): string[] {
  if (!fs.existsSync(sessionsRoot)) return []
  const files: Array<{ path: string; mtime: number }> = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: sessionsRoot, depth: 0 }]

  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = path.join(cur.dir, ent.name)
      if (ent.isDirectory() && cur.depth < 4) {
        stack.push({ dir: full, depth: cur.depth + 1 })
      } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        try {
          files.push({ path: full, mtime: fs.statSync(full).mtimeMs })
        } catch {
          // ignore
        }
      }
    }
  }

  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxFiles)
    .map((f) => f.path)
}

function fetchCodexQuota(
  localStats: ProviderQuotaStatus['localStats'],
  fetchedAt: string
): ProviderQuotaStatus {
  const codexHome = path.join(os.homedir(), '.codex')
  const rollouts = findNewestCodexRollouts(path.join(codexHome, 'sessions'), 6)

  for (const file of rollouts) {
    try {
      const tail = readTailText(file, 160_000)
      const lines = tail.split(/\r?\n/).reverse()
      for (const line of lines) {
        if (!line.includes('"rate_limits"')) continue
        const parsed = JSON.parse(line) as { payload?: { rate_limits?: Record<string, unknown> } }
        const rl = parsed.payload?.rate_limits
        if (rl && typeof rl === 'object') {
          return parseCodexRateLimitEvent(rl, localStats, fetchedAt)
        }
      }
    } catch {
      // ignore malformed line/file
    }
  }

  let planLabel: string | null = null
  const authPath = path.join(codexHome, 'auth.json')
  if (fs.existsSync(authPath)) {
    try {
      const a = JSON.parse(fs.readFileSync(authPath, 'utf8')) as { auth_mode?: string }
      if (a.auth_mode) planLabel = `Codex (${a.auth_mode})`
    } catch {
      // ignore
    }
  }

  return {
    provider: 'codex',
    available: false,
    planLabel,
    source: 'local-db',
    fetchedAt,
    windows: [],
    localStats,
    note: 'Chưa có dữ liệu rate_limits trong phiên Codex gần đây. Hãy chạy ít nhất 1 lượt Codex để cập nhật hạn mức.'
  }
}

function formatCapCompact(cap: number): string {
  if (cap >= 1_000_000) return `${(cap / 1_000_000).toFixed(cap % 1_000_000 === 0 ? 0 : 1)}M`
  return `${Math.round(cap / 1_000)}K`
}

export function fetchAgyQuota(
  localStats: ProviderQuotaStatus['localStats'],
  fetchedAt: string,
  referenceCap5h = 1_000_000
): ProviderQuotaStatus {
  let planLabel: string | null = 'Antigravity CLI'
  const logPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'cli.log')
  if (fs.existsSync(logPath)) {
    try {
      const tail = readTailText(logPath, 96_000)
      const matches = Array.from(tail.matchAll(/applyAuthResult:\s*email=([^,\s]+),\s*authMethod=([^,\r\n]+)/g))
      const last = matches[matches.length - 1]
      if (last) {
        const email = last[1]
        const method = last[2]
        const methodLabel = method === 'consumer' ? 'Consumer' : method
        planLabel = email ? `Antigravity ${methodLabel} · ${email}` : `Antigravity ${methodLabel}`
      }
    } catch {
      // ignore
    }
  }

  const cap5h = Math.max(100_000, Math.round(referenceCap5h))
  const cap7d = cap5h * 5
  const tokens5h = localStats.fiveHourTokens ?? localStats.todayTokens
  const pct5h = Math.min(100, Math.round((tokens5h / cap5h) * 1000) / 10)
  const pct7d = Math.min(100, Math.round((localStats.weekTokens / cap7d) * 1000) / 10)

  const windows: QuotaWindow[] = [
    {
      label: `Cửa sổ 5 giờ (${formatCapCompact(cap5h)} token)`,
      usedPercent: pct5h,
      resetsAt: tokens5h > 0 ? (localStats.fiveHourResetsAt ?? null) : null,
      windowMinutes: 300,
      severity: severityFor(pct5h)
    },
    {
      label: `Giới hạn 7 ngày (${formatCapCompact(cap7d)} token)`,
      usedPercent: pct7d,
      resetsAt: null,
      windowMinutes: 10080,
      severity: severityFor(pct7d)
    }
  ]

  return {
    provider: 'agy',
    available: true,
    planLabel,
    source: 'local-db',
    fetchedAt,
    windows,
    localStats,
    note: `AGY CLI chưa xuất % trực tiếp; thanh % tính theo token thực tế trong app so với ngưỡng tham chiếu (${formatCapCompact(cap5h)}/5g · ${formatCapCompact(cap7d)}/7n).`
  }
}

export async function getProviderQuotas(
  repo: WorkspaceRepository,
  forceRefresh = false,
  agyReferenceCap5h = 1_000_000
): Promise<ProviderQuotaStatus[]> {
  const cap5h = Math.max(100_000, Math.round(agyReferenceCap5h))
  if (!forceRefresh && quotaCache && quotaCache.cap5h === cap5h && Date.now() - quotaCache.ts < QUOTA_CACHE_TTL_MS) {
    return quotaCache.data
  }

  const fetchedAt = new Date().toISOString()
  const stats = repo.getProviderWindowStats()

  const [claude, codex, agy] = await Promise.all([
    fetchClaudeQuota(stats.claude, fetchedAt),
    Promise.resolve(fetchCodexQuota(stats.codex, fetchedAt)),
    Promise.resolve(fetchAgyQuota(stats.agy, fetchedAt, cap5h))
  ])

  const ordered = [claude, codex, agy]
  quotaCache = { ts: Date.now(), cap5h, data: ordered }
  return ordered
}
