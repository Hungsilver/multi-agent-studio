import type {
  AppsAlertPush,
  AppsBatchAction,
  AppsBatchResult,
  AppsCatalogConfig,
  AppShareInfo,
  AppsScanResult,
  DevAppConfig,
  DevAppRuntime,
  IisSiteInfo
} from './apps'
import type {
  AiAttachment,
  AiSession,
  AiTurn,
  CliStatus,
  CompactContextResult,
  EffortLevel,
  NormalizedAgentEvent,
  OrchestratorConfig,
  PermissionMode,
  ProviderId,
  ProviderQuotaStatus,
  ProviderSyncState,
  SessionMemory,
  UsageSummary
} from './ai'
import type {
  BranchInfo,
  CommitDetail,
  CommitNode,
  DiffResult,
  FileChange,
  GitActionResult,
  GitGraphQuery,
  GitMergeResult,
  HunkAction,
  MergeConflictFile,
  MergeWorktreeResult,
  RepoOperationState,
  RepoSummary,
  ResetMode,
  StashEntry,
  WorktreeInfo
} from './git'
import type { McpServerInfo, PromptTemplate, RuleFile, SkillItem } from './governance'
import type {
  AppSettings,
  AppUpdateInfo,
  AppVersionInfo,
  FileTreeEntry,
  PtyCreateOptions,
  PtySessionInfo,
  WorkspaceFileContent,
  WorkspaceRecord
} from './workspace'

export interface SendPromptRequest {
  sessionId: string
  prompt: string
  provider?: ProviderId
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  attachments?: AiAttachment[]
  orchestrator?: OrchestratorConfig
}

export interface CreateSessionRequest {
  workspacePath: string
  provider: ProviderId
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  title?: string
  useWorktree?: boolean
  worktreeBranchName?: string
}

export interface AiStreamPushEvent {
  sessionId: string
  turnId: string
  event: NormalizedAgentEvent
}

export interface AiSessionStatusPush {
  sessionId: string
  status: 'idle' | 'running' | 'error'
}

export interface PtyDataPush {
  ptyId: string
  data: string
}

export interface PtyExitPush {
  ptyId: string
  exitCode: number
}

export interface WorkspaceApi {
  // Window controls
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  pickFolder: () => Promise<string | null>
  openInExplorer: (targetPath: string) => Promise<void>
  openInVsCode: (targetPath: string) => Promise<void>
  openExternalUrl: (url: string) => Promise<void>

  // Settings & Workspaces
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  listWorkspaces: () => Promise<WorkspaceRecord[]>
  addWorkspace: (folderPath: string) => Promise<WorkspaceRecord>
  removeWorkspace: (workspaceId: string) => Promise<void>

  // CLI Diagnostics
  getCliStatuses: (forceRefresh?: boolean) => Promise<CliStatus[]>
  installOrUpdateCli: (provider: ProviderId) => Promise<{ ptyId: string; command: string }>

  // App Version & Updates
  getAppVersion: () => Promise<AppVersionInfo>
  checkAppUpdate: () => Promise<AppUpdateInfo>
  runSourceUpdate: () => Promise<{ ptyId: string }>

  // AI Sessions & Orchestrator
  listSessions: () => Promise<AiSession[]>
  createSession: (req: CreateSessionRequest) => Promise<AiSession>
  updateSession: (sessionId: string, patch: Partial<Pick<AiSession, 'title' | 'provider' | 'model' | 'effort' | 'permissionMode' | 'pinned'>>) => Promise<AiSession>
  deleteSession: (sessionId: string) => Promise<void>
  forkSession: (sessionId: string, upToTurnIndex?: number) => Promise<AiSession>
  getSessionDetail: (sessionId: string) => Promise<{
    session: AiSession
    turns: AiTurn[]
    memory: SessionMemory
    providerStates: ProviderSyncState[]
  }>
  switchProvider: (sessionId: string, targetProvider: ProviderId, model?: string) => Promise<{
    session: AiSession
    providerStates: ProviderSyncState[]
    unsyncedTurnsCount: number
  }>
  updateMemory: (sessionId: string, patch: Partial<Omit<SessionMemory, 'sessionId' | 'updatedAt'>>) => Promise<SessionMemory>
  compactMemory: (sessionId: string) => Promise<SessionMemory>
  compactSessionContext: (sessionId: string) => Promise<CompactContextResult>
  sendPrompt: (req: SendPromptRequest) => Promise<{ turnId: string }>
  stopRun: (sessionId: string) => Promise<void>
  importClaudeTranscript: (sessionId: string) => Promise<AiTurn[]>
  getUsageSummary: () => Promise<UsageSummary>
  getProviderQuotas: (forceRefresh?: boolean, agyReferenceCap5h?: number) => Promise<ProviderQuotaStatus[]>

