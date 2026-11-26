import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureCheckpoint, restoreCheckpoint, restoreFileFromCheckpoint } from '../src/main/git/checkpoint-service'
import { runGitChecked } from '../src/main/git/git-runner'

const tempRepos: string[] = []

async function createTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-repo-'))
  tempRepos.push(dir)
  await runGitChecked(dir, ['init'])
  await runGitChecked(dir, ['config', 'user.email', 'test@example.com'])
  await runGitChecked(dir, ['config', 'user.name', 'Test User'])
  fs.writeFileSync(path.join(dir, 'app.ts'), 'export const v = 1\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'keep.ts'), 'export const keep = true\n', 'utf8')
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

describe('Git Turn Checkpoint Service', () => {
  it('captures write-tree snapshot without polluting git stash and restores full turn & single file', async () => {
    const repo = await createTempRepo()

    // Pre-existing uncommitted edit before turn
    fs.writeFileSync(path.join(repo, 'keep.ts'), 'export const keep = "before-turn"\n', 'utf8')
    const snap = await captureCheckpoint(repo)
    expect(snap.treeHash).toMatch(/^[0-9a-f]{40}$/)

    // Git stash list must remain empty
    const stashes = await runGitChecked(repo, ['stash', 'list'])
    expect(stashes.trim()).toBe('')

    // Simulate AI edits + creating a new untracked file
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const v = 999\n', 'utf8')
    fs.writeFileSync(path.join(repo, 'keep.ts'), 'export const keep = "ai-ruined"\n', 'utf8')
    fs.writeFileSync(path.join(repo, 'ai-new.ts'), 'export const createdByAi = true\n', 'utf8')

    // Restore single file first
    await restoreFileFromCheckpoint(repo, snap.treeHash!, 'app.ts')
    expect(fs.readFileSync(path.join(repo, 'app.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe('export const v = 1\n')
    expect(fs.existsSync(path.join(repo, 'ai-new.ts'))).toBe(true)

    // Restore entire turn checkpoint
    await restoreCheckpoint(repo, snap.treeHash!)
    expect(fs.readFileSync(path.join(repo, 'keep.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe('export const keep = "before-turn"\n')
    expect(fs.existsSync(path.join(repo, 'ai-new.ts'))).toBe(false)
  })
})
