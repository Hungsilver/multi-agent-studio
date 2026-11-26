import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGitChecked } from '../src/main/git/git-runner'
import {
  createIsolatedWorktree,
  listWorktrees,
  mergeWorktreeBranch,
  removeWorktree
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

    // .pegasus-worktrees must not appear as untracked in main repo
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
})
