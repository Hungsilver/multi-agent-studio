import { describe, expect, it } from 'vitest'
import { buildHandoffPrompt } from '../src/main/ai/context-memory'
import type { AiTurn, ProviderSyncState, SessionMemory } from '../src/shared/types/ai'

function makeTurn(turnIndex: number, provider: 'claude' | 'codex' | 'agy', prompt: string, reply: string): AiTurn {
  return {
    id: `turn-${turnIndex}`,
    sessionId: 'sess-1',
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
    inputTokens: 100,
    outputTokens: 50,
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

describe('Session Context Memory & Provider Handoff', () => {
  const memory: SessionMemory = {
    sessionId: 'sess-1',
    goal: 'Xây dựng API thanh toán',
    summary: 'Đã tạo xong controller và DTO',
    decisions: ['Dùng PostgreSQL transaction'],
    pinnedNotes: ['Không đổi chữ ký endpoint v1'],
    keyFiles: ['src/PaymentController.cs'],
    activeSkillIds: [],
    updatedAt: new Date().toISOString()
  }

  it('builds full handoff context when switching from Claude to Codex for the first time', () => {
    const turns = [
      makeTurn(1, 'claude', 'Phân tích module thanh toán', 'Đã đọc PaymentController.cs'),
      makeTurn(2, 'claude', 'Thêm validation', 'Đã thêm FluentValidation')
    ]

    const res = buildHandoffPrompt({
      targetProvider: 'codex',
      memory,
      turns,
      targetSyncState: null,
      activeSkills: [],
      repoSummary: null,
      userPrompt: 'Viết unit test cho validator'
    })

    expect(res.isHandoff).toBe(true)
    expect(res.unsyncedTurnsCount).toBe(2)
    expect(res.compiledPrompt).toContain('<session_context_handoff>')
    expect(res.compiledPrompt).toContain('Dùng PostgreSQL transaction')
    expect(res.compiledPrompt).toContain('Lượt #1')
    expect(res.compiledPrompt).toContain('Lượt #2')
    expect(res.compiledPrompt).toContain('Viết unit test cho validator')
  })

  it('only injects delta unsynced turns when switching back to Claude', () => {
    const turns = [
      makeTurn(1, 'claude', 'Phân tích module thanh toán', 'Đã đọc PaymentController.cs'),
      makeTurn(2, 'claude', 'Thêm validation', 'Đã thêm FluentValidation'),
      makeTurn(3, 'codex', 'Viết unit test', 'Đã thêm PaymentValidatorTests.cs')
    ]

    const claudeState: ProviderSyncState = {
      sessionId: 'sess-1',
      provider: 'claude',
      providerSessionId: 'cl-orig-session',
      lastSyncedTurnIndex: 2,
      updatedAt: new Date().toISOString()
    }

    const res = buildHandoffPrompt({
      targetProvider: 'claude',
      memory,
      turns,
      targetSyncState: claudeState,
      activeSkills: [],
      repoSummary: null,
      userPrompt: 'Review lại test vừa tạo'
    })

    expect(res.isHandoff).toBe(true)
    expect(res.unsyncedTurnsCount).toBe(1)
    expect(res.compiledPrompt).not.toContain('Lượt #1')
    expect(res.compiledPrompt).not.toContain('Lượt #2')
    expect(res.compiledPrompt).toContain('Lượt #3 (trên codex)')
    expect(res.compiledPrompt).toContain('PaymentValidatorTests.cs')
  })
})
