import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiAttachment, ProviderId } from '@shared/types/ai'
import type { FileChange, GitGraphQuery, HunkAction, ResetMode } from '@shared/types/git'
import type { PromptTemplate } from '@shared/types/governance'
import type { CreateSessionRequest, SendPromptRequest } from '@shared/types/ipc'
import type { AppSettings, PtyCreateOptions } from '@shared/types/workspace'
import { getProviderAdapter } from '../ai/adapters/registry'
import { inspectAllClis, resolveCliCommand } from '../ai/cli-locator'
import { compactSessionMemoryFromTurns } from '../ai/context-memory'
import { resolveSessionWorkDir } from '../ai/session-workdir'
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
import { getProviderQuotas } from '../ai/quota-service'
import { importClaudeHistoryIntoTurns } from '../ai/transcript-importer'
import { listWorkspaceDirectory, readExternalPreviewFile, readWorkspaceFile, writeWorkspaceFile } from '../context/file-browser-service'
import { saveClipboardImage, searchWorkspaceFiles } from '../context/workspace-indexer'
import { restoreCheckpoint, restoreFileFromCheckpoint } from '../git/checkpoint-service'
import {
  commitChanges,
  getFileDiff,
  getLastCommitMessage,
  getRepoSummary,
  getTurnChangedFiles,
  getTurnFileDiff,
  getWorkingChanges,
  revertWorkingFile,
  stageFiles
} from '../git/diff-service'
import {
  applyHunkPatch,
  applyOrPopStash,
  checkoutCommit,
  cherryPickCommit,
  continueOrAbortOperation,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  dropStash,
  fetchAll,
  getRepoOperationState,
  getStashDiff,
  listStashes,
  mergeBranchIntoCurrent,
  pullCurrentBranch,
  pushCurrentBranch,
  rebaseCurrentOnto,
  renameBranch,
  resetToCommit,
  revertCommit,
  saveStash
} from '../git/git-ops-service'
import {
  createFlowBranch,
  getCommitDetail,
  getCommitFileDiff,
  getCommitGraph,
  listBranches,
  pushBranchForMr,
  switchBranch
} from '../git/graph-service'
import {
  createIsolatedWorktree,
  finalizeWorktreeMerge,
  getMergeConflictStatus,
  listWorktrees,
  mergeWorktreeBranch,
  prepareAndMergeWorktree,
  removeWorktree,
  resolveMergeConflictFile
} from '../git/worktree-service'
import type { AppsBatchAction, AppsCatalogConfig, DevAppConfig } from '@shared/types/apps'
import {
  addManualApp,
  exportAppsCatalogToFile,
  importAppsCatalogFromFile,
  readAppsConfig,
  removeAppsFromCatalog,
  removeAppsProfile,
  restoreAppsFromRemoved,
  saveAppsProfile,
  setAppsAutoRestart,
  updateAppConfig,
  writeAppsConfig
} from '../apps/apps-store'
import type { AppsManager } from '../apps/apps-manager'
import { addIisSitesToCatalog, getIisSites, isIisInstalled } from '../apps/iis-service'
import { stopPortOwner } from '../apps/process-inspector'
import { scanAndUpdateAppsCatalog } from '../apps/project-scanner'
import type { WorkspaceRepository } from '../storage/repositories'
import { openInVsCode } from '../system/vscode-launcher'
import { checkForAppUpdates, getAppRootDir, getAppVersionInfo } from '../system/update-service'
import type { PtyManager } from '../terminal/pty-manager'

