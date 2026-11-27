import type { AiTurn, ProviderId, SessionMemory } from '../types/ai'

export interface ContextUsageInfo {
  usedTokens: number
  limitTokens: number
  percent: number
  historyTokens: number
  memoryTokens: number
  skillsTokens: number
  activeTurnsCount: number
  compactedUpToTurnIndex: number
  source: 'reported' | 'estimated'
  severity: 'normal' | 'warning' | 'critical'
}

export function getModelContextLimit(provider: ProviderId, model: string): number {
  const m = (model || '').toLowerCase()
  if (provider === 'claude') {
    return m.includes('1m') ? 1_000_000 : 200_000
  }
  if (provider === 'codex') {
    return 256_000
  }
  // Antigravity (agy) supports multi-family models
  if (m.includes('claude')) return 200_000
  if (m.includes('gpt-oss')) return 128_000
  return 1_000_000
}

function estimateTurnChars(turn: AiTurn): number {
  let chars = (turn.userPrompt || '').length
  for (const ev of turn.events) {
    const e = ev.event
    if (e.type === 'text.delta' || e.type === 'thinking.delta') {
      chars += e.text.length
    } else if (e.type === 'tool.result') {
      chars += Math.min(4000, (e.output || '').length)
    } else if (e.type === 'plan.proposed') {
      chars += (e.markdown || '').length
    }
  }
  return chars
}

export function estimateSessionContextUsage(params: {
  provider: ProviderId
  model: string
  turns: AiTurn[]
  memory: SessionMemory
  activeSkillsChars?: number
}): ContextUsageInfo {
  const limitTokens = getModelContextLimit(params.provider, params.model)
  const compactedUpTo = params.memory.compactedUpToTurnIndex ?? 0
  const activeTurns = params.turns.filter((t) => t.turnIndex > compactedUpTo)

  const memoryTextLen =
    (params.memory.goal || '').length +
    (params.memory.summary || '').length +
    params.memory.decisions.join('\n').length +
    params.memory.pinnedNotes.join('\n').length +
    params.memory.keyFiles.join(',').length

  const memoryTokens = Math.ceil(memoryTextLen / 3.8)
  const skillsTokens = Math.ceil((params.activeSkillsChars ?? 0) / 3.8)

  let lastReportedIdx = -1
  let reportedTotal = 0
  for (let i = activeTurns.length - 1; i >= 0; i--) {
    const t = activeTurns[i]
    if (t.status === 'completed' && (t.inputTokens ?? 0) > 0) {
      lastReportedIdx = i
      reportedTotal = (t.inputTokens ?? 0) + (t.outputTokens ?? 0)
      break
    }
  }

  let historyTokens = 0
  let source: 'reported' | 'estimated' = 'estimated'
  if (lastReportedIdx >= 0) {
    source = 'reported'
    historyTokens = reportedTotal
    for (let i = lastReportedIdx + 1; i < activeTurns.length; i++) {
      historyTokens += Math.ceil(estimateTurnChars(activeTurns[i]) / 3.8)
    }
  } else {
    for (const t of activeTurns) {
      historyTokens += Math.ceil(estimateTurnChars(t) / 3.8)
    }
  }

  const usedTokens =
    source === 'reported'
      ? Math.max(memoryTokens + skillsTokens, historyTokens)
      : historyTokens + memoryTokens + skillsTokens

  const percent = Math.min(100, Math.round((usedTokens / limitTokens) * 1000) / 10)
  const severity: ContextUsageInfo['severity'] =
    percent >= 85 ? 'critical' : percent >= 70 ? 'warning' : 'normal'

  return {
    usedTokens,
    limitTokens,
    percent,
    historyTokens,
    memoryTokens,
    skillsTokens,
    activeTurnsCount: activeTurns.length,
    compactedUpToTurnIndex: compactedUpTo,
    source,
    severity
  }
}
