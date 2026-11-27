import { create } from 'zustand'
import type {
  BranchInfo,
  CommitDetail,
  CommitNode,
  DiffResult,
  FileChange,
  GitGraphQuery,
  RepoOperationState,
  RepoSummary,
  StashEntry,
  WorktreeInfo
} from '@shared/types/git'

export function normalizeGitDirKey(dir: string): string {
  return dir.replace(/[\\/]+$/, '').toLowerCase()
}

interface GitState {
  currentDir: string
  summary: RepoSummary | null
  summaryByDir: Record<string, RepoSummary>
  changes: FileChange[]
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  stashes: StashEntry[]
  opState: RepoOperationState | null
  commits: CommitNode[]
  graphQuery: GitGraphQuery
  selectedCommit: CommitNode | null
  commitDetail: CommitDetail | null
  commitFileDiff: DiffResult | null
  selectedStashDiff: { ref: string; diff: string } | null
  activeDiff: DiffResult | null
  selectedFile: FileChange | null
  loading: boolean

  ensureSummaryForDir: (dir: string) => Promise<void>
  refreshWorking: (dir: string) => Promise<void>
  refreshFullRepo: (dir: string, queryOverride?: GitGraphQuery) => Promise<void>
  setGraphQuery: (dir: string, patch: Partial<GitGraphQuery>) => Promise<void>
  selectCommit: (dir: string, commit: CommitNode | null) => Promise<void>
  openCommitFileDiff: (dir: string, hash: string, filePath: string) => Promise<void>
  openStashDiff: (dir: string, ref: string) => Promise<void>
  clearStashDiff: () => void
  openWorkingDiff: (dir: string, change: FileChange) => Promise<void>
  openTurnFileDiff: (dir: string, preTreeHash: string, postTreeHash: string | null, filePath: string) => Promise<void>
  clearDiff: () => void
}

const DEFAULT_GRAPH_QUERY: GitGraphQuery = {
  count: 150,
  branch: '__all__',
  search: '',
  author: '',
  filePath: '',
  firstParent: false
}

let repoReqSeq = 0
let commitReqSeq = 0
let fileDiffReqSeq = 0