  // Context & Attachments
  searchWorkspaceFiles: (dir: string, query: string) => Promise<string[]>
  saveClipboardImage: (sessionId: string, base64DataUrl: string) => Promise<AiAttachment>
  listWorkspaceDir: (rootDir: string, relDir?: string) => Promise<FileTreeEntry[]>
  readWorkspaceFile: (rootDir: string, relPath: string) => Promise<WorkspaceFileContent>
  readExternalFile: (absPath: string) => Promise<WorkspaceFileContent>
  writeWorkspaceFile: (rootDir: string, relPath: string, content: string) => Promise<{ relPath: string; size: number; updatedAt: string }>

  // Governance: Skills, Rules (AGENTS.md), MCP, Prompt Templates
  listSkills: (workspacePath?: string) => Promise<SkillItem[]>
  saveSkill: (input: {
    workspacePath?: string
    scope: 'workspace' | 'global'
    source?: 'claude' | 'agents' | 'gemini' | 'app'
    name: string
    description: string
    tags: string[]
    body: string
    existingFilePath?: string
  }) => Promise<SkillItem>
  deleteSkill: (filePath: string) => Promise<void>
  listRuleFiles: (workspacePath?: string) => Promise<RuleFile[]>
  saveRuleFile: (filePath: string, content: string) => Promise<RuleFile>
  syncAgentsRule: (workspacePath: string, targets: Array<'CLAUDE.md' | 'GEMINI.md'>) => Promise<RuleFile[]>
  listMcpServers: (workspacePath?: string) => Promise<McpServerInfo[]>
  listPromptTemplates: () => Promise<PromptTemplate[]>
  savePromptTemplate: (tpl: PromptTemplate) => Promise<PromptTemplate>
  deletePromptTemplate: (id: string) => Promise<void>

  // Git, Checkpoints & Worktrees
  getRepoSummary: (dir: string) => Promise<RepoSummary>
  getWorkingChanges: (dir: string) => Promise<FileChange[]>
  getFileDiff: (dir: string, filePath: string, staged: boolean, code: string) => Promise<DiffResult>
  getTurnDiff: (dir: string, preTreeHash: string, postTreeHash?: string | null) => Promise<FileChange[]>
  getTurnFileDiff: (dir: string, preTreeHash: string, postTreeHash: string | null, filePath: string) => Promise<DiffResult>
  stageFiles: (dir: string, paths: string[], stage: boolean, all?: boolean) => Promise<void>
  commitChanges: (dir: string, message: string, options?: { amend?: boolean }) => Promise<string>
  getLastCommitMessage: (dir: string) => Promise<string>
  revertWorkingFile: (dir: string, change: FileChange) => Promise<void>
  applyHunkPatch: (dir: string, filePath: string, staged: boolean, action: HunkAction, hunkIndex: number) => Promise<void>
  restoreTurnCheckpoint: (sessionId: string, turnId: string) => Promise<void>
  restoreFileFromTurn: (sessionId: string, turnId: string, filePath: string) => Promise<void>
  listBranches: (dir: string) => Promise<BranchInfo[]>
  getCommitGraph: (dir: string, countOrQuery?: number | GitGraphQuery) => Promise<CommitNode[]>
  getCommitDetail: (dir: string, hash: string) => Promise<CommitDetail>
  getCommitFileDiff: (dir: string, hash: string, filePath: string) => Promise<DiffResult>
  switchBranch: (dir: string, name: string, isRemote: boolean) => Promise<string>
  createFlowBranch: (dir: string, type: 'feature' | 'fix' | 'bugfix' | 'hotfix', name: string, carry: boolean) => Promise<string>
  pushBranchForMr: (dir: string) => Promise<{ message: string; mrUrl: string | null }>
  getRepoOperationState: (dir: string) => Promise<RepoOperationState>
  fetchAllRemotes: (dir: string, prune?: boolean) => Promise<string>
  pullCurrentBranch: (dir: string, options?: { rebase?: boolean }) => Promise<GitActionResult>
  pushCurrentBranch: (dir: string, options?: { forceWithLease?: boolean; pushTags?: boolean }) => Promise<string>
  createGitBranch: (dir: string, name: string, options?: { startPoint?: string; checkout?: boolean }) => Promise<string>
  renameGitBranch: (dir: string, oldName: string, newName: string) => Promise<string>
  deleteGitBranch: (dir: string, name: string, force?: boolean) => Promise<string>
  mergeGitBranch: (dir: string, sourceRef: string, options?: { noFastForward?: boolean }) => Promise<GitMergeResult>
  rebaseGitBranch: (dir: string, targetRef: string) => Promise<GitActionResult>
  continueOrAbortGitOp: (dir: string, op: 'merge' | 'rebase' | 'cherry-pick' | 'revert', action: 'continue' | 'abort') => Promise<GitActionResult>
  listGitStashes: (dir: string) => Promise<StashEntry[]>
  saveGitStash: (dir: string, message?: string, includeUntracked?: boolean) => Promise<string>
  applyOrPopGitStash: (dir: string, stashRef: string, pop: boolean) => Promise<GitActionResult>
  dropGitStash: (dir: string, stashRef: string) => Promise<string>
  getGitStashDiff: (dir: string, stashRef: string) => Promise<string>
  createGitTag: (dir: string, name: string, target?: string, message?: string) => Promise<string>
  deleteGitTag: (dir: string, name: string) => Promise<string>
  cherryPickGitCommit: (dir: string, hash: string) => Promise<GitActionResult>
  revertGitCommit: (dir: string, hash: string) => Promise<GitActionResult>
  resetGitToCommit: (dir: string, hash: string, mode: ResetMode) => Promise<string>
  checkoutGitCommit: (dir: string, hash: string) => Promise<string>
  listWorktrees: (dir: string) => Promise<WorktreeInfo[]>
  removeWorktree: (repoRoot: string, worktreePath: string, deleteBranch?: boolean, force?: boolean) => Promise<void>
  mergeWorktreeToCurrent: (repoRoot: string, worktreeBranch: string) => Promise<string>
  prepareAndMergeWorktree: (
    repoRoot: string,
    worktreePath: string,
    worktreeBranch: string,
    options?: { autoCommitWorktree?: boolean; autoCommitMain?: boolean; commitMessage?: string }
  ) => Promise<MergeWorktreeResult>
  getMergeConflictStatus: (repoRoot: string) => Promise<{ inProgress: boolean; conflicts: MergeConflictFile[] }>
  resolveMergeConflictFile: (
    repoRoot: string,
    filePath: string,
    strategy: 'ours' | 'theirs' | 'custom',
    customContent?: string
  ) => Promise<{ remaining: MergeConflictFile[] }>
  finalizeWorktreeMerge: (repoRoot: string, action: 'complete' | 'abort', commitMessage?: string) => Promise<string>

