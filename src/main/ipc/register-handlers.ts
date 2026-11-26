import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiAttachment, ProviderId } from '@shared/types/ai'
import type { FileChange } from '@shared/types/git'
import type { PromptTemplate } from '@shared/types/governance'
import type { CreateSessionRequest, SendPromptRequest } from '@shared/types/ipc'
import type { AppSettings, PtyCreateOptions } from '@shared/types/workspace'
import { getProviderAdapter } from '../ai/adapters/registry'
import { inspectAllClis, resolveCliCommand } from '../ai/cli-locator'
import { compactSessionMemoryFromTurns } from '../ai/context-memory'
import {
  deleteSkillFile,
  listAllSkills,
  listMcpServers,
  listRuleFiles,
  saveRuleFileContent,
  saveSkillFile,
  syncAgentsRuleToTargets
} from '../ai/governance-service'
import type { AgentOrchestrator } from '../ai/orchestrator'
import { importClaudeHistoryIntoTurns } from '../ai/transcript-importer'
import { saveClipboardImage, searchWorkspaceFiles } from '../context/workspace-indexer'
import { restoreCheckpoint, restoreFileFromCheckpoint } from '../git/checkpoint-service'
import {
  commitChanges,
  getFileDiff,
  getRepoSummary,
  getTurnChangedFiles,
  getTurnFileDiff,
  getWorkingChanges,
  revertWorkingFile,
  stageFiles
} from '../git/diff-service'
import {
  createFlowBranch,
  getCommitDetail,
  getCommitFileDiff,
  getCommitGraph,
  listBranches,
  pushBranchForMr,
  switchBranch
} from '../git/graph-service'
import { createIsolatedWorktree, listWorktrees, mergeWorktreeBranch, removeWorktree } from '../git/worktree-service'
import { importLegacyPegasusData } from '../storage/legacy-importer'
import type { WorkspaceRepository } from '../storage/repositories'
import { checkForAppUpdates, getAppRootDir, getAppVersionInfo } from '../system/update-service'
import type { PtyManager } from '../terminal/pty-manager'

