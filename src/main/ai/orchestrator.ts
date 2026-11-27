import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import readline from 'node:readline'
import type {
  AiAttachment,
  CompactContextResult,
  EffortLevel,
  NormalizedAgentEvent,
  OrchestratorConfig,
  PermissionMode,
  ProviderId
} from '@shared/types/ai'
import { estimateSessionContextUsage } from '@shared/utils/context-window'
import { captureCheckpoint } from '../git/checkpoint-service'
import { getRepoSummary } from '../git/diff-service'
import { getRepoRoot, runGit } from '../git/git-runner'
import type { WorkspaceRepository } from '../storage/repositories'
import { getEnrichedEnv } from '../system/env-resolver'
import { createAdapterStreamState } from './adapters/base'
import { getProviderAdapter } from './adapters/registry'
import { resolveCliCommand, resolveEffectiveCodexModel } from './cli-locator'
import { buildHandoffPrompt, compactSessionMemoryFromTurns, extractKeyFilesFromTurn } from './context-memory'
import { listAllSkills } from './governance-service'
import { resolveSessionWorkDir } from './session-workdir'

interface RunningJob {
  sessionId: string
  turnId: string
  provider: ProviderId
  child: ChildProcess
  stopped: boolean
  startedAt: number
}

interface SingleTurnParams {
  sessionId: string
  prompt: string
  provider?: ProviderId
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  attachments?: AiAttachment[]
  promptOverride?: string
  initialEvents?: NormalizedAgentEvent[]
  planExecutorHint?: { provider: ProviderId; model: string }
}

interface TurnHandle {
  turnId: string
  completion: Promise<{ status: 'completed' | 'stopped' | 'error'; assistantText: string }>
}

/** Người dùng bấm Dừng trong lúc phiên còn đang chuẩn bị (trước khi tạo lượt / tiến trình CLI). */
class TurnCancelledError extends Error {
  constructor() {
    super('Đã dừng trước khi AI bắt đầu chạy.')
    this.name = 'TurnCancelledError'
  }
}

export interface OrchestratorTestHooks {
  /** Chỉ dùng cho kiểm thử: chạy sau bước chụp checkpoint để mô phỏng bước chuẩn bị chậm. */
  afterCheckpoint?: () => Promise<void>
}

