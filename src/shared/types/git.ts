export interface RepoSummary {
  isRepo: boolean
  root: string
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  addedLines: number
  deletedLines: number
  untrackedCount: number
  dirtyCount: number
}

export interface FileChange {
  path: string
  oldPath?: string
  code: string // M, A, D, R, ?, U
  staged: boolean
  additions?: number
  deletions?: number
}

export interface DiffResult {
  path: string
  original: string
  modified: string
  unifiedDiff: string
  isBinary: boolean
}

export interface TurnCheckpoint {
  turnId: string
  sessionId: string
  turnIndex: number
  preTreeHash: string
  postTreeHash: string | null
  createdAt: string
  changedFiles: string[]
}

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isMain: boolean
  locked: boolean
}

export interface BranchInfo {
  kind: 'local' | 'remote' | 'tag'
  name: string
  current: boolean
  upstream: string
  track: string
}

export interface GraphSegment {
  kind: 0 | 1 | 2 // 0=pass-through, 1=top-in, 2=bottom-out
  fromCol: number
  toCol: number
  colorIndex: number
}

export interface CommitNode {
  hash: string
  shortHash: string
  author: string
  date: string
  refs: string
  subject: string
  isMerge: boolean
  col: number
  colorIndex: number
  lanes: number
  segments: GraphSegment[]
}

export interface CommitDetail {
  hash: string
  info: string
  files: Array<{ code: string; path: string; oldPath?: string }>
}

export interface MergeConflictFile {
  filePath: string
  oursContent: string
  theirsContent: string
  mergedContent: string
}

export interface MergeWorktreeResult {
  status: 'merged' | 'conflict' | 'main-dirty'
  message: string
  repoRoot: string
  sourceBranch: string
  targetBranch: string
  conflicts: MergeConflictFile[]
  dirtyFiles?: string[]
}

export interface StashEntry {
  ref: string
  index: number
  branch: string
  message: string
  date: string
}

export interface RepoOperationState {
  state: 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'
  headBranch: string
  incomingRef?: string
  conflictCount: number
}

export interface GitGraphQuery {
  count?: number
  branch?: string
  search?: string
  author?: string
  filePath?: string
  firstParent?: boolean
}

export type HunkAction = 'stage' | 'unstage' | 'discard'

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface GitMergeResult {
  status: 'merged' | 'conflict' | 'up-to-date'
  message: string
  conflicts: MergeConflictFile[]
}

export interface GitActionResult {
  ok: boolean
  message: string
  conflicts?: MergeConflictFile[]
}
