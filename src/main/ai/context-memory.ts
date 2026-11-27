import type { AiTurn, ProviderId, ProviderSyncState, SessionMemory } from '@shared/types/ai'
import type { SkillItem } from '@shared/types/governance'
import type { RepoSummary } from '@shared/types/git'

const HANDOFF_HISTORY_CHAR_BUDGET = 60_000

/** Cắt giữa: giữ đầu + đuôi (kết luận thường nằm ở cuối câu trả lời). */
function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.6)
  const tail = max - head
  return `${text.slice(0, head)}
...(đã rút gọn)...
${text.slice(text.length - tail)}`
}

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
  const compactedIdx = memory.compactedUpToTurnIndex ?? 0
  const effectiveSyncedIdx = Math.max(lastSyncedIdx, compactedIdx)
  const unsyncedTurns = turns.filter((t) => t.turnIndex > effectiveSyncedIdx && t.status !== 'running')

  // Nếu cùng provider và đã sync hết mọi turn, vẫn chèn active skills / pinned memory nếu là lượt đầu hoặc có thay đổi
  const hasMemoryContext =
    Boolean(memory.goal.trim()) ||
    Boolean(memory.summary.trim()) ||
    memory.decisions.length > 0 ||
    memory.pinnedNotes.length > 0

  const needsHandoff =
    unsyncedTurns.length > 0 ||
    (compactedIdx > 0 && hasMemoryContext) ||
    (!targetSyncState?.providerSessionId && (hasMemoryContext || activeSkills.length > 0))

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
      // Duyệt từ lượt mới nhất về cũ: lượt gần đây giữ chi tiết, lượt cũ khi hết ngân sách chỉ còn 1 dòng
      let budget = HANDOFF_HISTORY_CHAR_BUDGET
      const blocks: string[] = []
      for (let i = unsyncedTurns.length - 1; i >= 0; i--) {
        const t = unsyncedTurns[i]
        const { text, tools } = summarizeTurnOutput(t)
        const lines = [`#### Lượt #${t.turnIndex} (trên ${t.provider})`]
        const detailed = budget > 0
        if (detailed) {
          lines.push(`**Người dùng:**\n${clipMiddle(t.userPrompt, 3000)}`)
          if (tools.length > 0) lines.push(`**Thao tác đã chạy:** ${tools.slice(0, 12).join('; ')}`)
          if (text) lines.push(`**Trợ lý trả lời:**\n${clipMiddle(text, 2600)}`)
        } else {
          const head = (t.userPrompt.split(/\r?\n/)[0] || '').slice(0, 140)
          const reply = (text.split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 160)
          lines.push(`- ${head}${reply ? ` → ${reply}` : ''} (đã rút gọn)`)
        }
        const block = lines.join('\n\n')
        budget -= block.length
        blocks.unshift(block)
      }
      sections.push([...historyLines, ...blocks].join('\n\n'))
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
  const prevCompactedIdx = memory.compactedUpToTurnIndex ?? 0
  const completed = turns.filter((t) => t.status === 'completed')
  const newlyCompacted = completed.filter((t) => t.turnIndex > prevCompactedIdx)
  const keyFilesSet = new Set(memory.keyFiles)
  const existingBullets = memory.summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-8)
  const turnBullets: string[] = []

  const sourceTurns = newlyCompacted.length > 0 ? newlyCompacted.slice(-16) : completed.slice(-12)
  for (const t of sourceTurns) {
    for (const f of extractKeyFilesFromTurn(t)) keyFilesSet.add(f)
    const { text, tools } = summarizeTurnOutput(t)
    const firstLine = (t.userPrompt.split(/\r?\n/)[0] || '').slice(0, 90)
    const replyHead = (text.split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 110)
    const toolNote = tools.length > 0 ? ` [${tools.length} tools]` : ''
    turnBullets.push(`#${t.turnIndex} (${t.provider}): ${firstLine}${toolNote}${replyHead ? ` → ${replyHead}` : ''}`)
  }

  const mergedBullets = Array.from(new Set([...existingBullets, ...turnBullets])).slice(-24)
  const latestTurnIndex = completed.length > 0 ? completed[completed.length - 1].turnIndex : prevCompactedIdx
  const goal = memory.goal.trim() || (completed[0]?.userPrompt.split(/\r?\n/)[0] ?? '').slice(0, 140)
  const summary = mergedBullets.join('\n')

  return {
    goal,
    summary,
    decisions: memory.decisions,
    pinnedNotes: memory.pinnedNotes,
    keyFiles: Array.from(keyFilesSet).slice(0, 30),
    activeSkillIds: memory.activeSkillIds,
    compactedUpToTurnIndex: latestTurnIndex
  }
}
