import { create } from 'zustand'
import type { BranchInfo, CommitNode, DiffResult, FileChange, RepoSummary, WorktreeInfo } from '@shared/types/git'

interface GitState {
  currentDir: string
  summary: RepoSummary | null
  changes: FileChange[]
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  commits: CommitNode[]
  activeDiff: DiffResult | null
  selectedFile: FileChange | null
  loading: boolean

  refreshWorking: (dir: string) => Promise<void>
  refreshFullRepo: (dir: string) => Promise<void>
  openWorkingDiff: (dir: string, change: FileChange) => Promise<void>
  openTurnFileDiff: (dir: string, preTreeHash: string, postTreeHash: string | null, filePath: string) => Promise<void>
  clearDiff: () => void
}

export const useGitStore = create<GitState>((set) => ({
  currentDir: '',
  summary: null,
  changes: [],
  branches: [],
  worktrees: [],
  commits: [],
  activeDiff: null,
  selectedFile: null,
  loading: false,

  refreshWorking: async (dir) => {
    if (!dir) return
    const [summary, changes] = await Promise.all([
      window.workspaceApi.getRepoSummary(dir),
      window.workspaceApi.getWorkingChanges(dir)
    ])
    set({ currentDir: dir, summary, changes })
  },

  refreshFullRepo: async (dir) => {
    if (!dir) return
    set({ loading: true, currentDir: dir })
    try {
      const [summary, changes, branches, worktrees, commits] = await Promise.all([
        window.workspaceApi.getRepoSummary(dir),
        window.workspaceApi.getWorkingChanges(dir),
        window.workspaceApi.listBranches(dir),
        window.workspaceApi.listWorktrees(dir),
        window.workspaceApi.getCommitGraph(dir, 150)
      ])
      set({ summary, changes, branches, worktrees, commits, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  openWorkingDiff: async (dir, change) => {
    const diff = await window.workspaceApi.getFileDiff(dir, change.path, change.staged, change.code)
    set({ activeDiff: diff, selectedFile: change })
  },

  openTurnFileDiff: async (dir, preTreeHash, postTreeHash, filePath) => {
    const diff = await window.workspaceApi.getTurnFileDiff(dir, preTreeHash, postTreeHash, filePath)
    set({ activeDiff: diff, selectedFile: { path: filePath, code: 'M', staged: false } })
  },

  clearDiff: () => set({ activeDiff: null, selectedFile: null })
}))
