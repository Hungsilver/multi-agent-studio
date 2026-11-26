import type {
  AiAttachment,
  AiSession,
  AiTurn,
  CliStatus,
  EffortLevel,
  NormalizedAgentEvent,
  PermissionMode,
  ProviderId,
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
  RepoSummary,
  WorktreeInfo
} from './git'
import type { McpServerInfo, PromptTemplate, RuleFile, SkillItem } from './governance'
import type {
  AppSettings,
  AppUpdateInfo,
  AppVersionInfo,
  LegacyImportResult,
  PtyCreateOptions,
  PtySessionInfo,
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
  importLegacyConfig: () => Promise<LegacyImportResult>

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
  sendPrompt: (req: SendPromptRequest) => Promise<{ turnId: string }>
  stopRun: (sessionId: string) => Promise<void>
  importClaudeTranscript: (sessionId: string) => Promise<AiTurn[]>
  getUsageSummary: () => Promise<UsageSummary>

  // Context & Attachments
  searchWorkspaceFiles: (dir: string, query: string) => Promise<string[]>
  saveClipboardImage: (sessionId: string, base64DataUrl: string) => Promise<AiAttachment>

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
  commitChanges: (dir: string, message: string) => Promise<string>
  revertWorkingFile: (dir: string, change: FileChange) => Promise<void>
  restoreTurnCheckpoint: (sessionId: string, turnId: string) => Promise<void>
  restoreFileFromTurn: (sessionId: string, turnId: string, filePath: string) => Promise<void>
  listBranches: (dir: string) => Promise<BranchInfo[]>
  getCommitGraph: (dir: string, count?: number) => Promise<CommitNode[]>
  getCommitDetail: (dir: string, hash: string) => Promise<CommitDetail>
  getCommitFileDiff: (dir: string, hash: string, filePath: string) => Promise<DiffResult>
  switchBranch: (dir: string, name: string, isRemote: boolean) => Promise<string>
  createFlowBranch: (dir: string, type: 'feature' | 'fix' | 'bugfix' | 'hotfix', name: string, carry: boolean) => Promise<string>
  pushBranchForMr: (dir: string) => Promise<{ message: string; mrUrl: string | null }>
  listWorktrees: (dir: string) => Promise<WorktreeInfo[]>
  removeWorktree: (repoRoot: string, worktreePath: string, deleteBranch?: boolean) => Promise<void>
  mergeWorktreeToCurrent: (repoRoot: string, worktreeBranch: string) => Promise<string>

  // Embedded Terminal (ConPTY)
  createPty: (opts: PtyCreateOptions) => Promise<PtySessionInfo>
  writePty: (ptyId: string, data: string) => void
  resizePty: (ptyId: string, cols: number, rows: number) => void
  killPty: (ptyId: string) => Promise<void>
  openInteractiveSessionPty: (sessionId: string) => Promise<PtySessionInfo>

  // Push listeners (unsubscribe functions returned)
  onAiEvent: (cb: (payload: AiStreamPushEvent) => void) => () => void
  onAiSessionStatus: (cb: (payload: AiSessionStatusPush) => void) => () => void
  onPtyData: (cb: (payload: PtyDataPush) => void) => () => void
  onPtyExit: (cb: (payload: PtyExitPush) => void) => () => void
}
