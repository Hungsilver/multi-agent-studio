import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import readline from 'node:readline'
import type { AiAttachment, AiSession, EffortLevel, NormalizedAgentEvent, PermissionMode, ProviderId } from '@shared/types/ai'
import { captureCheckpoint } from '../git/checkpoint-service'
import { getRepoSummary } from '../git/diff-service'
import { getRepoRoot, runGit } from '../git/git-runner'
import type { WorkspaceRepository } from '../storage/repositories'
import { getEnrichedEnv } from '../system/env-resolver'
import { createAdapterStreamState } from './adapters/base'
import { getProviderAdapter } from './adapters/registry'
import { resolveCliCommand, resolveEffectiveCodexModel } from './cli-locator'
import { buildHandoffPrompt, extractKeyFilesFromTurn } from './context-memory'
import { listAllSkills } from './governance-service'

interface RunningJob {
  sessionId: string
  turnId: string
  provider: ProviderId
  child: ChildProcess
  stopped: boolean
  startedAt: number
}

export class AgentOrchestrator extends EventEmitter {
  private readonly running = new Map<string, RunningJob>()

  constructor(private readonly repo: WorkspaceRepository) {
    super()
  }

  getRunningSessionIds(): Set<string> {
    return new Set(this.running.keys())
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  async sendPrompt(params: {
    sessionId: string
    prompt: string
    provider?: ProviderId
    model?: string
    effort?: EffortLevel
    permissionMode?: PermissionMode
    attachments?: AiAttachment[]
  }): Promise<{ turnId: string }> {
    const session = this.repo.getSession(params.sessionId, this.getRunningSessionIds())
    if (!session) throw new Error('Không tìm thấy phiên làm việc')
    if (this.running.has(session.id)) throw new Error('Phiên này đang xử lý, hãy chờ xong hoặc bấm Dừng.')

    const targetProvider = params.provider ?? session.provider
    let model = params.model !== undefined ? params.model : session.model
    const effort = params.effort ?? session.effort
    const mode = params.permissionMode ?? session.permissionMode
    const attachments = params.attachments ?? []

    let codexFallbackNotice: string | undefined
    if (targetProvider === 'codex') {
      const resolvedCodex = resolveEffectiveCodexModel(model)
      if (resolvedCodex.fallbackReason) {
        model = resolvedCodex.model
        codexFallbackNotice = resolvedCodex.fallbackReason
      }
    }

    // Cập nhật thông số phiên nếu người dùng đổi ngay trên Composer
    const previousProvider = session.provider
    const providerChanged = previousProvider !== targetProvider

    const settings = this.repo.getSettings()
    const resolvedCli = resolveCliCommand(targetProvider, settings.cliOverrides[targetProvider])
    if (!resolvedCli) {
      throw new Error(`Chưa tìm thấy CLI cho ${targetProvider}. Kiểm tra lại trong Cài đặt → Chẩn đoán CLI.`)
    }

    const workDir = session.worktreePath && fs.existsSync(session.worktreePath) ? session.worktreePath : session.workspacePath
    if (!fs.existsSync(workDir)) {
      throw new Error(`Thư mục làm việc không tồn tại: ${workDir}`)
    }

    // Chụp Checkpoint working tree trước khi AI chạy
    const preSnap = await captureCheckpoint(workDir)
    const repoSummary = await getRepoSummary(workDir)

    // Lấy trạng thái sync của provider đích & xây dựng ngữ cảnh handoff 100%
    const memory = this.repo.getMemory(session.id)
    const turns = this.repo.listTurns(session.id)
    const targetSyncState = this.repo.getProviderState(session.id, targetProvider)
    const allSkills = listAllSkills(workDir)
    const activeSkills = allSkills.filter((s) => memory.activeSkillIds.includes(s.id) || memory.activeSkillIds.includes(s.name))

    // Mở rộng nội dung đính kèm (file, diff, terminal)
    const attachmentTexts: string[] = []
    const imagePaths: string[] = []
    for (const att of attachments) {
      if (att.type === 'image' && att.path) {
        imagePaths.push(att.path)
        attachmentTexts.push(`[Ảnh đính kèm: ${att.path}]`)
      } else if (att.type === 'file' && att.path) {
        attachmentTexts.push(`[File workspace: ${att.path}]`)
      } else if (att.type === 'folder' && att.path) {
        attachmentTexts.push(`[Thư mục workspace: ${att.path}]`)
      } else if (att.type === 'diff') {
        const root = await getRepoRoot(workDir)
        if (root) {
          const d = await runGit(root, ['diff', 'HEAD'])
          const diffSnippet = d.stdout.slice(0, 12_000)
          attachmentTexts.push(`<git_diff>\n${diffSnippet}\n</git_diff>`)
        }
      } else if (att.type === 'terminal' && att.content) {
        attachmentTexts.push(`<terminal_output>\n${att.content.slice(-8000)}\n</terminal_output>`)
      }
    }

    const promptWithAttachments =
      attachmentTexts.length > 0 ? `${params.prompt.trim()}\n\n${attachmentTexts.join('\n')}` : params.prompt.trim()

    const { compiledPrompt, unsyncedTurnsCount, isHandoff } = buildHandoffPrompt({
      targetProvider,
      memory,
      turns,
      targetSyncState,
      activeSkills,
      repoSummary,
      userPrompt: promptWithAttachments
    })

    // Tạo tiêu đề tự động nếu là lượt đầu
    let nextTitle = session.title
    if (turns.length === 0 && (session.title === 'Phiên làm việc mới' || !session.title.trim())) {
      const firstLine = params.prompt.trim().split(/\r?\n/)[0] || 'Phiên mới'
      nextTitle = firstLine.length > 64 ? `${firstLine.slice(0, 64)}…` : firstLine
    }

    const targetProviderSessionId = targetSyncState?.providerSessionId ?? (providerChanged ? null : session.providerSessionId)

    this.repo.updateSession(session.id, {
      title: nextTitle,
      provider: targetProvider,
      providerSessionId: targetProviderSessionId,
      model,
      effort,
      permissionMode: mode
    })

    // Cập nhật goal nếu chưa có
    if (!memory.goal.trim()) {
      this.repo.updateMemory(session.id, { goal: nextTitle })
    }

    const turn = this.repo.createTurn({
      sessionId: session.id,
      provider: targetProvider,
      model,
      userPrompt: params.prompt.trim(),
      attachments,
      preTreeHash: preSnap.treeHash,
      untrackedBackupId: preSnap.backupId,
      status: 'running'
    })

    let seq = 0
    const emitAndStore = (ev: NormalizedAgentEvent, persistNow = false): void => {
      seq++
      this.repo.appendEvent(turn.id, seq, ev, persistNow)
      this.emit('ai:event', { sessionId: session.id, turnId: turn.id, event: ev })
    }

    // Chỉ coi là handoff giữa các tool khi lượt hợp lệ gần nhất chạy trên provider khác provider đích
    const completedTurns = turns.filter((t) => t.status === 'completed')
    const lastCompletedTurn = completedTurns[completedTurns.length - 1]
    const switchedFromOtherProvider = Boolean(
      lastCompletedTurn && lastCompletedTurn.provider !== targetProvider
    )

    if (isHandoff && switchedFromOtherProvider && lastCompletedTurn) {
      emitAndStore({
        type: 'handoff',
        fromProvider: lastCompletedTurn.provider,
        toProvider: targetProvider,
        syncedTurnsCount: unsyncedTurnsCount,
        summary: `Đã đồng bộ ${unsyncedTurnsCount} lượt ngữ cảnh + Session Memory sang ${targetProvider.toUpperCase()}.`
      })
    }
    if (codexFallbackNotice) {
      emitAndStore({ type: 'thinking.delta', text: `[Codex model auto-select] ${codexFallbackNotice}\n` })
    }

    const adapter = getProviderAdapter(targetProvider)
    const cmdSpec = adapter.buildHeadlessCommand({
      mode,
      model,
      effort,
      providerSessionId: targetProviderSessionId,
      prompt: compiledPrompt,
      imagePaths,
      extraDirs: [],
      claudeAuthMode: settings.claudeAuthMode
    })

    const env = getEnrichedEnv(cmdSpec.unsetEnv)
    const finalArgs = [...resolvedCli.argsPrefix, ...cmdSpec.args]
    const child = spawn(resolvedCli.file, finalArgs, {
      cwd: workDir,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const job: RunningJob = {
      sessionId: session.id,
      turnId: turn.id,
      provider: targetProvider,
      child,
      stopped: false,
      startedAt: Date.now()
    }
    this.running.set(session.id, job)
    this.emit('ai:status', { sessionId: session.id, status: 'running' })

    const streamState = createAdapterStreamState()
    let stderrBuf = ''
    let fullAssistantText = ''
    let activeProviderSessionId = targetProviderSessionId
    let turnResultMeta: {
      durationMs?: number
      inputTokens?: number
      outputTokens?: number
      costUsd?: number
      isError?: boolean
    } = {}

    const handleEvent = (ev: NormalizedAgentEvent): void => {
      if (ev.type === 'session.init') {
        activeProviderSessionId = ev.providerSessionId
        this.repo.updateSession(session.id, { providerSessionId: ev.providerSessionId })
        this.repo.upsertProviderState(session.id, targetProvider, ev.providerSessionId, turn.turnIndex)
      } else if (ev.type === 'text.delta') {
        fullAssistantText += ev.text
      } else if (ev.type === 'turn.complete') {
        turnResultMeta = {
          durationMs: ev.durationMs,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          costUsd: ev.costUsd,
          isError: ev.isError
        }
      }
      emitAndStore(ev)
    }

    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
      rl.on('line', (line) => {
        for (const ev of adapter.parseLine(line, streamState)) {
          handleEvent(ev)
        }
      })
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      emitAndStore({ type: 'error', message: `Không khởi chạy được CLI: ${err.message}` }, true)
    })

    // Ghi prompt vào stdin rồi đóng stdin
    try {
      child.stdin?.write(cmdSpec.stdinData, 'utf8')
      child.stdin?.end()
    } catch {
      // ignore if process exited early
    }

    child.on('close', async (exitCode) => {
      this.running.delete(session.id)

      for (const ev of adapter.flush(streamState)) {
        handleEvent(ev)
      }

      // Nếu chế độ Plan và câu trả lời có cấu trúc rõ, phát thêm PlanReviewCard event
      if (mode === 'plan' && !job.stopped && fullAssistantText.trim().length > 80) {
        emitAndStore({
          type: 'plan.proposed',
          title: 'Kế hoạch đề xuất',
          markdown: fullAssistantText.trim()
        })
      }

      const elapsed = Date.now() - job.startedAt
      let finalStatus: 'completed' | 'stopped' | 'error' = 'completed'

      if (job.stopped) {
        finalStatus = 'stopped'
      } else if ((exitCode ?? 0) !== 0 || turnResultMeta.isError) {
        finalStatus = 'error'
        if ((exitCode ?? 0) !== 0) {
          const formatted = adapter.formatProcessError(exitCode ?? -1, stderrBuf)
          emitAndStore({ type: 'error', message: formatted.message, hint: formatted.hint })
        }
      }

      const postSnap = await captureCheckpoint(workDir)
      this.repo.completeTurn(turn.id, {
        status: finalStatus,
        postTreeHash: postSnap.treeHash,
        durationMs: turnResultMeta.durationMs || elapsed,
        inputTokens: turnResultMeta.inputTokens ?? null,
        outputTokens: turnResultMeta.outputTokens ?? null,
        costUsd: turnResultMeta.costUsd ?? null
      })

      if (finalStatus !== 'error') {
        this.repo.upsertProviderState(session.id, targetProvider, activeProviderSessionId, turn.turnIndex)
      }

      // Cập nhật keyFiles vào SessionMemory
      const updatedTurn = this.repo.getTurn(turn.id)
      if (updatedTurn) {
        const curMem = this.repo.getMemory(session.id)
        const extracted = extractKeyFilesFromTurn(updatedTurn)
        if (extracted.length > 0) {
          const merged = Array.from(new Set([...curMem.keyFiles, ...extracted])).slice(0, 30)
          this.repo.updateMemory(session.id, { keyFiles: merged })
        }
      }

      this.emit('ai:status', {
        sessionId: session.id,
        status: finalStatus === 'error' ? 'error' : 'idle'
      })
      this.emit('ai:turn-finished', {
        sessionId: session.id,
        sessionTitle: nextTitle,
        provider: targetProvider,
        status: finalStatus
      })
    })

    return { turnId: turn.id }
  }

  async stopRun(sessionId: string): Promise<void> {
    const job = this.running.get(sessionId)
    if (!job) return
    job.stopped = true
    const pid = job.child.pid
    if (pid) {
      if (process.platform === 'win32') {
        spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      } else {
        job.child.kill('SIGTERM')
      }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.running.keys()).map((id) => this.stopRun(id)))
  }
}
