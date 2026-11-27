import type { AiTurn, NormalizedAgentEvent } from '../types/ai'

export function applyStreamEventToTurns(
  turns: AiTurn[],
  turnId: string,
  event: NormalizedAgentEvent
): AiTurn[] {
  return turns.map((t) => {
    if (t.id !== turnId) return t
    const nextSeq = (t.events[t.events.length - 1]?.seq ?? 0) + 1
    const base: AiTurn = {
      ...t,
      events: [
        ...t.events,
        { id: Date.now() + nextSeq, turnId, seq: nextSeq, event, createdAt: new Date().toISOString() }
      ]
    }
    if (event.type === 'turn.complete') {
      return {
        ...base,
        status: event.isError ? 'error' : 'completed',
        durationMs: event.durationMs,
        inputTokens: event.inputTokens ?? t.inputTokens,
        outputTokens: event.outputTokens ?? t.outputTokens,
        costUsd: event.costUsd ?? t.costUsd
      }
    }
    if (event.type === 'error') {
      return { ...base, status: 'error' }
    }
    return base
  })
}

export function applySessionStatusToTurns(
  turns: AiTurn[],
  sessionStatus: 'idle' | 'running' | 'error'
): AiTurn[] {
  if (sessionStatus === 'running') return turns
  const fallbackTurnStatus: AiTurn['status'] = sessionStatus === 'error' ? 'error' : 'completed'
  return turns.map((t) => (t.status === 'running' ? { ...t, status: fallbackTurnStatus } : t))
}