export function registerIpcHandlers(params: {
  getWindow: () => BrowserWindow | null
  repo: WorkspaceRepository
  orchestrator: AgentOrchestrator
  ptyManager: PtyManager
}): void {
  const { getWindow, repo, orchestrator, ptyManager } = params

  // Window controls
  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('dialog:pickFolder', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory'],
      title: 'Chọn thư mục workspace / dự án'
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })
  ipcMain.handle('os:openExplorer', async (_e, targetPath: string) => {
    if (targetPath && fs.existsSync(targetPath)) {
      await shell.openPath(targetPath)
    }
  })
  ipcMain.handle('os:openVsCode', async (_e, targetPath: string) => {
    if (targetPath && fs.existsSync(targetPath)) {
      spawn('code.cmd', [targetPath], { shell: true, windowsHide: true, detached: true })
    }
  })
  ipcMain.handle('os:openExternal', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })

  // Settings & Workspaces
  ipcMain.handle('settings:get', () => repo.getSettings())
  ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => repo.updateSettings(patch))
  ipcMain.handle('workspaces:list', () => repo.listWorkspaces())
  ipcMain.handle('workspaces:add', (_e, folderPath: string) => repo.upsertWorkspace(folderPath))
  ipcMain.handle('workspaces:remove', (_e, id: string) => repo.removeWorkspace(id))
  ipcMain.handle('legacy:import', () => importLegacyPegasusData(repo))

  // CLI Diagnostics
  ipcMain.handle('cli:statuses', (_e, forceRefresh?: boolean) => {
    const settings = repo.getSettings()
    return inspectAllClis(settings.cliOverrides, Boolean(forceRefresh))
  })
  ipcMain.handle('cli:install', (_e, provider: ProviderId) => {
    const cmd = PROVIDERS[provider].installCommand
    const pty = ptyManager.create({
      cwd: process.env.USERPROFILE || process.cwd(),
      title: `Cài đặt ${PROVIDERS[provider].name}`,
      initialCommand: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', cmd]
    })
    return { ptyId: pty.id, command: cmd }
  })

  // App Version & Updates
  ipcMain.handle('app:version', () => getAppVersionInfo())
  ipcMain.handle('app:checkUpdate', () => checkForAppUpdates())
  ipcMain.handle('app:runSourceUpdate', () => {
    const appRoot = getAppRootDir()
    const scriptPath = path.join(appRoot, 'scripts', 'update.ps1')
    const cmd = fs.existsSync(scriptPath)
      ? `& '${scriptPath.replace(/'/g, "''")}'`
      : 'git pull --ff-only origin main; npm install; npm run build'
    const pty = ptyManager.create({
      cwd: appRoot,
      title: 'Cập nhật AI Coding Tool',
      initialCommand: 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', cmd]
    })
    return { ptyId: pty.id }
  })

  // AI Sessions & Orchestrator
  ipcMain.handle('ai:listSessions', () => repo.listSessions(orchestrator.getRunningSessionIds()))
  ipcMain.handle('ai:createSession', async (_e, req: CreateSessionRequest) => {
    const ws = repo.upsertWorkspace(req.workspacePath)
    let worktreePath: string | null = null
    let worktreeBranch: string | null = null
    let worktreeBaseBranch: string | null = null

    if (req.useWorktree) {
      const wt = await createIsolatedWorktree(ws.path, req.worktreeBranchName)
      worktreePath = wt.worktreePath
      worktreeBranch = wt.branch
      worktreeBaseBranch = wt.baseBranch
    }

    const settings = repo.getSettings()
    return repo.createSession({
      workspaceId: ws.id,
      workspacePath: ws.path,
      provider: req.provider,
      model: req.model ?? '',
      effort: req.effort ?? 'medium',
      permissionMode: req.permissionMode ?? settings.defaultMode,
      title: req.title,
      worktreePath,
      worktreeBranch,
      worktreeBaseBranch
    })
  })

  ipcMain.handle('ai:updateSession', (_e, sessionId: string, patch: Record<string, unknown>) => {
    return repo.updateSession(sessionId, patch)
  })
  ipcMain.handle('ai:deleteSession', (_e, sessionId: string) => {
    if (orchestrator.isRunning(sessionId)) {
      throw new Error('Phiên đang chạy — hãy dừng trước khi xóa.')
    }
    repo.deleteSession(sessionId)
  })

  ipcMain.handle('ai:forkSession', (_e, sessionId: string, upToTurnIndex?: number) => {
    const orig = repo.getSession(sessionId)
    if (!orig) throw new Error('Không tìm thấy phiên gốc')
    const turns = repo.listTurns(sessionId).filter((t) => (upToTurnIndex ? t.turnIndex <= upToTurnIndex : true))
    const mem = repo.getMemory(sessionId)

    const forked = repo.createSession({
      workspaceId: orig.workspaceId,
      workspacePath: orig.workspacePath,
      provider: orig.provider,
      title: `${orig.title} (Nhánh)`,
      model: orig.model,
      effort: orig.effort,
      permissionMode: orig.permissionMode,
      worktreePath: orig.worktreePath,
      worktreeBranch: orig.worktreeBranch,
      worktreeBaseBranch: orig.worktreeBaseBranch
    })

    repo.updateMemory(forked.id, {
      goal: mem.goal,
      summary: mem.summary,
      decisions: mem.decisions,
      pinnedNotes: mem.pinnedNotes,
      keyFiles: mem.keyFiles,
      activeSkillIds: mem.activeSkillIds
    })

    // Copy turns into forked session with lastSyncedTurnIndex = 0 so next send hands off 100% context cleanly
    for (const t of turns) {
      const created = repo.createTurn({
        sessionId: forked.id,
        provider: t.provider,
        model: t.model,
        userPrompt: t.userPrompt,
        attachments: t.attachments,
        preTreeHash: t.preTreeHash,
        untrackedBackupId: t.untrackedBackupId,
        status: t.status === 'running' ? 'stopped' : t.status
      })
      t.events.forEach((ev, idx) => repo.appendEvent(created.id, idx + 1, ev.event))
      repo.completeTurn(created.id, {
        status: t.status === 'running' ? 'stopped' : t.status,
        postTreeHash: t.postTreeHash,
        durationMs: t.durationMs,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        costUsd: t.costUsd
      })
    }

    return forked
  })

  ipcMain.handle('ai:getSessionDetail', (_e, sessionId: string) => {
    const session = repo.getSession(sessionId, orchestrator.getRunningSessionIds())
    if (!session) throw new Error('Không tìm thấy phiên làm việc')
    return {
      session,
      turns: repo.listTurns(sessionId),
      memory: repo.getMemory(sessionId),
      providerStates: repo.listProviderStates(sessionId)
    }
  })

  ipcMain.handle('ai:switchProvider', (_e, sessionId: string, targetProvider: ProviderId, model?: string) => {
    const session = repo.getSession(sessionId)
    if (!session) throw new Error('Không tìm thấy phiên làm việc')
    if (orchestrator.isRunning(sessionId)) throw new Error('Hãy dừng lượt chạy hiện tại trước khi đổi AI tool.')

    const targetState = repo.getProviderState(sessionId, targetProvider)
    const turns = repo.listTurns(sessionId)
    const unsyncedTurnsCount = turns.filter((t) => t.turnIndex > (targetState?.lastSyncedTurnIndex ?? 0)).length

    const updated = repo.updateSession(sessionId, {
      provider: targetProvider,
      providerSessionId: targetState?.providerSessionId ?? null,
      ...(model !== undefined ? { model } : { model: '' })
    })!

    return {
      session: updated,
      providerStates: repo.listProviderStates(sessionId),
      unsyncedTurnsCount
    }
  })

  ipcMain.handle('ai:updateMemory', (_e, sessionId: string, patch: Record<string, unknown>) => {
    return repo.updateMemory(sessionId, patch)
  })
  ipcMain.handle('ai:compactMemory', (_e, sessionId: string) => {
    const cur = repo.getMemory(sessionId)
    const turns = repo.listTurns(sessionId)
    const compacted = compactSessionMemoryFromTurns(cur, turns)
    return repo.updateMemory(sessionId, compacted)
  })

  ipcMain.handle('ai:sendPrompt', (_e, req: SendPromptRequest) => orchestrator.sendPrompt(req))
  ipcMain.handle('ai:stopRun', (_e, sessionId: string) => orchestrator.stopRun(sessionId))

  ipcMain.handle('ai:importClaudeTranscript', (_e, sessionId: string) => {
    const session = repo.getSession(sessionId)
    if (!session || session.provider !== 'claude' || !session.providerSessionId) return []
    const existing = repo.listTurns(sessionId)
    if (existing.length > 0) return existing

    const parsed = importClaudeHistoryIntoTurns(session.workspacePath, session.providerSessionId)
    for (const item of parsed) {
      const t = repo.createTurn({
        sessionId: session.id,
        provider: 'claude',
        model: session.model,
        userPrompt: item.userPrompt,
        attachments: [],
        preTreeHash: null,
        untrackedBackupId: null,
        status: 'completed'
      })
      item.events.forEach((ev, idx) => repo.appendEvent(t.id, idx + 1, ev))
      repo.completeTurn(t.id, { status: 'completed' })
    }
    const turns = repo.listTurns(sessionId)
    if (turns.length > 0) {
      repo.upsertProviderState(session.id, 'claude', session.providerSessionId, turns[turns.length - 1].turnIndex)
    }
    return turns
  })

  ipcMain.handle('ai:usageSummary', () => repo.getUsageSummary())

  // Context
  ipcMain.handle('context:searchFiles', (_e, dir: string, query: string) => searchWorkspaceFiles(dir, query))
  ipcMain.handle('context:saveClipboardImage', (_e, sessionId: string, dataUrl: string): AiAttachment => {
    return saveClipboardImage(sessionId, dataUrl)
  })

  // Governance
  ipcMain.handle('gov:listSkills', (_e, workspacePath?: string) => listAllSkills(workspacePath))
  ipcMain.handle('gov:saveSkill', (_e, input: Parameters<typeof saveSkillFile>[0]) => saveSkillFile(input))
  ipcMain.handle('gov:deleteSkill', (_e, filePath: string) => deleteSkillFile(filePath))
  ipcMain.handle('gov:listRules', (_e, workspacePath?: string) => listRuleFiles(workspacePath))
  ipcMain.handle('gov:saveRule', (_e, filePath: string, content: string) => saveRuleFileContent(filePath, content))
  ipcMain.handle('gov:syncAgentsRule', (_e, workspacePath: string, targets: Array<'CLAUDE.md' | 'GEMINI.md'>) => {
    return syncAgentsRuleToTargets(workspacePath, targets)
  })
  ipcMain.handle('gov:listMcpServers', (_e, workspacePath?: string) => listMcpServers(workspacePath))
  ipcMain.handle('gov:listTemplates', () => repo.listPromptTemplates())
  ipcMain.handle('gov:saveTemplate', (_e, tpl: PromptTemplate) => repo.savePromptTemplate(tpl))
  ipcMain.handle('gov:deleteTemplate', (_e, id: string) => repo.deletePromptTemplate(id))

  // Git, Checkpoints & Worktrees
  ipcMain.handle('git:summary', (_e, dir: string) => getRepoSummary(dir))
  ipcMain.handle('git:changes', (_e, dir: string) => getWorkingChanges(dir))
  ipcMain.handle('git:fileDiff', (_e, dir: string, filePath: string, staged: boolean, code: string) => {
    return getFileDiff(dir, filePath, staged, code)
  })
  ipcMain.handle('git:turnDiff', (_e, dir: string, preTreeHash: string, postTreeHash?: string | null) => {
    return getTurnChangedFiles(dir, preTreeHash, postTreeHash ?? null)
  })
  ipcMain.handle('git:turnFileDiff', (_e, dir: string, preTreeHash: string, postTreeHash: string | null, filePath: string) => {
    return getTurnFileDiff(dir, preTreeHash, postTreeHash, filePath)
  })
  ipcMain.handle('git:stage', (_e, dir: string, paths: string[], stage: boolean, all?: boolean) => {
    return stageFiles(dir, paths, stage, Boolean(all))
  })
  ipcMain.handle('git:commit', (_e, dir: string, message: string) => commitChanges(dir, message))
  ipcMain.handle('git:revertFile', (_e, dir: string, change: FileChange) => revertWorkingFile(dir, change))
  ipcMain.handle('git:restoreTurn', async (_e, sessionId: string, turnId: string) => {
    const session = repo.getSession(sessionId)
    const turn = repo.getTurn(turnId)
    if (!session || !turn || !turn.preTreeHash) throw new Error('Không có checkpoint cho lượt này')
    const workDir = session.worktreePath && fs.existsSync(session.worktreePath) ? session.worktreePath : session.workspacePath
    await restoreCheckpoint(workDir, turn.preTreeHash)
  })
  ipcMain.handle('git:restoreTurnFile', async (_e, sessionId: string, turnId: string, filePath: string) => {
    const session = repo.getSession(sessionId)
    const turn = repo.getTurn(turnId)
    if (!session || !turn || !turn.preTreeHash) throw new Error('Không có checkpoint cho lượt này')
    const workDir = session.worktreePath && fs.existsSync(session.worktreePath) ? session.worktreePath : session.workspacePath
    await restoreFileFromCheckpoint(workDir, turn.preTreeHash, filePath)
  })
  ipcMain.handle('git:branches', (_e, dir: string) => listBranches(dir))
  ipcMain.handle('git:graph', (_e, dir: string, count?: number) => getCommitGraph(dir, count))
  ipcMain.handle('git:commitDetail', (_e, dir: string, hash: string) => getCommitDetail(dir, hash))
  ipcMain.handle('git:commitFileDiff', (_e, dir: string, hash: string, filePath: string) => {
    return getCommitFileDiff(dir, hash, filePath)
  })
  ipcMain.handle('git:switchBranch', (_e, dir: string, name: string, isRemote: boolean) => {
    return switchBranch(dir, name, isRemote)
  })
  ipcMain.handle('git:createFlowBranch', (_e, dir: string, type: 'feature' | 'fix' | 'bugfix' | 'hotfix', name: string, carry: boolean) => {
    return createFlowBranch(dir, type, name, carry)
  })
  ipcMain.handle('git:pushForMr', (_e, dir: string) => pushBranchForMr(dir))
  ipcMain.handle('git:listWorktrees', (_e, dir: string) => listWorktrees(dir))
  ipcMain.handle('git:removeWorktree', (_e, repoRoot: string, worktreePath: string, deleteBranch?: boolean) => {
    return removeWorktree(repoRoot, worktreePath, Boolean(deleteBranch))
  })
  ipcMain.handle('git:mergeWorktree', (_e, repoRoot: string, worktreeBranch: string) => {
    return mergeWorktreeBranch(repoRoot, worktreeBranch)
  })

  // PTY
  ipcMain.handle('pty:create', (_e, opts: PtyCreateOptions) => ptyManager.create(opts))
  ipcMain.on('pty:write', (_e, ptyId: string, data: string) => ptyManager.write(ptyId, data))
  ipcMain.on('pty:resize', (_e, ptyId: string, cols: number, rows: number) => ptyManager.resize(ptyId, cols, rows))
  ipcMain.handle('pty:kill', (_e, ptyId: string) => ptyManager.kill(ptyId))
  ipcMain.handle('pty:openInteractiveSession', (_e, sessionId: string) => {
    const session = repo.getSession(sessionId)
    if (!session) throw new Error('Không tìm thấy phiên')
    const settings = repo.getSettings()
    const resolved = resolveCliCommand(session.provider, settings.cliOverrides[session.provider])
    if (!resolved) throw new Error(`Chưa cài đặt ${PROVIDERS[session.provider].name}`)
    const adapter = getProviderAdapter(session.provider)
    const cliArgs = adapter.buildInteractiveArgs(session.providerSessionId, session.model)
    const workDir = session.worktreePath && fs.existsSync(session.worktreePath) ? session.worktreePath : session.workspacePath

    return ptyManager.create({
      cwd: workDir,
      title: `${PROVIDERS[session.provider].shortName} (${path.basename(workDir)})`,
      initialCommand: resolved.file,
      args: [...resolved.argsPrefix, ...cliArgs]
    })
  })
}
