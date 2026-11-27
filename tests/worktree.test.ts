import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGitChecked } from '../src/main/git/git-runner'
import {
  createIsolatedWorktree,
  finalizeWorktreeMerge,
  listWorktrees,
  mergeWorktreeBranch,
  prepareAndMergeWorktree,
  removeWorktree,
  resolveMergeConflictFile
} from '../src/main/git/worktree-service'

const tempRepos: string[] = []

async function createTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'))
  tempRepos.push(dir)
  await runGitChecked(dir, ['init'])
  await runGitChecked(dir, ['config', 'user.email', 'test@example.com'])
  await runGitChecked(dir, ['config', 'user.name', 'Test User'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# Repo\n', 'utf8')
  await runGitChecked(dir, ['add', '-A'])
  await runGitChecked(dir, ['commit', '-m', 'init'])
  return dir
}

afterEach(() => {
  while (tempRepos.length > 0) {
    try {
      fs.rmSync(tempRepos.pop()!, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
    } catch {
      // ignore Windows temp cleanup lock
    }
  }
})

describe('Git Worktree Isolation Service', () => {
  it('creates isolated worktree excluded from git status, merges back, and cleans up', async () => {
    const repo = await createTempRepo()
    const wt = await createIsolatedWorktree(repo, 'feat-ai')

    expect(fs.existsSync(wt.worktreePath)).toBe(true)
    expect(wt.branch).toBe('ai/feat-ai')

    // Worktree directory must not appear as untracked in main repo
    const mainStatus = await runGitChecked(repo, ['status', '--porcelain'])
    expect(mainStatus.trim()).toBe('')

    const list = await listWorktrees(repo)
    expect(list.length).toBe(2)

    // Make commit inside worktree
    fs.writeFileSync(path.join(wt.worktreePath, 'feature.txt'), 'hello from worktree\n', 'utf8')
    await runGitChecked(wt.worktreePath, ['add', '-A'])
    await runGitChecked(wt.worktreePath, ['commit', '-m', 'feat in worktree'])

    // Merge back to main repo
    await mergeWorktreeBranch(repo, wt.branch)
    expect(fs.readFileSync(path.join(repo, 'feature.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('hello from worktree\n')

    // Clean up worktree
    await removeWorktree(repo, wt.worktreePath, true)
    const afterList = await listWorktrees(repo)
    expect(afterList.length).toBe(1)
  })

  it('detects merge conflict between main and worktree, resolves via custom/ours/theirs, and commits merge cleanly', async () => {
    const repo = await createTempRepo()
    fs.writeFileSync(path.join(repo, 'shared.ts'), 'export const mode = "base"\n', 'utf8')
    await runGitChecked(repo, ['add', '-A'])
    await runGitChecked(repo, ['commit', '-m', 'add shared.ts'])

    const wt = await createIsolatedWorktree(repo, 'pane-2')

    // Both panes modify the same line of shared.ts differently without committing yet
    fs.writeFileSync(path.join(repo, 'shared.ts'), 'export const mode = "main-pane-1"\n', 'utf8')
    fs.writeFileSync(path.join(wt.worktreePath, 'shared.ts'), 'export const mode = "worktree-pane-2"\n', 'utf8')

    // First call reports main-dirty unless autoCommitMain is enabled
    const dirtyRes = await prepareAndMergeWorktree(repo, wt.worktreePath, wt.branch, {
      autoCommitWorktree: true,
      autoCommitMain: false
    })
    expect(dirtyRes.status).toBe('main-dirty')
    expect(dirtyRes.dirtyFiles?.some((f) => f.includes('shared.ts'))).toBe(true)

    // Retry with autoCommitMain -> surfaces exact conflict for resolution
    const conflictRes = await prepareAndMergeWorktree(repo, wt.worktreePath, wt.branch, {
      autoCommitWorktree: true,
      autoCommitMain: true
    })
    expect(conflictRes.status).toBe('conflict')
    expect(conflictRes.conflicts).toHaveLength(1)
    expect(conflictRes.conflicts[0].filePath).toBe('shared.ts')
    expect(conflictRes.conflicts[0].oursContent).toContain('main-pane-1')
    expect(conflictRes.conflicts[0].theirsContent).toContain('worktree-pane-2')
    expect(conflictRes.conflicts[0].mergedContent).toContain('<<<<<<<')

    const resolved = await resolveMergeConflictFile(
      repo,
      'shared.ts',
      'custom',
      'export const mode = "merged-both"\n'
    )
    expect(resolved.remaining).toHaveLength(0)

    await finalizeWorktreeMerge(repo, 'complete', 'merge: resolved shared.ts')
    expect(fs.readFileSync(path.join(repo, 'shared.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'export const mode = "merged-both"\n'
    )
  })
})
