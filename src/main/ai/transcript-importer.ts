import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AiTurn, NormalizedAgentEvent } from '@shared/types/ai'
import { ClaudeCodeAdapter } from './adapters/claude-adapter'
import { createAdapterStreamState } from './adapters/base'

export function findClaudeTranscriptPath(dir: string, providerSessionId: string): string | null {
  const root = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(root)) return null

  const slug = dir.replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9]/g, '-')
  const direct = path.join(root, slug, `${providerSessionId}.jsonl`)
  if (fs.existsSync(direct)) return direct

  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const candidate = path.join(root, ent.name, `${providerSessionId}.jsonl`)
      if (fs.existsSync(candidate)) return candidate
    }
  } catch {
    // ignore
  }
  return null
}

export function parseClaudeTranscriptFile(filePath: string, maxLines = 120): Array<{
  userPrompt: string
  events: NormalizedAgentEvent[]
}> {
  if (!fs.existsSync(filePath)) return []
  const rawLines = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('{"') && (l.includes('"type":"user"') || l.includes('"type":"assistant"')))

  const slice = rawLines.slice(Math.max(0, rawLines.length - maxLines))
  const adapter = new ClaudeCodeAdapter()
  const state = createAdapterStreamState()
  const turns: Array<{ userPrompt: string; events: NormalizedAgentEvent[] }> = []
  let current: { userPrompt: string; events: NormalizedAgentEvent[] } | null = null

  for (const line of slice) {
    let j: Record<string, unknown>
    try {
      j = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (j.isSidechain || j.isMeta) continue
    const msg = j.message as { model?: string; content?: unknown } | undefined
    if (msg?.model === '<synthetic>') continue

    if (j.type === 'user' && typeof msg?.content === 'string') {
      const prompt = msg.content.trim()
      if (!prompt || prompt.startsWith('<')) continue
      current = { userPrompt: prompt, events: [] }
      turns.push(current)
      continue
    }

    const parsed = adapter.parseLine(line, state)
    if (parsed.length > 0) {
      if (!current) {
        current = { userPrompt: '(Lịch sử trước đó)', events: [] }
        turns.push(current)
      }
      current.events.push(...parsed)
    }
  }

  return turns
}

export function importClaudeHistoryIntoTurns(
  dir: string,
  providerSessionId: string
): Array<Pick<AiTurn, 'userPrompt'> & { events: NormalizedAgentEvent[] }> {
  const file = findClaudeTranscriptPath(dir, providerSessionId)
  if (!file) return []
  return parseClaudeTranscriptFile(file)
}
