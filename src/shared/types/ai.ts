export type ProviderId = 'claude' | 'codex' | 'agy' | 'gemini'

export type PermissionMode = 'plan' | 'edit' | 'full'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type ToolCategory = 'read' | 'edit' | 'bash' | 'search' | 'mcp' | 'agent' | 'other'

export interface AiAttachment {
  id: string
  type: 'file' | 'folder' | 'image' | 'diff' | 'terminal'
  label: string
  path?: string
  content?: string
}

export type NormalizedAgentEvent =
  | { type: 'session.init'; providerSessionId: string; model?: string; tools?: string[] }
  | { type: 'thinking.delta'; text: string }
  | { type: 'text.delta'; text: string }
  | {
      type: 'tool.start'
      callId: string
      name: string
      category: ToolCategory
      summary: string
      input: Record<string, unknown>
    }
  | {
      type: 'tool.result'
      callId: string
      ok: boolean
      output: string
    }
  | { type: 'plan.proposed'; title: string; markdown: string }
  | { type: 'handoff'; fromProvider: ProviderId; toProvider: ProviderId; syncedTurnsCount: number; summary: string }
  | {
      type: 'turn.complete'
      durationMs: number
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      costUsd?: number
      isError: boolean
      errorHint?: string
      permissionDenials?: number
    }
  | { type: 'error'; message: string; hint?: string }

export interface SessionMemory {
  sessionId: string
  goal: string
  summary: string
  decisions: string[]
  pinnedNotes: string[]
  keyFiles: string[]
  activeSkillIds: string[]
  updatedAt: string
}

export interface ProviderSyncState {
  sessionId: string
  provider: ProviderId
  providerSessionId: string | null
  lastSyncedTurnIndex: number
  updatedAt: string
}

export interface AiSession {
  id: string
  workspaceId: string
  workspacePath: string
  provider: ProviderId
  providerSessionId: string | null
  title: string
  model: string
  effort: EffortLevel
  permissionMode: PermissionMode
  worktreePath: string | null
  worktreeBranch: string | null
  worktreeBaseBranch: string | null
  pinned: boolean
  status: 'idle' | 'running' | 'error'
  createdAt: string
  updatedAt: string
}

export interface AiTurn {
  id: string
  sessionId: string
  turnIndex: number
  provider: ProviderId
  model: string
  userPrompt: string
  attachments: AiAttachment[]
  preTreeHash: string | null
  postTreeHash: string | null
  untrackedBackupId: string | null
  status: 'running' | 'completed' | 'stopped' | 'error'
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  events: StoredAgentEvent[]
  createdAt: string
}

export interface StoredAgentEvent {
  id: number
  turnId: string
  seq: number
  event: NormalizedAgentEvent
  createdAt: string
}

export interface CliStatus {
  provider: ProviderId
  name: string
  installed: boolean
  executablePath: string | null
  entryScriptPath?: string | null
  resolvedVia: 'fnm' | 'registry-path' | 'standard-dir' | 'override' | 'not-found'
  version: string | null
  defaultModel: string | null
  models: string[]
  installCommand: string
  notes?: string
}

export interface UsageDailyPoint {
  date: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
}

export interface UsageByProvider {
  provider: ProviderId
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
}

export interface UsageSummary {
  totalTurns: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalDurationMs: number
  byProvider: UsageByProvider[]
  daily: UsageDailyPoint[]
}
