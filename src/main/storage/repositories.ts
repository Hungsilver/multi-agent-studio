import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  AiAttachment,
  AiSession,
  AiTurn,
  EffortLevel,
  NormalizedAgentEvent,
  PermissionMode,
  ProviderId,
  ProviderSyncState,
  SessionMemory,
  StoredAgentEvent,
  UsageSummary
} from '@shared/types/ai'
import type { PromptTemplate } from '@shared/types/governance'
import type { AppSettings, WorkspaceRecord } from '@shared/types/workspace'
import type { WorkspaceDatabase } from './database'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: 'indigo',
  defaultProvider: 'claude',
  defaultMode: 'edit',
  claudeAuthMode: 'env',
  notifications: true,
  autoCompactEnabled: true,
  autoCompactThreshold: 80,
  cliOverrides: {}
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export class WorkspaceRepository {
  constructor(private readonly db: WorkspaceDatabase) {}

  // ---------- Settings ----------
  getSettings(): AppSettings {
    const row = this.db.queryOne<{ value_json: string }>('SELECT value_json FROM app_settings WHERE key = ?', ['settings'])
    if (!row) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...parseJson<Partial<AppSettings>>(row.value_json, {}) }
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.getSettings(),
      ...patch,
      cliOverrides: {
        ...this.getSettings().cliOverrides,
        ...(patch.cliOverrides ?? {})
      }
    }
    this.db.run(
      'INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)',
      ['settings', JSON.stringify(next)]
    )
    this.db.persist()
    return next
  }

  // ---------- Workspaces ----------
  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.db.queryAll<{ id: string; path: string; name: string; last_opened_at: string }>(
      'SELECT id, path, name, last_opened_at FROM workspaces ORDER BY last_opened_at DESC'
    )
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      name: r.name,
      lastOpenedAt: r.last_opened_at
    }))
  }

  upsertWorkspace(folderPath: string): WorkspaceRecord {
    const normalized = path.resolve(folderPath)
    const now = new Date().toISOString()
    const existing = this.db.queryOne<{ id: string; path: string; name: string }>(
      'SELECT id, path, name FROM workspaces WHERE lower(path) = lower(?)',
      [normalized]
    )
    if (existing) {
      this.db.run('UPDATE workspaces SET last_opened_at = ? WHERE id = ?', [now, existing.id])
      this.db.persist()
      return { id: existing.id, path: existing.path, name: existing.name, lastOpenedAt: now }
    }
    const rec: WorkspaceRecord = {
      id: randomUUID(),
      path: normalized,
      name: path.basename(normalized) || normalized,
      lastOpenedAt: now
    }
    this.db.run(
      'INSERT INTO workspaces (id, path, name, last_opened_at) VALUES (?, ?, ?, ?)',
      [rec.id, rec.path, rec.name, rec.lastOpenedAt]
    )
    this.db.persist()
    return rec
  }

  removeWorkspace(id: string): void {
    this.db.run('DELETE FROM workspaces WHERE id = ?', [id])
    this.db.persist()
  }

  // ---------- Sessions ----------
  listSessions(runningIds: Set<string> = new Set()): AiSession[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      'SELECT * FROM ai_sessions ORDER BY pinned DESC, updated_at DESC'
    )
    return rows.map((r) => this.mapSession(r, runningIds))
  }

  getSession(id: string, runningIds: Set<string> = new Set()): AiSession | null {
    const row = this.db.queryOne<Record<string, unknown>>('SELECT * FROM ai_sessions WHERE id = ?', [id])
    return row ? this.mapSession(row, runningIds) : null
  }

  createSession(input: {
    workspaceId: string
    workspacePath: string
    provider: ProviderId
    providerSessionId?: string | null
    title?: string
    model?: string
    effort?: EffortLevel
    permissionMode?: PermissionMode
    worktreePath?: string | null
    worktreeBranch?: string | null
    worktreeBaseBranch?: string | null
  }): AiSession {
    const now = new Date().toISOString()
    const id = randomUUID()
    const session: AiSession = {
      id,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      provider: input.provider,
      providerSessionId: input.providerSessionId ?? null,
      title: input.title?.trim() || 'Phiên làm việc mới',
      model: input.model ?? '',
      effort: input.effort ?? 'medium',
      permissionMode: input.permissionMode ?? 'edit',
      worktreePath: input.worktreePath ?? null,
      worktreeBranch: input.worktreeBranch ?? null,
      worktreeBaseBranch: input.worktreeBaseBranch ?? null,
      pinned: false,
      status: 'idle',
      createdAt: now,
      updatedAt: now
    }

    this.db.run(
      `INSERT INTO ai_sessions (
        id, workspace_id, workspace_path, provider, provider_session_id, title, model, effort, permission_mode,
        worktree_path, worktree_branch, worktree_base_branch, pinned, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        session.id,
        session.workspaceId,
        session.workspacePath,
        session.provider,
        session.providerSessionId,
        session.title,
        session.model,
        session.effort,
        session.permissionMode,
        session.worktreePath,
        session.worktreeBranch,
        session.worktreeBaseBranch,
        session.createdAt,
        session.updatedAt
      ]
    )

    // Khởi tạo bộ nhớ phiên & provider state
    this.db.run(
      `INSERT INTO session_memories (session_id, goal, summary, decisions_json, pinned_notes_json, key_files_json, active_skills_json, updated_at)
       VALUES (?, '', '', '[]', '[]', '[]', '[]', ?)`,
      [session.id, now]
    )

    if (session.providerSessionId) {
      this.upsertProviderState(session.id, session.provider, session.providerSessionId, 0)
    }

    this.db.persist()
    return session
  }

  updateSession(
    sessionId: string,
    patch: Partial<
      Pick<
        AiSession,
        'title' | 'provider' | 'providerSessionId' | 'model' | 'effort' | 'permissionMode' | 'pinned'
      >
    >
  ): AiSession | null {
    const current = this.getSession(sessionId)
    if (!current) return null
    const next: AiSession = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    this.db.run(
      `UPDATE ai_sessions
       SET title = ?, provider = ?, provider_session_id = ?, model = ?, effort = ?, permission_mode = ?, pinned = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.title,
        next.provider,
        next.providerSessionId,
        next.model,
        next.effort,
        next.permissionMode,
        next.pinned ? 1 : 0,
        next.updatedAt,
        sessionId
      ]
    )
    this.db.persist()
    return next
  }

  deleteSession(sessionId: string): void {
    const turns = this.db.queryAll<{ id: string }>('SELECT id FROM ai_turns WHERE session_id = ?', [sessionId])
    for (const t of turns) {
      this.db.run('DELETE FROM ai_events WHERE turn_id = ?', [t.id])
    }
    this.db.run('DELETE FROM ai_turns WHERE session_id = ?', [sessionId])
    this.db.run('DELETE FROM session_provider_states WHERE session_id = ?', [sessionId])
    this.db.run('DELETE FROM session_memories WHERE session_id = ?', [sessionId])
    this.db.run('DELETE FROM ai_sessions WHERE id = ?', [sessionId])
    this.db.persist()
  }

  private normalizeProvider(raw: unknown): ProviderId {
    const p = String(raw ?? '').toLowerCase()
    if (p === 'claude' || p === 'codex' || p === 'agy') return p
    return 'agy'
  }

  private mapSession(r: Record<string, unknown>, runningIds: Set<string>): AiSession {
    const id = String(r.id)
    let status: 'idle' | 'running' | 'error' = runningIds.has(id) ? 'running' : 'idle'
    if (status === 'idle') {
      const lastTurn = this.db.queryOne<{ status: string }>(
        'SELECT status FROM ai_turns WHERE session_id = ? ORDER BY turn_index DESC LIMIT 1',
        [id]
      )
      if (lastTurn?.status === 'error') status = 'error'
    }
    return {
      id,
      workspaceId: String(r.workspace_id),
      workspacePath: String(r.workspace_path),
      provider: this.normalizeProvider(r.provider),
      providerSessionId: r.provider_session_id ? String(r.provider_session_id) : null,
      title: String(r.title),
      model: String(r.model ?? ''),
      effort: (String(r.effort ?? 'medium') as EffortLevel) || 'medium',
      permissionMode: (String(r.permission_mode ?? 'edit') as PermissionMode) || 'edit',
      worktreePath: r.worktree_path ? String(r.worktree_path) : null,
      worktreeBranch: r.worktree_branch ? String(r.worktree_branch) : null,
      worktreeBaseBranch: r.worktree_base_branch ? String(r.worktree_base_branch) : null,
      pinned: Number(r.pinned) === 1,
      status,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    }
  }

  // ---------- Provider States (per session, per provider) ----------
  listProviderStates(sessionId: string): ProviderSyncState[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      'SELECT * FROM session_provider_states WHERE session_id = ?',
      [sessionId]
    )
    return rows.map((r) => ({
      sessionId: String(r.session_id),
      provider: this.normalizeProvider(r.provider),
      providerSessionId: r.provider_session_id ? String(r.provider_session_id) : null,
      lastSyncedTurnIndex: Number(r.last_synced_turn_index ?? 0),
      updatedAt: String(r.updated_at)
    }))
  }

  getProviderState(sessionId: string, provider: ProviderId): ProviderSyncState | null {
    const row = this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM session_provider_states WHERE session_id = ? AND provider = ?',
      [sessionId, provider]
    )
    if (!row) return null
    return {
      sessionId: String(row.session_id),
      provider: this.normalizeProvider(row.provider),
      providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
      lastSyncedTurnIndex: Number(row.last_synced_turn_index ?? 0),
      updatedAt: String(row.updated_at)
    }
  }

  upsertProviderState(
    sessionId: string,
    provider: ProviderId,
    providerSessionId: string | null,
    lastSyncedTurnIndex: number
  ): ProviderSyncState {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT OR REPLACE INTO session_provider_states (session_id, provider, provider_session_id, last_synced_turn_index, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, provider, providerSessionId, lastSyncedTurnIndex, now]
    )
    this.db.persist()
    return { sessionId, provider, providerSessionId, lastSyncedTurnIndex, updatedAt: now }
  }

  // ---------- Session Memory ----------
  getMemory(sessionId: string): SessionMemory {
    const row = this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM session_memories WHERE session_id = ?',
      [sessionId]
    )
    if (!row) {
      const now = new Date().toISOString()
      return {
        sessionId,
        goal: '',
        summary: '',
        decisions: [],
        pinnedNotes: [],
        keyFiles: [],
        activeSkillIds: [],
        compactedUpToTurnIndex: 0,
        updatedAt: now
      }
    }
    return {
      sessionId: String(row.session_id),
      goal: String(row.goal ?? ''),
      summary: String(row.summary ?? ''),
      decisions: parseJson<string[]>(row.decisions_json as string, []),
      pinnedNotes: parseJson<string[]>(row.pinned_notes_json as string, []),
      keyFiles: parseJson<string[]>(row.key_files_json as string, []),
      activeSkillIds: parseJson<string[]>(row.active_skills_json as string, []),
      compactedUpToTurnIndex: Number(row.compacted_up_to_turn_index ?? 0),
      updatedAt: String(row.updated_at)
    }
  }

  updateMemory(
    sessionId: string,
    patch: Partial<Omit<SessionMemory, 'sessionId' | 'updatedAt'>>
  ): SessionMemory {
    const cur = this.getMemory(sessionId)
    const next: SessionMemory = {
      ...cur,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    this.db.run(
      `INSERT OR REPLACE INTO session_memories (
        session_id, goal, summary, decisions_json, pinned_notes_json, key_files_json, active_skills_json, compacted_up_to_turn_index, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        next.goal,
        next.summary,
        JSON.stringify(next.decisions),
        JSON.stringify(next.pinnedNotes),
        JSON.stringify(next.keyFiles),
        JSON.stringify(next.activeSkillIds),
        next.compactedUpToTurnIndex ?? 0,
        next.updatedAt
      ]
    )
    this.db.persist()
    return next
  }

  resetProviderStatesForCompact(sessionId: string, compactedUpToTurnIndex: number): ProviderSyncState[] {
    const now = new Date().toISOString()
    this.db.run(
      'UPDATE ai_sessions SET provider_session_id = NULL, updated_at = ? WHERE id = ?',
      [now, sessionId]
    )
    const providers: ProviderId[] = ['claude', 'codex', 'agy']
    for (const p of providers) {
      this.db.run(
        `INSERT OR REPLACE INTO session_provider_states (session_id, provider, provider_session_id, last_synced_turn_index, updated_at)
         VALUES (?, ?, NULL, ?, ?)`,
        [sessionId, p, compactedUpToTurnIndex, now]
      )
    }
    this.db.persist()
    return this.listProviderStates(sessionId)
  }

  // ---------- Turns & Events ----------
  listTurns(sessionId: string): AiTurn[] {
    const turnRows = this.db.queryAll<Record<string, unknown>>(
      'SELECT * FROM ai_turns WHERE session_id = ? ORDER BY turn_index ASC',
      [sessionId]
    )
    if (turnRows.length === 0) return []
    // Một truy vấn cho toàn bộ sự kiện của phiên (thay vì 1 truy vấn / lượt), nhóm theo turn_id giữ nguyên thứ tự
    const eventRows = this.db.queryAll<Record<string, unknown>>(
      `SELECT e.* FROM ai_events e
       JOIN ai_turns t ON t.id = e.turn_id
       WHERE t.session_id = ?
       ORDER BY e.seq ASC, e.id ASC`,
      [sessionId]
    )
    const byTurn = new Map<string, StoredAgentEvent[]>()
    for (const r of eventRows) {
      const ev = this.mapEventRow(r)
      const list = byTurn.get(ev.turnId)
      if (list) list.push(ev)
      else byTurn.set(ev.turnId, [ev])
    }
    return turnRows.map((r) => this.mapTurn(r, byTurn.get(String(r.id)) ?? []))
  }

  getTurn(turnId: string): AiTurn | null {
    const row = this.db.queryOne<Record<string, unknown>>('SELECT * FROM ai_turns WHERE id = ?', [turnId])
    if (!row) return null
    return this.mapTurn(row, this.listTurnEvents(turnId))
  }

  getNextTurnIndex(sessionId: string): number {
    const row = this.db.queryOne<{ maxIdx: number | null }>(
      'SELECT MAX(turn_index) as maxIdx FROM ai_turns WHERE session_id = ?',
      [sessionId]
    )
    return (row?.maxIdx ?? 0) + 1
  }

  createTurn(input: {
    sessionId: string
    provider: ProviderId
    model: string
    userPrompt: string
    attachments: AiAttachment[]
    preTreeHash: string | null
    untrackedBackupId: string | null
    status?: AiTurn['status']
  }): AiTurn {
    const turnIndex = this.getNextTurnIndex(input.sessionId)
    const now = new Date().toISOString()
    const id = randomUUID()
    this.db.run(
      `INSERT INTO ai_turns (
        id, session_id, turn_index, provider, model, user_prompt, attachments_json,
        pre_tree_hash, post_tree_hash, untracked_backup_id, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        id,
        input.sessionId,
        turnIndex,
        input.provider,
        input.model,
        input.userPrompt,
        JSON.stringify(input.attachments),
        input.preTreeHash,
        input.untrackedBackupId,
        input.status ?? 'running',
        now
      ]
    )
    this.db.persist()
    return {
      id,
      sessionId: input.sessionId,
      turnIndex,
      provider: input.provider,
      model: input.model,
      userPrompt: input.userPrompt,
      attachments: input.attachments,
      preTreeHash: input.preTreeHash,
      postTreeHash: null,
      untrackedBackupId: input.untrackedBackupId,
      status: input.status ?? 'running',
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      events: [],
      createdAt: now
    }
  }

  completeTurn(
    turnId: string,
    patch: {
      status: AiTurn['status']
      postTreeHash?: string | null
      durationMs?: number | null
      inputTokens?: number | null
      outputTokens?: number | null
      costUsd?: number | null
    }
  ): void {
    this.db.run(
      `UPDATE ai_turns
       SET status = ?, post_tree_hash = COALESCE(?, post_tree_hash),
           duration_ms = COALESCE(?, duration_ms),
           input_tokens = COALESCE(?, input_tokens),
           output_tokens = COALESCE(?, output_tokens),
           cost_usd = COALESCE(?, cost_usd)
       WHERE id = ?`,
      [
        patch.status,
        patch.postTreeHash ?? null,
        patch.durationMs ?? null,
        patch.inputTokens ?? null,
        patch.outputTokens ?? null,
        patch.costUsd ?? null,
        turnId
      ]
    )
    this.db.persist()
  }

  appendEvent(turnId: string, seq: number, event: NormalizedAgentEvent, persistNow = false): StoredAgentEvent {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO ai_events (turn_id, seq, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      [turnId, seq, event.type, JSON.stringify(event), now]
    )
    const id = this.db.lastInsertRowId()
    if (persistNow) this.db.persist()
    return { id, turnId, seq, event, createdAt: now }
  }

  /** Lượt còn 'running' từ lần chạy trước (app tắt giữa chừng) sẽ không bao giờ kết thúc — đánh dấu 'stopped'. */
  recoverInterruptedTurns(): number {
    const row = this.db.queryOne<{ n: number }>("SELECT COUNT(*) as n FROM ai_turns WHERE status = 'running'")
    const n = Number(row?.n ?? 0)
    if (n > 0) {
      this.db.run("UPDATE ai_turns SET status = 'stopped' WHERE status = 'running'")
      this.db.persist()
    }
    return n
  }

  clearTurnEvents(sessionId: string): void {
    const turns = this.db.queryAll<{ id: string }>('SELECT id FROM ai_turns WHERE session_id = ?', [sessionId])
    for (const t of turns) {
      this.db.run('DELETE FROM ai_events WHERE turn_id = ?', [t.id])
    }
    this.db.run('DELETE FROM ai_turns WHERE session_id = ?', [sessionId])
    this.db.persist()
  }

  private listTurnEvents(turnId: string): StoredAgentEvent[] {
    const rows = this.db.queryAll<Record<string, unknown>>(
      'SELECT * FROM ai_events WHERE turn_id = ? ORDER BY seq ASC, id ASC',
      [turnId]
    )
    return rows.map((r) => this.mapEventRow(r))
  }

  private mapEventRow(r: Record<string, unknown>): StoredAgentEvent {
    return {
      id: Number(r.id),
      turnId: String(r.turn_id),
      seq: Number(r.seq),
      event: parseJson<NormalizedAgentEvent>(String(r.payload_json), { type: 'text.delta', text: '' }),
      createdAt: String(r.created_at)
    }
  }

  private mapTurn(r: Record<string, unknown>, events: StoredAgentEvent[]): AiTurn {
    return {
      id: String(r.id),
      sessionId: String(r.session_id),
      turnIndex: Number(r.turn_index),
      provider: this.normalizeProvider(r.provider),
      model: String(r.model ?? ''),
      userPrompt: String(r.user_prompt),
      attachments: parseJson<AiAttachment[]>(String(r.attachments_json), []),
      preTreeHash: r.pre_tree_hash ? String(r.pre_tree_hash) : null,
      postTreeHash: r.post_tree_hash ? String(r.post_tree_hash) : null,
      untrackedBackupId: r.untracked_backup_id ? String(r.untracked_backup_id) : null,
      status: String(r.status) as AiTurn['status'],
      durationMs: r.duration_ms !== null && r.duration_ms !== undefined ? Number(r.duration_ms) : null,
      inputTokens: r.input_tokens !== null && r.input_tokens !== undefined ? Number(r.input_tokens) : null,
      outputTokens: r.output_tokens !== null && r.output_tokens !== undefined ? Number(r.output_tokens) : null,
      costUsd: r.cost_usd !== null && r.cost_usd !== undefined ? Number(r.cost_usd) : null,
      events,
      createdAt: String(r.created_at)
    }
  }

  // ---------- Prompt Templates ----------
  listPromptTemplates(): PromptTemplate[] {
    const rows = this.db.queryAll<Record<string, unknown>>('SELECT * FROM prompt_templates ORDER BY slash_cmd ASC')
    return rows.map((r) => ({
      id: String(r.id),
      slashCmd: String(r.slash_cmd),
      title: String(r.title),
      description: String(r.description ?? ''),
      body: String(r.body),
      scope: (String(r.scope ?? 'global') as 'global' | 'workspace')
    }))
  }

  savePromptTemplate(tpl: PromptTemplate): PromptTemplate {
    const id = tpl.id || randomUUID()
    const slashCmd = tpl.slashCmd.startsWith('/') ? tpl.slashCmd.trim() : `/${tpl.slashCmd.trim()}`
    this.db.run(
      `INSERT OR REPLACE INTO prompt_templates (id, slash_cmd, title, description, body, scope) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, slashCmd, tpl.title, tpl.description, tpl.body, tpl.scope]
    )
    this.db.persist()
    return { ...tpl, id, slashCmd }
  }

  deletePromptTemplate(id: string): void {
    this.db.run('DELETE FROM prompt_templates WHERE id = ?', [id])
    this.db.persist()
  }

  // ---------- Usage Analytics ----------
  getUsageSummary(): UsageSummary {
    const totals = this.db.queryOne<{
      turns: number
      inp: number
      outp: number
      cost: number
      dur: number
    }>(
      `SELECT COUNT(*) as turns,
              COALESCE(SUM(input_tokens), 0) as inp,
              COALESCE(SUM(output_tokens), 0) as outp,
              COALESCE(SUM(cost_usd), 0) as cost,
              COALESCE(SUM(duration_ms), 0) as dur
       FROM ai_turns WHERE status != 'running'`
    )

    const byProviderRows = this.db.queryAll<{
      provider: string
      turns: number
      inp: number
      outp: number
      cost: number
      dur: number
    }>(
      `SELECT provider, COUNT(*) as turns,
              COALESCE(SUM(input_tokens), 0) as inp,
              COALESCE(SUM(output_tokens), 0) as outp,
              COALESCE(SUM(cost_usd), 0) as cost,
              COALESCE(SUM(duration_ms), 0) as dur
       FROM ai_turns WHERE status != 'running'
       GROUP BY provider`
    )

    const dailyRows = this.db.queryAll<{
      day: string
      turns: number
      inp: number
      outp: number
      cost: number
    }>(
      `SELECT substr(created_at, 1, 10) as day,
              COUNT(*) as turns,
              COALESCE(SUM(input_tokens), 0) as inp,
              COALESCE(SUM(output_tokens), 0) as outp,
              COALESCE(SUM(cost_usd), 0) as cost
       FROM ai_turns WHERE status != 'running'
       GROUP BY substr(created_at, 1, 10)
       ORDER BY day DESC LIMIT 14`
    )

    return {
      totalTurns: Number(totals?.turns ?? 0),
      totalInputTokens: Number(totals?.inp ?? 0),
      totalOutputTokens: Number(totals?.outp ?? 0),
      totalCostUsd: Number(totals?.cost ?? 0),
      totalDurationMs: Number(totals?.dur ?? 0),
      byProvider: byProviderRows.map((r) => ({
        provider: r.provider as ProviderId,
        turns: Number(r.turns),
        inputTokens: Number(r.inp),
        outputTokens: Number(r.outp),
        costUsd: Number(r.cost),
        durationMs: Number(r.dur)
      })),
      daily: dailyRows
        .map((d) => ({
          date: d.day,
          turns: Number(d.turns),
          inputTokens: Number(d.inp),
          outputTokens: Number(d.outp),
          costUsd: Number(d.cost)
        }))
        .reverse()
    }
  }

  getProviderWindowStats(): Record<
    ProviderId,
    {
      todayTurns: number
      todayTokens: number
      weekTurns: number
      weekTokens: number
      weekCostUsd: number
      fiveHourTurns: number
      fiveHourTokens: number
      fiveHourResetsAt: string | null
    }
  > {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()

    const empty = (): {
      todayTurns: number
      todayTokens: number
      weekTurns: number
      weekTokens: number
      weekCostUsd: number
      fiveHourTurns: number
      fiveHourTokens: number
      fiveHourResetsAt: string | null
    } => ({
      todayTurns: 0,
      todayTokens: 0,
      weekTurns: 0,
      weekTokens: 0,
      weekCostUsd: 0,
      fiveHourTurns: 0,
      fiveHourTokens: 0,
      fiveHourResetsAt: null
    })

    const result: Record<ProviderId, ReturnType<typeof empty>> = {
      claude: empty(),
      codex: empty(),
      agy: empty()
    }

    const weekRows = this.db.queryAll<{
      provider: string
      turns: number
      inp: number
      outp: number
      cost: number
    }>(
      `SELECT provider, COUNT(*) as turns,
              COALESCE(SUM(input_tokens), 0) as inp,
              COALESCE(SUM(output_tokens), 0) as outp,
              COALESCE(SUM(cost_usd), 0) as cost
       FROM ai_turns WHERE status != 'running' AND created_at >= ?
       GROUP BY provider`,
      [sevenDaysAgo]
    )
    for (const r of weekRows) {
      const p = this.normalizeProvider(r.provider)
      result[p].weekTurns += Number(r.turns ?? 0)
      result[p].weekTokens += Number(r.inp ?? 0) + Number(r.outp ?? 0)
      result[p].weekCostUsd += Number(r.cost ?? 0)
    }

    const todayRows = this.db.queryAll<{
      provider: string
      turns: number
      inp: number
      outp: number
    }>(
      `SELECT provider, COUNT(*) as turns,
              COALESCE(SUM(input_tokens), 0) as inp,
              COALESCE(SUM(output_tokens), 0) as outp
       FROM ai_turns WHERE status != 'running' AND created_at >= ?
       GROUP BY provider`,
      [startOfToday]
    )
    for (const r of todayRows) {
      const p = this.normalizeProvider(r.provider)
      result[p].todayTurns += Number(r.turns ?? 0)
      result[p].todayTokens += Number(r.inp ?? 0) + Number(r.outp ?? 0)
    }

    const fiveHourRows = this.db.queryAll<{
      provider: string
      turns: number
      inp: number
      outp: number
      oldest_at: string | null
    }>(
      `SELECT provider, COUNT(*) as turns,
              COALESCE(SUM(input_tokens), 0) as inp,
              COALESCE(SUM(output_tokens), 0) as outp,
              MIN(created_at) as oldest_at
       FROM ai_turns WHERE status != 'running' AND created_at >= ?
       GROUP BY provider`,
      [fiveHoursAgo]
    )
    for (const r of fiveHourRows) {
      const p = this.normalizeProvider(r.provider)
      result[p].fiveHourTurns += Number(r.turns ?? 0)
      result[p].fiveHourTokens += Number(r.inp ?? 0) + Number(r.outp ?? 0)
      if (r.oldest_at) {
        const candidateResetMs = new Date(String(r.oldest_at)).getTime() + 5 * 60 * 60 * 1000
        if (Number.isFinite(candidateResetMs)) {
          const prevMs = result[p].fiveHourResetsAt ? new Date(result[p].fiveHourResetsAt).getTime() : Infinity
          if (candidateResetMs < prevMs) {
            result[p].fiveHourResetsAt = new Date(candidateResetMs).toISOString()
          }
        }
      }
    }

    return result
  }
}
