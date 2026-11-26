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
