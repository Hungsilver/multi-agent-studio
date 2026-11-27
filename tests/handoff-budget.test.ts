import { describe, expect, it } from 'vitest'
import { buildHandoffPrompt } from '../src/main/ai/context-memory'
import { WorkspaceDatabase } from '../src/main/storage/database'
import { WorkspaceRepository } from '../src/main/storage/repositories'
import type { AiTurn, SessionMemory } from '../src/shared/types/ai'

const memory: SessionMemory = {
  sessionId: 's',
  goal: 'Mục tiêu',
  summary: '',
  decisions: [],
  pinnedNotes: [],
  keyFiles: [],
  activeSkillIds: [],
  compactedUpToTurnIndex: 0,
  updatedAt: new Date().toISOString()
}

function turn(idx: number, reply: string): AiTurn {
  return {
    id: `t${idx}`,
    sessionId: 's',
    turnIndex: idx,
    provider: 'claude',
    model: '',
    userPrompt: `yêu cầu ${idx}`,
    attachments: [],
    preTreeHash: null,
    postTreeHash: null,
    untrackedBackupId: null,
    status: 'completed',
    durationMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    costUsd: 0,
    createdAt: new Date().toISOString(),
    events: [
      { id: idx, turnId: `t${idx}`, seq: 1, event: { type: 'text.delta', text: reply }, createdAt: '' }
    ]
  }
}

describe('Handoff history budget', () => {
  it('keeps the newest turns detailed and compresses old ones when history is huge', () => {
    const big = 'x'.repeat(2500)
    const turns = Array.from({ length: 80 }, (_, i) => turn(i + 1, `${big}KET-LUAN-${i + 1}`))
    const res = buildHandoffPrompt({
      targetProvider: 'codex',
      memory,
      turns,
      targetSyncState: null,
      activeSkills: [],
      repoSummary: null,
      userPrompt: 'tiếp tục'
    })
    // 80 lượt × ~2.5k ký tự sẽ vượt xa ngân sách; prompt phải bị chặn trần
    expect(res.compiledPrompt.length).toBeLessThan(90_000)
    expect(res.unsyncedTurnsCount).toBe(80)
    // lượt mới nhất còn nguyên phần kết luận (giữ cả đuôi), lượt cũ nhất chỉ còn dạng rút gọn
    expect(res.compiledPrompt).toContain('KET-LUAN-80')
    expect(res.compiledPrompt).not.toContain('KET-LUAN-1\n')
    expect(res.compiledPrompt).toContain('yêu cầu 1')
    expect(res.compiledPrompt).toContain('(đã rút gọn)')
    // thứ tự thời gian được giữ nguyên
    expect(res.compiledPrompt.indexOf('Lượt #1 ')).toBeLessThan(res.compiledPrompt.indexOf('Lượt #80 '))
  })
})

describe('Interrupted turn recovery', () => {
  it("marks leftover 'running' turns as stopped on startup", async () => {
    const db = new WorkspaceDatabase(':memory:')
    await db.init()
    const repo = new WorkspaceRepository(db)
    const ws = repo.upsertWorkspace('C:/tmp/recover-ws')
    const sess = repo.createSession({ workspaceId: ws.id, workspacePath: ws.path, provider: 'claude' })
    const running = repo.createTurn({
      sessionId: sess.id,
      provider: 'claude',
      model: '',
      userPrompt: 'dở dang',
      attachments: [],
      preTreeHash: null,
      untrackedBackupId: null,
      status: 'running'
    })
    expect(repo.recoverInterruptedTurns()).toBe(1)
    expect(repo.getTurn(running.id)?.status).toBe('stopped')
    expect(repo.recoverInterruptedTurns()).toBe(0)
  })
})
