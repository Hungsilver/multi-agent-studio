import { contextBridge, ipcRenderer } from 'electron'
import type { AiStreamPushEvent, AiSessionStatusPush, PtyDataPush, PtyExitPush, WorkspaceApi } from '@shared/types/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: WorkspaceApi = {
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openInExplorer: (targetPath) => ipcRenderer.invoke('os:openExplorer', targetPath),
  openInVsCode: (targetPath) => ipcRenderer.invoke('os:openVsCode', targetPath),
  openExternalUrl: (url) => ipcRenderer.invoke('os:openExternal', url),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  addWorkspace: (folderPath) => ipcRenderer.invoke('workspaces:add', folderPath),
  removeWorkspace: (id) => ipcRenderer.invoke('workspaces:remove', id),
  importLegacyConfig: () => ipcRenderer.invoke('legacy:import'),

  getCliStatuses: (forceRefresh) => ipcRenderer.invoke('cli:statuses', forceRefresh),
  installOrUpdateCli: (provider) => ipcRenderer.invoke('cli:install', provider),

  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkAppUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  runSourceUpdate: () => ipcRenderer.invoke('app:runSourceUpdate'),

  listSessions: () => ipcRenderer.invoke('ai:listSessions'),
  createSession: (req) => ipcRenderer.invoke('ai:createSession', req),
  updateSession: (sessionId, patch) => ipcRenderer.invoke('ai:updateSession', sessionId, patch),
  deleteSession: (sessionId) => ipcRenderer.invoke('ai:deleteSession', sessionId),
  forkSession: (sessionId, upToTurnIndex) => ipcRenderer.invoke('ai:forkSession', sessionId, upToTurnIndex),
  getSessionDetail: (sessionId) => ipcRenderer.invoke('ai:getSessionDetail', sessionId),
  switchProvider: (sessionId, targetProvider, model) => ipcRenderer.invoke('ai:switchProvider', sessionId, targetProvider, model),
  updateMemory: (sessionId, patch) => ipcRenderer.invoke('ai:updateMemory', sessionId, patch),
  compactMemory: (sessionId) => ipcRenderer.invoke('ai:compactMemory', sessionId),
  sendPrompt: (req) => ipcRenderer.invoke('ai:sendPrompt', req),
  stopRun: (sessionId) => ipcRenderer.invoke('ai:stopRun', sessionId),
  importClaudeTranscript: (sessionId) => ipcRenderer.invoke('ai:importClaudeTranscript', sessionId),
  getUsageSummary: () => ipcRenderer.invoke('ai:usageSummary'),

  searchWorkspaceFiles: (dir, query) => ipcRenderer.invoke('context:searchFiles', dir, query),
  saveClipboardImage: (sessionId, base64DataUrl) => ipcRenderer.invoke('context:saveClipboardImage', sessionId, base64DataUrl),

  listSkills: (workspacePath) => ipcRenderer.invoke('gov:listSkills', workspacePath),
  saveSkill: (input) => ipcRenderer.invoke('gov:saveSkill', input),
  deleteSkill: (filePath) => ipcRenderer.invoke('gov:deleteSkill', filePath),
  listRuleFiles: (workspacePath) => ipcRenderer.invoke('gov:listRules', workspacePath),
  saveRuleFile: (filePath, content) => ipcRenderer.invoke('gov:saveRule', filePath, content),
  syncAgentsRule: (workspacePath, targets) => ipcRenderer.invoke('gov:syncAgentsRule', workspacePath, targets),
  listMcpServers: (workspacePath) => ipcRenderer.invoke('gov:listMcpServers', workspacePath),
  listPromptTemplates: () => ipcRenderer.invoke('gov:listTemplates'),
  savePromptTemplate: (tpl) => ipcRenderer.invoke('gov:saveTemplate', tpl),
  deletePromptTemplate: (id) => ipcRenderer.invoke('gov:deleteTemplate', id),

  getRepoSummary: (dir) => ipcRenderer.invoke('git:summary', dir),
  getWorkingChanges: (dir) => ipcRenderer.invoke('git:changes', dir),
  getFileDiff: (dir, filePath, staged, code) => ipcRenderer.invoke('git:fileDiff', dir, filePath, staged, code),
  getTurnDiff: (dir, preTreeHash, postTreeHash) => ipcRenderer.invoke('git:turnDiff', dir, preTreeHash, postTreeHash),
  getTurnFileDiff: (dir, preTreeHash, postTreeHash, filePath) => ipcRenderer.invoke('git:turnFileDiff', dir, preTreeHash, postTreeHash, filePath),
  stageFiles: (dir, paths, stage, all) => ipcRenderer.invoke('git:stage', dir, paths, stage, all),
  commitChanges: (dir, message) => ipcRenderer.invoke('git:commit', dir, message),
  revertWorkingFile: (dir, change) => ipcRenderer.invoke('git:revertFile', dir, change),
  restoreTurnCheckpoint: (sessionId, turnId) => ipcRenderer.invoke('git:restoreTurn', sessionId, turnId),
  restoreFileFromTurn: (sessionId, turnId, filePath) => ipcRenderer.invoke('git:restoreTurnFile', sessionId, turnId, filePath),
  listBranches: (dir) => ipcRenderer.invoke('git:branches', dir),
  getCommitGraph: (dir, count) => ipcRenderer.invoke('git:graph', dir, count),
  getCommitDetail: (dir, hash) => ipcRenderer.invoke('git:commitDetail', dir, hash),
  getCommitFileDiff: (dir, hash, filePath) => ipcRenderer.invoke('git:commitFileDiff', dir, hash, filePath),
  switchBranch: (dir, name, isRemote) => ipcRenderer.invoke('git:switchBranch', dir, name, isRemote),
  createFlowBranch: (dir, type, name, carry) => ipcRenderer.invoke('git:createFlowBranch', dir, type, name, carry),
  pushBranchForMr: (dir) => ipcRenderer.invoke('git:pushForMr', dir),
  listWorktrees: (dir) => ipcRenderer.invoke('git:listWorktrees', dir),
  removeWorktree: (repoRoot, worktreePath, deleteBranch) => ipcRenderer.invoke('git:removeWorktree', repoRoot, worktreePath, deleteBranch),
  mergeWorktreeToCurrent: (repoRoot, worktreeBranch) => ipcRenderer.invoke('git:mergeWorktree', repoRoot, worktreeBranch),

  createPty: (opts) => ipcRenderer.invoke('pty:create', opts),
  writePty: (ptyId, data) => ipcRenderer.send('pty:write', ptyId, data),
  resizePty: (ptyId, cols, rows) => ipcRenderer.send('pty:resize', ptyId, cols, rows),
  killPty: (ptyId) => ipcRenderer.invoke('pty:kill', ptyId),
  openInteractiveSessionPty: (sessionId) => ipcRenderer.invoke('pty:openInteractiveSession', sessionId),

  onAiEvent: (cb) => subscribe<AiStreamPushEvent>('ai:event', cb),
  onAiSessionStatus: (cb) => subscribe<AiSessionStatusPush>('ai:status', cb),
  onPtyData: (cb) => subscribe<PtyDataPush>('pty:data', cb),
  onPtyExit: (cb) => subscribe<PtyExitPush>('pty:exit', cb)
}

contextBridge.exposeInMainWorld('workspaceApi', api)