  // Embedded Terminal (ConPTY)
  createPty: (opts: PtyCreateOptions) => Promise<PtySessionInfo>
  writePty: (ptyId: string, data: string) => void
  resizePty: (ptyId: string, cols: number, rows: number) => void
  killPty: (ptyId: string) => Promise<void>
  openInteractiveSessionPty: (sessionId: string) => Promise<PtySessionInfo>

  // Apps Studio (DevApps, IIS, Health, Tunnels)
  getAppsConfig: () => Promise<AppsCatalogConfig>
  updateAppsConfig: (patch: Partial<Pick<AppsCatalogConfig, 'scanRanges' | 'scanRoots' | 'showStats'>>) => Promise<AppsCatalogConfig>
  scanAppsProjects: (roots?: string[]) => Promise<AppsScanResult>
  listDevApps: (includeStats?: boolean) => Promise<DevAppRuntime[]>
  addDevApp: (input: Omit<DevAppConfig, 'id'> & { id?: string }) => Promise<DevAppConfig>
  updateDevApp: (id: string, patch: Partial<Omit<DevAppConfig, 'id'>>) => Promise<DevAppConfig>
  removeDevApps: (ids: string[], stopRunning?: boolean) => Promise<{ message: string; config: AppsCatalogConfig }>
  restoreDevApps: (ids: string[]) => Promise<{ restoredCount: number; conflicts: Array<{ id: string; name: string }>; config: AppsCatalogConfig }>
  setDevAppsAutoRestart: (ids: string[], on: boolean) => Promise<AppsCatalogConfig>
  runAppsBatch: (action: AppsBatchAction, ids: string[]) => Promise<AppsBatchResult>
  runAppMaintenance: (id: string, task: 'npm-install' | 'dotnet-build', stopFirst?: boolean) => Promise<string>
  getDevAppLog: (id: string, tail?: number) => Promise<string>
  clearDevAppLog: (id: string) => Promise<void>
  saveAppsProfile: (name: string, ids: string[]) => Promise<AppsCatalogConfig>
  removeAppsProfile: (name: string) => Promise<AppsCatalogConfig>
  stopPortOwner: (port: number) => Promise<string>
  isIisInstalled: () => Promise<boolean>
  listIisSites: () => Promise<IisSiteInfo[]>
  addIisApps: (siteNames: string[]) => Promise<{ added: number; updated: number }>
  startAppTunnel: (port: number, name: string) => Promise<string>
  stopAppTunnel: (port: number) => Promise<string>
  getAppShareInfo: (appName: string, group: string, port: number, url?: string) => Promise<AppShareInfo>
  exportAppsCatalogDialog: () => Promise<string | null>
  importAppsCatalogDialog: () => Promise<{ addedApps: number; addedProfiles: number; duplicates: number; missingDirs: number; config: AppsCatalogConfig } | null>

  // Push listeners (unsubscribe functions returned)
  onAiEvent: (cb: (payload: AiStreamPushEvent) => void) => () => void
  onAiSessionStatus: (cb: (payload: AiSessionStatusPush) => void) => () => void
  onPtyData: (cb: (payload: PtyDataPush) => void) => () => void
  onPtyExit: (cb: (payload: PtyExitPush) => void) => () => void
  onAppsAlert: (cb: (payload: AppsAlertPush) => void) => () => void
}
