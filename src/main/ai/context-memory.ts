import type { AiTurn, ProviderId, ProviderSyncState, SessionMemory } from '@shared/types/ai'
import type { SkillItem } from '@shared/types/governance'
import type { RepoSummary } from '@shared/types/git'

export function summarizeTurnOutput(turn: AiTurn): { text: string; tools: string[] } {
  let text = ''
  const tools: string[] = []
  for (const ev of turn.events) {
    const e = ev.event
    if (e.type === 'text.delta') {
      text += e.text
    } else if (e.type === 'tool.start') {
      tools.push(`${e.name}${e.summary ? ` (${e.summary})` : ''}`)
    }
  }
  return { text: text.trim(), tools }
}

export function extractKeyFilesFromTurn(turn: AiTurn): string[] {
  const files = new Set<string>()
  for (const ev of turn.events) {
    if (ev.event.type === 'tool.start') {
      const inp = ev.event.input
      for (const k of ['file_path', 'path', 'TargetFile', 'AbsolutePath']) {
        const val = inp[k]
        if (typeof val === 'string' && val.trim()) {
          files.add(val.trim())
        }
      }
    }
  }
  for (const att of turn.attachments) {
    if (att.path && (att.type === 'file' || att.type === 'folder')) {
      files.add(att.path)
    }
  }
  return Array.from(files)
}

export function buildHandoffPrompt(params: {
  targetProvider: ProviderId
  memory: SessionMemory
  turns: AiTurn[]
  targetSyncState: ProviderSyncState | null
  activeSkills: SkillItem[]
  repoSummary: RepoSummary | null
  userPrompt: string
}): {
  compiledPrompt: string
  unsyncedTurnsCount: number
  isHandoff: boolean
} {
  const { targetProvider, memory, turns, targetSyncState, activeSkills, repoSummary, userPrompt } = params
  const lastSyncedIdx = targetSyncState?.lastSyncedTurnIndex ?? 0
  const unsyncedTurns = turns.filter((t) => t.turnIndex > lastSyncedIdx && t.status !== 'running')

  // Nếu cùng provider và đã sync hết mọi turn, vẫn chèn active skills / pinned memory nếu là lượt đầu hoặc có thay đổi
  const hasMemoryContext =
    Boolean(memory.goal.trim()) ||
    Boolean(memory.summary.trim()) ||
    memory.decisions.length > 0 ||
    memory.pinnedNotes.length > 0

  const needsHandoff = unsyncedTurns.length > 0 || (!targetSyncState?.providerSessionId && (hasMemoryContext || activeSkills.length > 0))

  if (!needsHandoff && activeSkills.length === 0) {
    return {
      compiledPrompt: userPrompt,
      unsyncedTurnsCount: 0,
      isHandoff: false
    }
  }

  const sections: string[] = []

  if (needsHandoff) {
    sections.push('<session_context_handoff>')
    sections.push(
      `Bạn đang tiếp quản phiên làm việc này trên công cụ **${targetProvider.toUpperCase()}**. Dưới đây là toàn bộ bộ nhớ phiên và các lượt hội thoại trước để đảm bảo giữ nguyên 100% ngữ cảnh.`
    )

    if (repoSummary?.isRepo) {
      sections.push(
        `### Trạng thái Git hiện tại\n- Nhánh: \`${repoSummary.branch}\`\n- Thay đổi chưa commit: +${repoSummary.addedLines} / -${repoSummary.deletedLines}, ${repoSummary.untrackedCount} file mới`
      )
    }

    if (hasMemoryContext) {
      const memLines: string[] = ['### Bộ nhớ ngữ cảnh phiên (Session Memory)']
      if (memory.goal.trim()) memLines.push(`- **Mục tiêu:** ${memory.goal.trim()}`)
      if (memory.summary.trim()) memLines.push(`- **Tóm tắt tiến độ:** ${memory.summary.trim()}`)
      if (memory.decisions.length > 0) {
        memLines.push(`- **Quyết định kỹ thuật đã chốt:**\n${memory.decisions.map((d) => `  - ${d}`).join('\n')}`)
      }
      if (memory.pinnedNotes.length > 0) {
        memLines.push(`- **Lưu ý ghim:**\n${memory.pinnedNotes.map((n) => `  - ${n}`).join('\n')}`)
      }
      if (memory.keyFiles.length > 0) {
        memLines.push(`- **File trọng tâm:** ${memory.keyFiles.slice(0, 15).map((f) => `\`${f}\``).join(', ')}`)
      }
      sections.push(memLines.join('\n'))
    }

    if (unsyncedTurns.length > 0) {
      const historyLines: string[] = [`### Lịch sử ${unsyncedTurns.length} lượt trao đổi chưa đồng bộ sang ${targetProvider}`]
      for (const t of unsyncedTurns) {
        const { text, tools } = summarizeTurnOutput(t)
        const trimmedReply = text.length > 2600 ? `${text.slice(0, 2600)}\n...(đã rút gọn)...` : text
        historyLines.push(`#### Lượt #${t.turnIndex} (trên ${t.provider})`)
        historyLines.push(`**Người dùng:**\n${t.userPrompt}`)
        if (tools.length > 0) {
          historyLines.push(`**Thao tác đã chạy:** ${tools.slice(0, 12).join('; ')}`)
        }
        if (trimmedReply) {
          historyLines.push(`**Trợ lý trả lời:**\n${trimmedReply}`)
        }
      }
      sections.push(historyLines.join('\n\n'))
    }

    sections.push('</session_context_handoff>')
  }

  if (activeSkills.length > 0) {
    const skillBlocks = activeSkills.map(
      (s) => `<active_skill name="${s.name}">\n${s.body.trim()}\n</active_skill>`
    )
    sections.push(skillBlocks.join('\n\n'))
  }

  sections.push(userPrompt)

  return {
    compiledPrompt: sections.join('\n\n'),
    unsyncedTurnsCount: unsyncedTurns.length,
    isHandoff: unsyncedTurns.length > 0
  }
}

export function compactSessionMemoryFromTurns(memory: SessionMemory, turns: AiTurn[]): Omit<SessionMemory, 'sessionId' | 'updatedAt'> {
  const completed = turns.filter((t) => t.status === 'completed')
  const keyFilesSet = new Set(memory.keyFiles)
  const turnBullets: string[] = []

  for (const t of completed.slice(-12)) {
    for (const f of extractKeyFilesFromTurn(t)) keyFilesSet.add(f)
    const { text, tools } = summarizeTurnOutput(t)
    const firstLine = (t.userPrompt.split(/\r?\n/)[0] || '').slice(0, 90)
    const replyHead = (text.split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 110)
    const toolNote = tools.length > 0 ? ` [${tools.length} tools]` : ''
    turnBullets.push(`#${t.turnIndex} (${t.provider}): ${firstLine}${toolNote}${replyHead ? ` → ${replyHead}` : ''}`)
  }

  const goal = memory.goal.trim() || (completed[0]?.userPrompt.split(/\r?\n/)[0] ?? '').slice(0, 140)
  const summary = turnBullets.join('\n')

  return {
    goal,
    summary,
    decisions: memory.decisions,
    pinnedNotes: memory.pinnedNotes,
    keyFiles: Array.from(keyFilesSet).slice(0, 30),
    activeSkillIds: memory.activeSkillIds
  }
}