export function registerIpcHandlers(params: {
  getWindow: () => BrowserWindow | null
  repo: WorkspaceRepository
  orchestrator: AgentOrchestrator
  ptyManager: PtyManager
  appsManager: AppsManager
}): void {
  const { getWindow, repo, orchestrator, ptyManager, appsManager } = params

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
    const opts = {
      properties: ['openDirectory'] as Array<'openDirectory'>,
      title: 'Chọn thư mục workspace / dự án'
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0] ?? null
  })
  ipcMain.handle('os:openExplorer', async (_e, targetPath: string) => {
    if (targetPath && fs.existsSync(targetPath)) {
      await shell.openPath(targetPath)
    }
  })
  ipcMain.handle('os:openVsCode', (_e, targetPath: string) => openInVsCode(targetPath))
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
      title: 'Cập nhật Multi-Agent Studio',
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
  ipcMain.handle('ai:compactContext', (_e, sessionId: string) => {
    return orchestrator.compactSessionContext(sessionId, 'manual')
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
  ipcMain.handle('ai:providerQuotas', (_e, forceRefresh?: boolean, agyReferenceCap5h?: number) =>
    getProviderQuotas(repo, Boolean(forceRefresh), agyReferenceCap5h)
  )

  // Context & File Browser
  ipcMain.handle('context:searchFiles', (_e, dir: string, query: string) => searchWorkspaceFiles(dir, query))
  ipcMain.handle('context:saveClipboardImage', (_e, sessionId: string, dataUrl: string): AiAttachment => {
    return saveClipboardImage(sessionId, dataUrl)
  })
  ipcMain.handle('fs:listDir', (_e, rootDir: string, relDir?: string) => listWorkspaceDirectory(rootDir, relDir))
  ipcMain.handle('fs:readFile', (_e, rootDir: string, relPath: string) => readWorkspaceFile(rootDir, relPath))
  ipcMain.handle('fs:readExternalFile', (_e, absPath: string) => readExternalPreviewFile(absPath))
  ipcMain.handle('fs:writeFile', (_e, rootDir: string, relPath: string, content: string) => {
    return writeWorkspaceFile(rootDir, relPath, content)
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
  ipcMain.handle('git:commit', (_e, dir: string, message: string, options?: { amend?: boolean }) => {
    return commitChanges(dir, message, options)
  })
  ipcMain.handle('git:lastCommitMsg', (_e, dir: string) => getLastCommitMessage(dir))
  ipcMain.handle('git:revertFile', (_e, dir: string, change: FileChange) => revertWorkingFile(dir, change))
  ipcMain.handle('git:applyHunk', (_e, dir: string, filePath: string, staged: boolean, action: HunkAction, hunkIndex: number) => {
    return applyHunkPatch(dir, filePath, staged, action, hunkIndex)
  })
  ipcMain.handle('git:restoreTurn', async (_e, sessionId: string, turnId: string) => {
    const session = repo.getSession(sessionId)
    const turn = repo.getTurn(turnId)
    if (!session || !turn || !turn.preTreeHash) throw new Error('Không có checkpoint cho lượt này')
    const workDir = resolveSessionWorkDir(session)
    await restoreCheckpoint(workDir, turn.preTreeHash)
  })
  ipcMain.handle('git:restoreTurnFile', async (_e, sessionId: string, turnId: string, filePath: string) => {
    const session = repo.getSession(sessionId)
    const turn = repo.getTurn(turnId)
    if (!session || !turn || !turn.preTreeHash) throw new Error('Không có checkpoint cho lượt này')
    const workDir = resolveSessionWorkDir(session)
    await restoreFileFromCheckpoint(workDir, turn.preTreeHash, filePath)
  })
  ipcMain.handle('git:branches', (_e, dir: string) => listBranches(dir))
  ipcMain.handle('git:graph', (_e, dir: string, countOrQuery?: number | GitGraphQuery) => {
    return getCommitGraph(dir, countOrQuery)
  })
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
  ipcMain.handle('git:opState', (_e, dir: string) => getRepoOperationState(dir))
  ipcMain.handle('git:fetchAll', (_e, dir: string, prune?: boolean) => fetchAll(dir, prune))
  ipcMain.handle('git:pullBranch', (_e, dir: string, options?: { rebase?: boolean }) => pullCurrentBranch(dir, options))
  ipcMain.handle('git:pushBranch', (_e, dir: string, options?: { forceWithLease?: boolean; pushTags?: boolean }) => {
    return pushCurrentBranch(dir, options)
  })
  ipcMain.handle('git:createBranch', (_e, dir: string, name: string, options?: { startPoint?: string; checkout?: boolean }) => {
    return createBranch(dir, name, options)
  })
  ipcMain.handle('git:renameBranch', (_e, dir: string, oldName: string, newName: string) => renameBranch(dir, oldName, newName))
  ipcMain.handle('git:deleteBranch', (_e, dir: string, name: string, force?: boolean) => deleteBranch(dir, name, force))
  ipcMain.handle('git:mergeBranch', (_e, dir: string, sourceRef: string, options?: { noFastForward?: boolean }) => {
    return mergeBranchIntoCurrent(dir, sourceRef, options)
  })
  ipcMain.handle('git:rebaseBranch', (_e, dir: string, targetRef: string) => rebaseCurrentOnto(dir, targetRef))
  ipcMain.handle('git:continueOrAbortOp', (_e, dir: string, op: 'merge' | 'rebase' | 'cherry-pick' | 'revert', action: 'continue' | 'abort') => {
    return continueOrAbortOperation(dir, op, action)
  })
  ipcMain.handle('git:listStashes', (_e, dir: string) => listStashes(dir))
  ipcMain.handle('git:saveStash', (_e, dir: string, message?: string, includeUntracked?: boolean) => {
    return saveStash(dir, message, includeUntracked)
  })
  ipcMain.handle('git:applyStash', (_e, dir: string, stashRef: string, pop?: boolean) => applyOrPopStash(dir, stashRef, Boolean(pop)))
  ipcMain.handle('git:dropStash', (_e, dir: string, stashRef: string) => dropStash(dir, stashRef))
  ipcMain.handle('git:stashDiff', (_e, dir: string, stashRef: string) => getStashDiff(dir, stashRef))
  ipcMain.handle('git:createTag', (_e, dir: string, name: string, target?: string, message?: string) => {
    return createTag(dir, name, target, message)
  })
  ipcMain.handle('git:deleteTag', (_e, dir: string, name: string) => deleteTag(dir, name))
  ipcMain.handle('git:cherryPick', (_e, dir: string, hash: string) => cherryPickCommit(dir, hash))
  ipcMain.handle('git:revertCommit', (_e, dir: string, hash: string) => revertCommit(dir, hash))
  ipcMain.handle('git:resetCommit', (_e, dir: string, hash: string, mode: ResetMode) => resetToCommit(dir, hash, mode))
  ipcMain.handle('git:checkoutCommit', (_e, dir: string, hash: string) => checkoutCommit(dir, hash))
  ipcMain.handle('git:listWorktrees', (_e, dir: string) => listWorktrees(dir))
  ipcMain.handle('git:removeWorktree', (_e, repoRoot: string, worktreePath: string, deleteBranch?: boolean, force?: boolean) => {
    return removeWorktree(repoRoot, worktreePath, Boolean(deleteBranch), Boolean(force))
  })
  ipcMain.handle('git:mergeWorktree', (_e, repoRoot: string, worktreeBranch: string) => {
    return mergeWorktreeBranch(repoRoot, worktreeBranch)
  })
  ipcMain.handle(
    'git:prepareMergeWorktree',
    (
      _e,
      repoRoot: string,
      worktreePath: string,
      worktreeBranch: string,
      options?: { autoCommitWorktree?: boolean; autoCommitMain?: boolean; commitMessage?: string }
    ) => prepareAndMergeWorktree(repoRoot, worktreePath, worktreeBranch, options)
  )
  ipcMain.handle('git:getMergeConflicts', (_e, repoRoot: string) => getMergeConflictStatus(repoRoot))
  ipcMain.handle(
    'git:resolveMergeConflict',
    (_e, repoRoot: string, filePath: string, strategy: 'ours' | 'theirs' | 'custom', customContent?: string) =>
      resolveMergeConflictFile(repoRoot, filePath, strategy, customContent)
  )
  ipcMain.handle(
    'git:finalizeMerge',
    (_e, repoRoot: string, action: 'complete' | 'abort', commitMessage?: string) =>
      finalizeWorktreeMerge(repoRoot, action, commitMessage)
  )

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
    const workDir = resolveSessionWorkDir(session)

    return ptyManager.create({
      cwd: workDir,
      title: `${PROVIDERS[session.provider].shortName} (${path.basename(workDir)})`,
      initialCommand: resolved.file,
      args: [...resolved.argsPrefix, ...cliArgs]
    })
  })

  // Apps Studio
  ipcMain.handle('apps:getConfig', () => readAppsConfig())
  ipcMain.handle(
    'apps:updateConfig',
    (_e, patch: Partial<Pick<AppsCatalogConfig, 'scanRanges' | 'scanRoots' | 'showStats'>>) => {
      const cur = readAppsConfig()
      return writeAppsConfig({ ...cur, ...patch })
    }
  )
  ipcMain.handle('apps:scan', (_e, roots?: string[]) => {
    const targetRoots = roots && roots.length > 0 ? roots : readAppsConfig().scanRoots
    return scanAndUpdateAppsCatalog(targetRoots)
  })
  ipcMain.handle('apps:list', (_e, includeStats?: boolean) => appsManager.listDevApps(includeStats))
  ipcMain.handle('apps:add', (_e, input: Omit<DevAppConfig, 'id'> & { id?: string }) => addManualApp(input))
  ipcMain.handle('apps:update', (_e, id: string, patch: Partial<Omit<DevAppConfig, 'id'>>) => updateAppConfig(id, patch))
  ipcMain.handle('apps:remove', async (_e, ids: string[], stopRunning?: boolean) => {
    const idSet = new Set(ids)
    const removedPorts = readAppsConfig()
      .apps.filter((a) => idSet.has(a.id) && a.port > 0)
      .map((a) => a.port)

    if (stopRunning) {
      const stopRes = await appsManager.runBatchAction('stop', ids)
      if (!stopRes.ok) {
        throw new Error(stopRes.errors.join('; '))
      }
    }
    for (const port of removedPorts) {
      await appsManager.stopTunnel(port)
    }
    const res = removeAppsFromCatalog(ids)
    return {
      message: `Đã gỡ khỏi danh mục: ${res.removed.map((a) => a.name).join(', ')}`,
      config: res.config
    }
  })
  ipcMain.handle('apps:restore', (_e, ids: string[]) => restoreAppsFromRemoved(ids))
  ipcMain.handle('apps:autoRestart', (_e, ids: string[], on: boolean) => setAppsAutoRestart(ids, on))
  ipcMain.handle('apps:batch', (_e, action: AppsBatchAction, ids: string[]) => appsManager.runBatchAction(action, ids))
  ipcMain.handle('apps:maintenance', (_e, id: string, task: 'npm-install' | 'dotnet-build', stopFirst?: boolean) =>
    appsManager.runMaintenanceTask(id, task, Boolean(stopFirst))
  )
  ipcMain.handle('apps:getLog', (_e, id: string, tail?: number) => appsManager.getAppLog(id, tail))
  ipcMain.handle('apps:clearLog', (_e, id: string) => appsManager.clearAppLog(id))
  ipcMain.handle('apps:saveProfile', (_e, name: string, ids: string[]) => saveAppsProfile(name, ids))
  ipcMain.handle('apps:removeProfile', (_e, name: string) => removeAppsProfile(name))
  ipcMain.handle('apps:stopPort', (_e, port: number) => stopPortOwner(port))
  ipcMain.handle('apps:iisInstalled', () => isIisInstalled())
  ipcMain.handle('apps:listIis', () => getIisSites())
  ipcMain.handle('apps:addIis', (_e, siteNames: string[]) => addIisSitesToCatalog(siteNames))
  ipcMain.handle('apps:startTunnel', (_e, port: number, name: string) => appsManager.startTunnel(port, name))
  ipcMain.handle('apps:stopTunnel', (_e, port: number) => appsManager.stopTunnel(port))
  ipcMain.handle('apps:shareInfo', (_e, appName: string, group: string, port: number, url?: string) =>
    appsManager.getShareInfo(appName, group, port, url)
  )
  ipcMain.handle('apps:exportDialog', async () => {
    const win = getWindow()
    const saveOpts = {
      title: 'Xuất danh mục Ứng dụng (JSON)',
      defaultPath: 'multi-agent-studio-apps.json',
      filters: [{ name: 'Danh mục App (*.json)', extensions: ['json'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, saveOpts) : await dialog.showSaveDialog(saveOpts)
    if (res.canceled || !res.filePath) return null
    const out = exportAppsCatalogToFile(res.filePath)
    return `Đã xuất ${out.appCount} app, ${out.profileCount} bộ ra ${res.filePath}`
  })
  ipcMain.handle('apps:importDialog', async () => {
    const win = getWindow()
    const openOpts = {
      title: 'Nhập danh mục Ứng dụng (JSON)',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Danh mục App (*.json)', extensions: ['json'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts)
    if (res.canceled || !res.filePaths[0]) return null
    return importAppsCatalogFromFile(res.filePaths[0])
  })
}