export const useGitStore = create<GitState>((set, get) => ({
  currentDir: '',
  summary: null,
  summaryByDir: {},
  changes: [],
  branches: [],
  worktrees: [],
  stashes: [],
  opState: null,
  commits: [],
  graphQuery: { ...DEFAULT_GRAPH_QUERY },
  selectedCommit: null,
  commitDetail: null,
  commitFileDiff: null,
  selectedStashDiff: null,
  activeDiff: null,
  selectedFile: null,
  loading: false,

  ensureSummaryForDir: async (dir) => {
    if (!dir) return
    const key = normalizeGitDirKey(dir)
    const summary = await window.workspaceApi.getRepoSummary(dir)
    set((s) => ({
      summaryByDir: { ...s.summaryByDir, [key]: summary },
      ...(normalizeGitDirKey(s.currentDir) === key ? { summary } : {})
    }))
  },

  refreshWorking: async (dir) => {
    if (!dir) return
    const key = normalizeGitDirKey(dir)
    const [summary, changes, opState] = await Promise.all([
      window.workspaceApi.getRepoSummary(dir),
      window.workspaceApi.getWorkingChanges(dir),
      window.workspaceApi.getRepoOperationState(dir)
    ])
    set((s) => ({
      currentDir: dir,
      summary,
      summaryByDir: { ...s.summaryByDir, [key]: summary },
      changes,
      opState
    }))
  },

  refreshFullRepo: async (dir, queryOverride) => {
    if (!dir) return
    const seq = ++repoReqSeq
    const key = normalizeGitDirKey(dir)
    const dirChanged = key !== normalizeGitDirKey(get().currentDir)
    const nextQuery = queryOverride ?? (dirChanged ? { ...DEFAULT_GRAPH_QUERY } : get().graphQuery)

    set({
      loading: true,
      currentDir: dir,
      graphQuery: nextQuery,
      ...(dirChanged
        ? {
            selectedFile: null,
            activeDiff: null,
            selectedCommit: null,
            commitDetail: null,
            commitFileDiff: null,
            selectedStashDiff: null
          }
        : {})
    })
    try {
      const [summary, changes, branches, worktrees, stashes, opState, commits] = await Promise.all([
        window.workspaceApi.getRepoSummary(dir),
        window.workspaceApi.getWorkingChanges(dir),
        window.workspaceApi.listBranches(dir),
        window.workspaceApi.listWorktrees(dir),
        window.workspaceApi.listGitStashes(dir),
        window.workspaceApi.getRepoOperationState(dir),
        window.workspaceApi.getCommitGraph(dir, nextQuery)
      ])
      if (seq !== repoReqSeq || normalizeGitDirKey(get().currentDir) !== key) return

      const prevSel = dirChanged ? null : get().selectedCommit
      const stillExists = prevSel ? commits.find((c) => c.hash === prevSel.hash) ?? null : null
      const prevFile = dirChanged ? null : get().selectedFile
      const nextFile =
        (prevFile ? changes.find((c) => c.path === prevFile.path && c.staged === prevFile.staged) : null) ??
        changes[0] ??
        null
      const nextActiveDiff = nextFile
        ? await window.workspaceApi.getFileDiff(dir, nextFile.path, nextFile.staged, nextFile.code)
        : null
      if (seq !== repoReqSeq || normalizeGitDirKey(get().currentDir) !== key) return

      set((s) => ({
        summary,
        summaryByDir: { ...s.summaryByDir, [key]: summary },
        changes,
        branches,
        worktrees,
        stashes,
        opState,
        commits,
        selectedCommit: stillExists,
        ...(stillExists ? {} : { commitDetail: null, commitFileDiff: null }),
        selectedFile: nextFile,
        activeDiff: nextActiveDiff,
        loading: false
      }))
    } catch {
      if (seq === repoReqSeq) {
        set({ loading: false })
      }
    }
  },

  setGraphQuery: async (dir, patch) => {
    const nextQuery: GitGraphQuery = { ...get().graphQuery, ...patch }
    set({ graphQuery: nextQuery })
    if (!dir) return
    const seq = ++repoReqSeq
    const key = normalizeGitDirKey(dir)
    const commits = await window.workspaceApi.getCommitGraph(dir, nextQuery)
    if (seq !== repoReqSeq || normalizeGitDirKey(get().currentDir) !== key) return
    set({ commits })
  },

  selectCommit: async (dir, commit) => {
    const seq = ++commitReqSeq
    if (!commit) {
      set({ selectedCommit: null, commitDetail: null, commitFileDiff: null })
      return
    }
    const key = normalizeGitDirKey(dir)
    set({ selectedCommit: commit, selectedStashDiff: null, commitDetail: null, commitFileDiff: null })
    const detail = await window.workspaceApi.getCommitDetail(dir, commit.hash)
    if (seq !== commitReqSeq || normalizeGitDirKey(get().currentDir) !== key) return
    set({ commitDetail: detail })
    if (detail.files.length > 0) {
      const firstFile = detail.files[0].path
      const diff = await window.workspaceApi.getCommitFileDiff(dir, commit.hash, firstFile)
      if (seq !== commitReqSeq || normalizeGitDirKey(get().currentDir) !== key) return
      set({ commitFileDiff: diff })
    }
  },

  openCommitFileDiff: async (dir, hash, filePath) => {
    const seq = ++commitReqSeq
    const key = normalizeGitDirKey(dir)
    const diff = await window.workspaceApi.getCommitFileDiff(dir, hash, filePath)
    if (seq !== commitReqSeq || normalizeGitDirKey(get().currentDir) !== key) return
    set({ commitFileDiff: diff })
  },

  openStashDiff: async (dir, ref) => {
    const key = normalizeGitDirKey(dir)
    set({
      selectedStashDiff: { ref, diff: 'Đang tải nội dung patch Stash…' },
      selectedCommit: null,
      commitDetail: null,
      commitFileDiff: null
    })
    const diff = await window.workspaceApi.getGitStashDiff(dir, ref)
    if (normalizeGitDirKey(get().currentDir) === key && get().selectedStashDiff?.ref === ref) {
      set({ selectedStashDiff: { ref, diff } })
    }
  },

  clearStashDiff: () => set({ selectedStashDiff: null }),

  openWorkingDiff: async (dir, change) => {
    const seq = ++fileDiffReqSeq
    const key = normalizeGitDirKey(dir)
    const diff = await window.workspaceApi.getFileDiff(dir, change.path, change.staged, change.code)
    if (seq !== fileDiffReqSeq || normalizeGitDirKey(get().currentDir) !== key) return
    set({ activeDiff: diff, selectedFile: change })
  },

  openTurnFileDiff: async (dir, preTreeHash, postTreeHash, filePath) => {
    const diff = await window.workspaceApi.getTurnFileDiff(dir, preTreeHash, postTreeHash, filePath)
    set({ activeDiff: diff, selectedFile: { path: filePath, code: 'M', staged: false } })
  },

  clearDiff: () => set({ activeDiff: null, selectedFile: null })
}))