export class AgentOrchestrator extends EventEmitter {
  private readonly running = new Map<string, RunningJob>()
  // Phiên đang chuẩn bị spawn (checkpoint, handoff...) — chặn gửi trùng trong khoảng await trước khi vào `running`
  private readonly starting = new Set<string>()
  private readonly cancelledOrchestrations = new Set<string>()
  // Tăng mỗi lần bấm Dừng; lượt đang chuẩn bị so sánh với giá trị lúc bắt đầu để biết mình đã bị hủy chưa
  private readonly cancelEpoch = new Map<string, number>()

  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly testHooks: OrchestratorTestHooks = {}
  ) {
    super()
  }

  getRunningSessionIds(): Set<string> {
    return new Set([...this.running.keys(), ...this.starting])
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId) || this.starting.has(sessionId)
  }

  compactSessionContext(sessionId: string, trigger: 'manual' | 'auto' = 'manual'): CompactContextResult {
    if (trigger === 'manual' && this.isRunning(sessionId)) {
      throw new Error('Phiên đang chạy — hãy dừng trước khi nén ngữ cảnh.')
    }
    const session = this.repo.getSession(sessionId, this.getRunningSessionIds())
    if (!session) throw new Error('Không tìm thấy phiên làm việc')

    const turns = this.repo.listTurns(sessionId)
    const memory = this.repo.getMemory(sessionId)
    const workDir =
      session.worktreePath && fs.existsSync(session.worktreePath) ? session.worktreePath : session.workspacePath
    const allSkills = fs.existsSync(workDir) ? listAllSkills(workDir) : []
    const activeSkillsChars = allSkills
      .filter((s) => memory.activeSkillIds.includes(s.id) || memory.activeSkillIds.includes(s.name))
      .reduce((sum, s) => sum + s.body.length, 0)

    const before = estimateSessionContextUsage({
      provider: session.provider,
      model: session.model,
      turns,
      memory,
      activeSkillsChars
    })

    const compactedPatch = compactSessionMemoryFromTurns(memory, turns)
    const compactedTurnsCount = turns.filter(
      (t) => t.status === 'completed' && t.turnIndex > (memory.compactedUpToTurnIndex ?? 0)
    ).length

    const updatedMemory = this.repo.updateMemory(sessionId, compactedPatch)
    const providerStates = this.repo.resetProviderStatesForCompact(sessionId, updatedMemory.compactedUpToTurnIndex)

    const after = estimateSessionContextUsage({
      provider: session.provider,
      model: session.model,
      turns,
      memory: updatedMemory,
      activeSkillsChars
    })

    return {
      memory: updatedMemory,
      providerStates,
      compactedTurnsCount,
      beforeTokens: before.usedTokens,
      afterTokens: after.usedTokens,
      trigger
    }
  }

  async sendPrompt(params: {
    sessionId: string
    prompt: string
    provider?: ProviderId
    model?: string
    effort?: EffortLevel
    permissionMode?: PermissionMode
    attachments?: AiAttachment[]
    orchestrator?: OrchestratorConfig
  }): Promise<{ turnId: string }> {
    const orch = params.orchestrator
    if (!orch?.enabled) {
      this.cancelledOrchestrations.delete(params.sessionId)
      const res = await this.executeSingleTurn(params)
      return { turnId: res.turnId }
    }

    this.cancelledOrchestrations.delete(params.sessionId)
    const userTask = params.prompt.trim()
    const plannerProvider = orch.plannerProvider
    const plannerModel = orch.plannerModel
    const executorProvider = orch.executorProvider
    const executorModel = orch.executorModel

    const plannerPrompt = [
      `[CHẾ ĐỘ ORCHESTRATOR — GIAI ĐOẠN 1: LẬP KẾ HOẠCH]`,
      `Hãy phân tích yêu cầu dưới đây, khảo sát nhanh mã nguồn liên quan trong workspace và lập kế hoạch triển khai chi tiết từng bước (các file cần tạo/sửa, rủi ro, tiêu chí kiểm chứng).`,
      `KHÔNG tự chỉnh sửa file ở bước này — Executor (${executorProvider.toUpperCase()}${executorModel ? ` / ${executorModel}` : ''}) sẽ đảm nhiệm thực thi ngay sau bản kế hoạch của bạn.`,
      `\nYêu cầu của người dùng:\n${userTask}`
    ].join('\n')

    const phase1 = await this.executeSingleTurn({
      sessionId: params.sessionId,
      prompt: userTask,
      promptOverride: plannerPrompt,
      provider: plannerProvider,
      model: plannerModel,
      effort: params.effort,
      permissionMode: 'plan',
      attachments: params.attachments,
      planExecutorHint: !orch.autoExecute ? { provider: executorProvider, model: executorModel } : undefined,
      initialEvents: [
        {
          type: 'orchestrator.phase',
          phase: 'planning',
          provider: plannerProvider,
          model: plannerModel || undefined,
          summary: `Planner (${plannerProvider.toUpperCase()}${plannerModel ? ` · ${plannerModel}` : ''}) đang khảo sát & lập kế hoạch triển khai…`
        }
      ]
    })

    // Chạy nền các pha tiếp theo sau khi Phase 1 hoàn tất
    void phase1.completion
      .then(async (res1) => {
        if (this.cancelledOrchestrations.has(params.sessionId) || res1.status !== 'completed') {
          return
        }
        if (!orch.autoExecute) {
          return
        }

        const execMode: PermissionMode = params.permissionMode === 'plan' ? 'edit' : (params.permissionMode ?? 'edit')
        const execPrompt = [
          `[CHẾ ĐỘ ORCHESTRATOR — GIAI ĐOẠN 2: THỰC THI]`,
          `Kế hoạch đã được Planner chốt bên trên:`,
          res1.assistantText ? `\n<approved_plan>\n${res1.assistantText.slice(0, 6000)}\n</approved_plan>\n` : '',
          `Hãy triển khai đầy đủ, sạch sẽ các thay đổi code cần thiết cho yêu cầu: "${userTask}". Sau khi sửa xong, hãy chạy kiểm tra nhanh (typecheck/test nếu có) để đảm bảo không lỗi.`
        ].join('\n')

        const phase2 = await this.executeSingleTurn({
          sessionId: params.sessionId,
          prompt: `Thực thi kế hoạch: ${userTask}`,
          promptOverride: execPrompt,
          provider: executorProvider,
          model: executorModel,
          effort: params.effort,
          permissionMode: execMode,
          initialEvents: [
            {
              type: 'orchestrator.phase',
              phase: 'executing',
              provider: executorProvider,
              model: executorModel || undefined,
              summary: `Executor (${executorProvider.toUpperCase()}${executorModel ? ` · ${executorModel}` : ''}) đang thực thi theo kế hoạch…`
            }
          ]
        })

        const res2 = await phase2.completion
        if (
          this.cancelledOrchestrations.has(params.sessionId) ||
          res2.status !== 'completed' ||
          !orch.verifyAfterExecute
        ) {
          return
        }

        const verifyPrompt = [
          `[CHẾ ĐỘ ORCHESTRATOR — GIAI ĐOẠN 3: KIỂM DUYỆT KẾT QUẢ]`,
          `Executor vừa hoàn tất triển khai cho yêu cầu: "${userTask}".`,
          `Hãy kiểm tra lại \`git status\`, \`git diff\` và rà soát tính đầy đủ, bug tiềm ẩn hoặc thiếu sót so với kế hoạch ban đầu (chỉ đọc & báo cáo, không sửa file).`
        ].join('\n')

        const phase3 = await this.executeSingleTurn({
          sessionId: params.sessionId,
          prompt: `Kiểm duyệt kết quả: ${userTask}`,
          promptOverride: verifyPrompt,
          provider: plannerProvider,
          model: plannerModel,
          effort: params.effort,
          permissionMode: 'plan',
          initialEvents: [
            {
              type: 'orchestrator.phase',
              phase: 'verifying',
              provider: plannerProvider,
              model: plannerModel || undefined,
              summary: `Planner (${plannerProvider.toUpperCase()}) đang kiểm duyệt thay đổi & đối chiếu kế hoạch…`
            }
          ]
        })
        await phase3.completion
      })
      .catch((err) => {
        if (err instanceof TurnCancelledError) {
          this.emit('ai:status', { sessionId: params.sessionId, status: 'idle' })
          return
        }
        this.emit('ai:status', { sessionId: params.sessionId, status: 'error' })
        console.error('Orchestrator pipeline error:', err)
      })

    return { turnId: phase1.turnId }
  }

  private async executeSingleTurn(params: SingleTurnParams): Promise<TurnHandle> {
    if (this.isRunning(params.sessionId)) {
      throw new Error('Phiên này đang xử lý, hãy chờ xong hoặc bấm Dừng.')
    }
    const sessionId = params.sessionId
    const epoch = this.cancelEpoch.get(sessionId) ?? 0
    const isCancelled = (): boolean => (this.cancelEpoch.get(sessionId) ?? 0) !== epoch
    this.starting.add(sessionId)
    // Báo 'running' ngay từ lúc chuẩn bị để giao diện hiện nút Dừng trong khoảng chụp checkpoint
    this.emit('ai:status', { sessionId, status: 'running' })
    try {
      return await this.startTurn(params, isCancelled)
    } catch (err) {
      this.starting.delete(sessionId)
      this.emit('ai:status', { sessionId, status: 'idle' })
      throw err
    } finally {
      this.starting.delete(sessionId)
    }
  }

  private async startTurn(params: SingleTurnParams, isCancelled: () => boolean): Promise<TurnHandle> {
    const session = this.repo.getSession(params.sessionId, this.getRunningSessionIds())
    if (!session) throw new Error('Không tìm thấy phiên làm việc')

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

    const previousProvider = session.provider
    const providerChanged = previousProvider !== targetProvider

    const settings = this.repo.getSettings()
    const resolvedCli = resolveCliCommand(targetProvider, settings.cliOverrides[targetProvider])
    if (!resolvedCli) {
      throw new Error(`Chưa tìm thấy CLI cho ${targetProvider}. Kiểm tra lại trong Cài đặt → Chẩn đoán CLI.`)
    }

    const rawWorkDir = resolveSessionWorkDir(session)
    if (!fs.existsSync(rawWorkDir)) {
      throw new Error(`Thư mục làm việc không tồn tại: ${rawWorkDir}`)
    }
    const workDir = fs.realpathSync.native(rawWorkDir)

    const preSnap = await captureCheckpoint(workDir)
    await this.testHooks.afterCheckpoint?.()
    if (isCancelled()) throw new TurnCancelledError()
    const repoSummary = await getRepoSummary(workDir)

    let memory = this.repo.getMemory(session.id)
    const turns = this.repo.listTurns(session.id)
    const allSkills = listAllSkills(workDir)
    const activeSkills = allSkills.filter(
      (s) => memory.activeSkillIds.includes(s.id) || memory.activeSkillIds.includes(s.name)
    )
    const activeSkillsChars = activeSkills.reduce((sum, s) => sum + s.body.length, 0)

    const pendingInitialEvents: NormalizedAgentEvent[] = [...(params.initialEvents ?? [])]

    // Auto-compact context window nếu vượt ngưỡng cấu hình
    if (settings.autoCompactEnabled) {
      const ctxUsage = estimateSessionContextUsage({
        provider: targetProvider,
        model,
        turns,
        memory,
        activeSkillsChars
      })
      const threshold = Math.max(50, Math.min(98, settings.autoCompactThreshold || 80))
      if (ctxUsage.activeTurnsCount >= 2 && ctxUsage.percent >= threshold) {
        const compacted = this.compactSessionContext(session.id, 'auto')
        memory = compacted.memory
        pendingInitialEvents.unshift({
          type: 'context.compacted',
          trigger: 'auto',
          compactedTurnsCount: compacted.compactedTurnsCount,
          beforeTokens: compacted.beforeTokens,
          afterTokens: compacted.afterTokens,
          thresholdPercent: threshold
        })
      }
    }

    const targetSyncState = this.repo.getProviderState(session.id, targetProvider)

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

    const effectiveBody = (params.promptOverride ?? params.prompt).trim()
    const promptWithAttachments =
      attachmentTexts.length > 0 ? `${effectiveBody}\n\n${attachmentTexts.join('\n')}` : effectiveBody

    const { compiledPrompt, unsyncedTurnsCount, isHandoff } = buildHandoffPrompt({
      targetProvider,
      memory,
      turns,
      targetSyncState,
      activeSkills,
      repoSummary,
      userPrompt: promptWithAttachments
    })

    // Lần kiểm tra hủy cuối cùng trước khi ghi bất cứ thứ gì (đổi provider, tạo lượt) và trước khi spawn CLI
    if (isCancelled()) throw new TurnCancelledError()

    let nextTitle = session.title
    if (turns.length === 0 && (session.title === 'Phiên làm việc mới' || !session.title.trim())) {
      const firstLine = params.prompt.trim().split(/\r?\n/)[0] || 'Phiên mới'
      nextTitle = firstLine.length > 64 ? `${firstLine.slice(0, 64)}…` : firstLine
    }

    const targetProviderSessionId =
      targetSyncState?.providerSessionId ?? (providerChanged ? null : session.providerSessionId)

    this.repo.updateSession(session.id, {
      title: nextTitle,
      provider: targetProvider,
      providerSessionId: targetProviderSessionId,
      model,
      effort,
      permissionMode: mode
    })

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

    for (const initEv of pendingInitialEvents) {
      emitAndStore(initEv, true)
    }

    const completedTurns = turns.filter((t) => t.status === 'completed')
    const lastCompletedTurn = completedTurns[completedTurns.length - 1]
    const switchedFromOtherProvider = Boolean(lastCompletedTurn && lastCompletedTurn.provider !== targetProvider)

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
    let cmdSpec: ReturnType<typeof adapter.buildHeadlessCommand>
    let child: ChildProcess
    try {
      cmdSpec = adapter.buildHeadlessCommand({
        mode,
        model,
        effort,
        providerSessionId: targetProviderSessionId,
        prompt: compiledPrompt,
        imagePaths,
        extraDirs: [],
        claudeAuthMode: settings.claudeAuthMode,
        workDir
      })
      const env = getEnrichedEnv(cmdSpec.unsetEnv)
      child = spawn(resolvedCli.file, [...resolvedCli.argsPrefix, ...cmdSpec.args], {
        cwd: workDir,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      // Không để lượt kẹt ở trạng thái 'running' vĩnh viễn nếu không dựng/spawn được CLI
      const message = err instanceof Error ? err.message : String(err)
      emitAndStore({ type: 'error', message: `Không khởi chạy được CLI: ${message}` }, true)
      this.repo.completeTurn(turn.id, { status: 'error' })
      throw err
    }

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

    try {
      child.stdin?.write(cmdSpec.stdinData, 'utf8')
      child.stdin?.end()
    } catch {
      // ignore if process exited early
    }

    const completion = new Promise<{ status: 'completed' | 'stopped' | 'error'; assistantText: string }>((resolve) => {
      child.on('close', async (exitCode) => {
        try {
          for (const ev of adapter.flush(streamState)) {
            handleEvent(ev)
          }

          if (mode === 'plan' && !job.stopped && fullAssistantText.trim().length > 80) {
            emitAndStore({
              type: 'plan.proposed',
              title: 'Kế hoạch đề xuất',
              markdown: fullAssistantText.trim(),
              ...(params.planExecutorHint
                ? {
                    executorProvider: params.planExecutorHint.provider,
                    executorModel: params.planExecutorHint.model
                  }
                : {})
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

          let postTreeHash: string | null = null
          try {
            postTreeHash = (await captureCheckpoint(workDir)).treeHash
          } catch (err) {
            console.error('captureCheckpoint (post-turn) failed:', err)
          }
          this.repo.completeTurn(turn.id, {
            status: finalStatus,
            postTreeHash,
            durationMs: turnResultMeta.durationMs || elapsed,
            inputTokens: turnResultMeta.inputTokens ?? null,
            outputTokens: turnResultMeta.outputTokens ?? null,
            costUsd: turnResultMeta.costUsd ?? null
          })

          if (finalStatus !== 'error') {
            this.repo.upsertProviderState(session.id, targetProvider, activeProviderSessionId, turn.turnIndex)
          }

          const updatedTurn = this.repo.getTurn(turn.id)
          if (updatedTurn) {
            const curMem = this.repo.getMemory(session.id)
            const extracted = extractKeyFilesFromTurn(updatedTurn)
            if (extracted.length > 0) {
              const merged = Array.from(new Set([...curMem.keyFiles, ...extracted])).slice(0, 30)
              this.repo.updateMemory(session.id, { keyFiles: merged })
            }
          }

          // Chỉ nhả khóa 'running' sau khi đã lưu xong lượt, tránh gửi chồng lượt mới lên lượt đang hoàn tất
          this.running.delete(session.id)
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

          resolve({ status: finalStatus, assistantText: fullAssistantText.trim() })
        } catch (err) {
          console.error('Orchestrator close handler failed:', err)
          this.running.delete(session.id)
          try {
            this.repo.completeTurn(turn.id, { status: 'error' })
          } catch {
            // ignore
          }
          this.emit('ai:status', { sessionId: session.id, status: 'error' })
          resolve({ status: 'error', assistantText: fullAssistantText.trim() })
        }
      })
    })

    return { turnId: turn.id, completion }
  }

  async stopRun(sessionId: string): Promise<void> {
    this.cancelledOrchestrations.add(sessionId)
    this.cancelEpoch.set(sessionId, (this.cancelEpoch.get(sessionId) ?? 0) + 1)
    const job = this.running.get(sessionId)
    if (!job) return
    job.stopped = true
    const pid = job.child.pid
    if (pid) {
      if (process.platform === 'win32') {
        spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      } else {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          job.child.kill('SIGTERM')
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.running.keys()).map((id) => this.stopRun(id)))
  }
}
