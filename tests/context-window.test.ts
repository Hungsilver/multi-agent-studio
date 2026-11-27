import { describe, expect, it } from 'vitest'
import { buildHandoffPrompt, compactSessionMemoryFromTurns } from '../src/main/ai/context-memory'
import type { AiTurn, SessionMemory } from '../src/shared/types/ai'
import { estimateSessionContextUsage, getModelContextLimit } from '../src/shared/utils/context-window'

function makeTurn(turnIndex: number, provider: 'claude' | 'codex' | 'agy', prompt: string, reply: string, inputTokens = 0, outputTokens = 0): AiTurn {
  return {
    id: `turn-${turnIndex}`,
    sessionId: 'sess-ctx',
    turnIndex,
    provider,
    model: '',
    userPrompt: prompt,
    attachments: [],
    preTreeHash: null,
    postTreeHash: null,
    untrackedBackupId: null,
    status: 'completed',
    durationMs: 1000,
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
    costUsd: 0.01,
    createdAt: new Date().toISOString(),
    events: [
      {
        id: turnIndex,
        turnId: `turn-${turnIndex}`,
        seq: 1,
        event: { type: 'text.delta', text: reply },
        createdAt: new Date().toISOString()
      }
    ]
  }
}

describe('Context Window Estimator & Compaction', () => {
  it('resolves model context window limits accurately per provider & family', () => {
    expect(getModelContextLimit('claude', 'sonnet')).toBe(200_000)
    expect(getModelContextLimit('claude', 'claude-sonnet-5-5-1m')).toBe(1_000_000)
    expect(getModelContextLimit('codex', 'gpt-6-luna')).toBe(256_000)
    expect(getModelContextLimit('agy', 'gemini-4-neon-high')).toBe(1_000_000)
    expect(getModelContextLimit('agy', 'claude-opus-5-5-high')).toBe(200_000)
    expect(getModelContextLimit('agy', 'gpt-oss-120b-medium')).toBe(128_000)
  })

  it('tracks reported tokens before compact and reduces percentage cleanly after compact', () => {
    const baseMem: SessionMemory = {
      sessionId: 'sess-ctx',
      goal: 'Tối ưu API',
      summary: '',
      decisions: ['Dùng SQLite'],
      pinnedNotes: [],
      keyFiles: [],
      activeSkillIds: [],
      compactedUpToTurnIndex: 0,
      updatedAt: new Date().toISOString()
    }

    const turns = [
      makeTurn(1, 'claude', 'Đọc schema', 'Đã đọc schema xong', 80_000, 2_000),
      makeTurn(2, 'claude', 'Viết service', 'Đã viết service đầy đủ', 155_000, 5_000)
    ]

    const before = estimateSessionContextUsage({
      provider: 'claude',
      model: 'sonnet',
      turns,
      memory: baseMem
    })
    expect(before.source).toBe('reported')
    expect(before.usedTokens).toBe(160_000)
    expect(before.percent).toBe(80)
    expect(before.severity).toBe('warning')

    const compactedPatch = compactSessionMemoryFromTurns(baseMem, turns)
    const compactedMem: SessionMemory = { ...baseMem, ...compactedPatch, updatedAt: new Date().toISOString() }
    expect(compactedMem.compactedUpToTurnIndex).toBe(2)

    const after = estimateSessionContextUsage({
      provider: 'claude',
      model: 'sonnet',
      turns,
      memory: compactedMem
    })
    expect(after.activeTurnsCount).toBe(0)
    expect(after.usedTokens).toBeLessThan(1_000)
    expect(after.percent).toBeLessThan(1)

    const handoff = buildHandoffPrompt({
      targetProvider: 'agy',
      memory: compactedMem,
      turns,
      targetSyncState: null,
      activeSkills: [],
      repoSummary: null,
      userPrompt: 'Tiếp tục bước 3'
    })
    expect(handoff.unsyncedTurnsCount).toBe(0)
    expect(handoff.compiledPrompt).toContain('#1 (claude)')
    expect(handoff.compiledPrompt).not.toContain('#### Lượt #1')
  })
})
