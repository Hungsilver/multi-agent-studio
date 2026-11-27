import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commitChanges, getFileDiff, getLastCommitMessage, getRepoSummary, stageFiles } from '../src/main/git/diff-service'
import {
  applyHunkPatch,
  applyOrPopStash,
  assertValidCommitHash,
  assertValidRefName,
  assertValidStashRef,
  checkoutCommit,
  cherryPickCommit,
  continueOrAbortOperation,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  dropStash,
  getRepoOperationState,
  getStashDiff,
  listStashes,
  mergeBranchIntoCurrent,
  rebaseCurrentOnto,
  renameBranch,
  resetToCommit,
  revertCommit,
  saveStash
} from '../src/main/git/git-ops-service'
import { runGitChecked } from '../src/main/git/git-runner'
import { getCommitGraph } from '../src/main/git/graph-service'
import { finalizeWorktreeMerge, getMergeConflictStatus, resolveMergeConflictFile } from '../src/main/git/worktree-service'
import { buildSingleHunkPatch, parseUnifiedDiff } from '../src/shared/utils/diff-hunks'

const tempRepos: string[] = []

async function createTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ops-repo-'))
  tempRepos.push(dir)
  await runGitChecked(dir, ['init'])
  await runGitChecked(dir, ['config', 'user.email', 'test@example.com'])
  await runGitChecked(dir, ['config', 'user.name', 'Test User'])
  const lines = Array.from({ length: 24 }, (_, idx) => `line-${idx + 1}`)
  fs.writeFileSync(path.join(dir, 'app.txt'), `${lines.join('\n')}\n`, 'utf8')
  await runGitChecked(dir, ['add', '-A'])
  await runGitChecked(dir, ['commit', '-m', 'init commit'])
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

describe('SourceTree Git Studio Operations', () => {
  it('counts upstream added, modified, deleted and renamed files with a clean local working tree', async () => {
    const repo = await createTempRepo()
    const originalBranch = (await runGitChecked(repo, ['branch', '--show-current'])).trim()
    fs.writeFileSync(path.join(repo, 'existing.txt'), 'Original contents\n')
    fs.writeFileSync(path.join(repo, 'old-name.txt'), 'Renamed contents\n')
    await runGitChecked(repo, ['add', 'existing.txt', 'old-name.txt'])
    await runGitChecked(repo, ['commit', '-m', 'Extra base files'])
    await runGitChecked(repo, ['switch', '-c', 'published'])
    await runGitChecked(repo, ['rm', 'app.txt'])
    await runGitChecked(repo, ['mv', 'old-name.txt', 'new-name.txt'])
    fs.appendFileSync(path.join(repo, 'existing.txt'), 'Edited upstream\n')
    fs.writeFileSync(path.join(repo, 'incoming.txt'), 'New upstream file\n')
    await runGitChecked(repo, ['add', 'incoming.txt', 'existing.txt'])
    await runGitChecked(repo, ['commit', '-m', 'Replace file upstream'])
    await runGitChecked(repo, ['switch', originalBranch])
    fs.writeFileSync(path.join(repo, 'local.txt'), 'Local commit only\n')
    await runGitChecked(repo, ['add', 'local.txt'])
    await runGitChecked(repo, ['commit', '-m', 'Local commit'])
    await runGitChecked(repo, ['remote', 'add', 'origin', '.'])
    await runGitChecked(repo, ['update-ref', 'refs/remotes/origin/main', 'published'])
    await runGitChecked(repo, ['branch', '--set-upstream-to=origin/main'])

    expect(await getRepoSummary(repo, true)).toMatchObject({
      ahead: 1,
      behind: 1,
      dirtyCount: 0,
      incomingChanges: { files: 4, added: 1, modified: 1, deleted: 1, renamed: 1 }
    })
  })

  it('validates ref names, commit hashes, and stash refs strictly', () => {
    expect(assertValidRefName('feat/new-ui')).toBe('feat/new-ui')
    expect(() => assertValidRefName('-rf')).toThrow()
    expect(() => assertValidRefName('foo..bar')).toThrow()
    expect(() => assertValidRefName('bad name')).toThrow()

    expect(assertValidCommitHash('abc1234')).toBe('abc1234')
    expect(() => assertValidCommitHash('abc')).toThrow()
    expect(() => assertValidCommitHash('xyz1234')).toThrow()

    expect(assertValidStashRef('stash@{0}')).toBe('stash@{0}')
    expect(() => assertValidStashRef('stash@{bad}')).toThrow()
  })

  it('parses multi-hunk diffs and stages, unstages, and discards individual hunks', async () => {
    const repo = await createTempRepo()
    const filePath = path.join(repo, 'app.txt')
    const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n')
    lines[1] = 'line-2-TOP-EDIT'
    lines[22] = 'line-23-BOTTOM-EDIT'
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')

    const unstagedDiff = await getFileDiff(repo, 'app.txt', false, 'M')
    const parsed = parseUnifiedDiff(unstagedDiff.unifiedDiff)
    expect(parsed.hunks.length).toBe(2)

    const singlePatch = buildSingleHunkPatch(parsed, 0)
    expect(singlePatch).toContain('line-2-TOP-EDIT')
    expect(singlePatch).not.toContain('line-23-BOTTOM-EDIT')

    // Stage only hunk #0
    await applyHunkPatch(repo, 'app.txt', false, 'stage', 0)
    const stagedAfterStage = await getFileDiff(repo, 'app.txt', true, 'M')
    expect(stagedAfterStage.unifiedDiff).toContain('line-2-TOP-EDIT')
    expect(stagedAfterStage.unifiedDiff).not.toContain('line-23-BOTTOM-EDIT')

    const unstagedAfterStage = await getFileDiff(repo, 'app.txt', false, 'M')
    expect(unstagedAfterStage.unifiedDiff).not.toContain('line-2-TOP-EDIT')
    expect(unstagedAfterStage.unifiedDiff).toContain('line-23-BOTTOM-EDIT')

    // Unstage hunk #0
    await applyHunkPatch(repo, 'app.txt', true, 'unstage', 0)
    const stagedAfterUnstage = await getFileDiff(repo, 'app.txt', true, 'M')
    expect(stagedAfterUnstage.unifiedDiff.trim()).toBe('')

    // Discard only hunk #1 (bottom edit), preserving hunk #0 (top edit)
    await applyHunkPatch(repo, 'app.txt', false, 'discard', 1)
    const contentAfterDiscard = fs.readFileSync(filePath, 'utf8')
    expect(contentAfterDiscard).toContain('line-2-TOP-EDIT')
    expect(contentAfterDiscard).not.toContain('line-23-BOTTOM-EDIT')
  })

  it('supports amend commits and reading last commit message', async () => {
    const repo = await createTempRepo()
    fs.writeFileSync(path.join(repo, 'note.txt'), 'first\n', 'utf8')
    await stageFiles(repo, ['note.txt'], true, false)
    await commitChanges(repo, 'feat: draft')
    expect(await getLastCommitMessage(repo)).toBe('feat: draft')

    fs.writeFileSync(path.join(repo, 'note.txt'), 'updated\n', 'utf8')
    await stageFiles(repo, ['note.txt'], true, false)
    await commitChanges(repo, 'feat: amended final', { amend: true })

    expect(await getLastCommitMessage(repo)).toBe('feat: amended final')
    const count = (await runGitChecked(repo, ['rev-list', '--count', 'HEAD'])).trim()
    expect(count).toBe('2')
  })

  it('handles branch CRUD, merge conflict detection, and aborting merge state', async () => {
    const repo = await createTempRepo()
    const baseBranch = (await runGitChecked(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

    await createBranch(repo, 'feat/alpha', { checkout: true })
    fs.writeFileSync(path.join(repo, 'app.txt'), 'conflict from alpha\n', 'utf8')
    await stageFiles(repo, ['app.txt'], true, false)
    await commitChanges(repo, 'alpha edit')

    await renameBranch(repo, 'feat/alpha', 'feat/alpha-v2')

    await runGitChecked(repo, ['checkout', baseBranch])
    fs.writeFileSync(path.join(repo, 'app.txt'), 'conflict from main\n', 'utf8')
    await stageFiles(repo, ['app.txt'], true, false)
    await commitChanges(repo, 'main edit')

    const mergeRes = await mergeBranchIntoCurrent(repo, 'feat/alpha-v2', { noFastForward: true })
    expect(mergeRes.status).toBe('conflict')
    expect(mergeRes.conflicts.some((c) => c.filePath === 'app.txt')).toBe(true)

    const opState = await getRepoOperationState(repo)
    expect(opState.state).toBe('merge')
    expect(opState.conflictCount).toBe(1)

    const abortRes = await continueOrAbortOperation(repo, 'merge', 'abort')
    expect(abortRes.ok).toBe(true)
    expect((await getRepoOperationState(repo)).state).toBe('none')

    await deleteBranch(repo, 'feat/alpha-v2', true)
    const branches = await runGitChecked(repo, ['branch'])
    expect(branches).not.toContain('feat/alpha-v2')
  })

  it('manages stashes (including untracked files) and tags', async () => {
    const repo = await createTempRepo()
    fs.writeFileSync(path.join(repo, 'untracked-wip.txt'), 'secret wip\n', 'utf8')

    await saveStash(repo, 'save untracked wip', true)
    expect(fs.existsSync(path.join(repo, 'untracked-wip.txt'))).toBe(false)

    const stashes = await listStashes(repo)
    expect(stashes.length).toBe(1)
    expect(stashes[0].message).toContain('save untracked wip')

    const stashDiff = await getStashDiff(repo, stashes[0].ref)
    expect(stashDiff).toContain('untracked-wip.txt')

    const applied = await applyOrPopStash(repo, stashes[0].ref, false)
    expect(applied.ok).toBe(true)
    expect(fs.existsSync(path.join(repo, 'untracked-wip.txt'))).toBe(true)

    await dropStash(repo, stashes[0].ref)
    expect((await listStashes(repo)).length).toBe(0)

    await createTag(repo, 'v1.2.3', 'HEAD', 'annotated release')
    const tagList = await runGitChecked(repo, ['tag'])
    expect(tagList).toContain('v1.2.3')
    await deleteTag(repo, 'v1.2.3')
    expect(await runGitChecked(repo, ['tag'])).not.toContain('v1.2.3')
  })

  it('supports cherry-pick, revert, reset modes, checkout detached, and graph queries', async () => {
    const repo = await createTempRepo()
    const baseBranch = (await runGitChecked(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const initHash = (await runGitChecked(repo, ['rev-parse', 'HEAD'])).trim()

    await createBranch(repo, 'side', { checkout: true })
    fs.writeFileSync(path.join(repo, 'feature-x.txt'), 'feature x\n', 'utf8')
    await stageFiles(repo, ['feature-x.txt'], true, false)
    await commitChanges(repo, 'feat: add feature x')
    const sideHash = (await runGitChecked(repo, ['rev-parse', 'HEAD'])).trim()

    await runGitChecked(repo, ['checkout', baseBranch])
    fs.writeFileSync(path.join(repo, 'base-only.txt'), 'diverge base\n', 'utf8')
    await stageFiles(repo, ['base-only.txt'], true, false)
    await commitChanges(repo, 'docs: diverge base branch')

    const cp = await cherryPickCommit(repo, sideHash)
    expect(cp.ok).toBe(true)
    expect(fs.existsSync(path.join(repo, 'feature-x.txt'))).toBe(true)

    // Filter graph by search query
    const filtered = await getCommitGraph(repo, { branch: '__all__', search: 'feature x', count: 20 })
    expect(filtered.length).toBeGreaterThanOrEqual(2)
    expect(filtered.every((c) => c.subject.toLowerCase().includes('feature x'))).toBe(true)

    const pickedHead = (await runGitChecked(repo, ['rev-parse', 'HEAD'])).trim()
    const rv = await revertCommit(repo, pickedHead)
    expect(rv.ok).toBe(true)
    expect(fs.existsSync(path.join(repo, 'feature-x.txt'))).toBe(false)

    // Checkout detached & reset --hard back to init
    await checkoutCommit(repo, initHash)
    expect((await runGitChecked(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('HEAD')
    await runGitChecked(repo, ['checkout', baseBranch])
    await resetToCommit(repo, initHash, 'hard')
    expect((await runGitChecked(repo, ['rev-parse', 'HEAD'])).trim()).toBe(initHash)
  })

  it('preserves CRLF per line when staging, unstaging, and discarding CRLF hunks and rejects invalid action/staged states', async () => {
    const repo = await createTempRepo()
    const crlfPath = path.join(repo, 'win-crlf.txt')
    const baseLines = Array.from({ length: 24 }, (_, idx) => `crlf-line-${idx + 1}`)
    fs.writeFileSync(crlfPath, `${baseLines.join('\r\n')}\r\n`, 'utf8')
    await stageFiles(repo, ['win-crlf.txt'], true, false)
    await commitChanges(repo, 'chore: add CRLF file')

    const edited = [...baseLines]
    edited[1] = 'crlf-line-2-TOP'
    edited[22] = 'crlf-line-23-BOT'
    fs.writeFileSync(crlfPath, `${edited.join('\r\n')}\r\n`, 'utf8')

    // Reject invalid action/staged combinations
    await expect(applyHunkPatch(repo, 'win-crlf.txt', false, 'unstage', 0)).rejects.toThrow()
    await expect(applyHunkPatch(repo, 'win-crlf.txt', true, 'stage', 0)).rejects.toThrow()

    await applyHunkPatch(repo, 'win-crlf.txt', false, 'stage', 0)
    const staged = await getFileDiff(repo, 'win-crlf.txt', true, 'M')
    expect(staged.unifiedDiff).toContain('crlf-line-2-TOP')
    expect(staged.unifiedDiff).not.toContain('crlf-line-23-BOT')

    await applyHunkPatch(repo, 'win-crlf.txt', true, 'unstage', 0)
    expect((await getFileDiff(repo, 'win-crlf.txt', true, 'M')).unifiedDiff.trim()).toBe('')

    await applyHunkPatch(repo, 'win-crlf.txt', false, 'discard', 1)
    const diskBuf = fs.readFileSync(crlfPath, 'utf8')
    expect(diskBuf).toContain('crlf-line-2-TOP\r\n')
    expect(diskBuf).not.toContain('crlf-line-23-BOT')
  })

  it('finalizes cherry-pick conflicts cleanly via resolveMergeConflictFile and supports rebase abort', async () => {
    const repo = await createTempRepo()
    const baseBranch = (await runGitChecked(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

    await createBranch(repo, 'topic', { checkout: true })
    fs.writeFileSync(path.join(repo, 'app.txt'), 'topic line\n', 'utf8')
    await stageFiles(repo, ['app.txt'], true, false)
    await commitChanges(repo, 'feat: topic change')
    const topicHash = (await runGitChecked(repo, ['rev-parse', 'HEAD'])).trim()

    await runGitChecked(repo, ['checkout', baseBranch])
    fs.writeFileSync(path.join(repo, 'app.txt'), 'main line\n', 'utf8')
    await stageFiles(repo, ['app.txt'], true, false)
    await commitChanges(repo, 'chore: main change')

    const cpConflict = await cherryPickCommit(repo, topicHash)
    expect(cpConflict.ok).toBe(false)
    expect((await getMergeConflictStatus(repo)).inProgress).toBe(true)

    await resolveMergeConflictFile(repo, 'app.txt', 'custom', 'merged both lines\n')
    await finalizeWorktreeMerge(repo, 'complete')
    expect((await getRepoOperationState(repo)).state).toBe('none')
    expect(fs.readFileSync(path.join(repo, 'app.txt'), 'utf8')).toBe('merged both lines\n')

    // Rebase conflict -> abort restores clean state
    await runGitChecked(repo, ['checkout', 'topic'])
    const rbConflict = await rebaseCurrentOnto(repo, baseBranch)
    expect(rbConflict.ok).toBe(false)
    expect((await getRepoOperationState(repo)).state).toBe('rebase')

    await finalizeWorktreeMerge(repo, 'abort')
    expect((await getRepoOperationState(repo)).state).toBe('none')
  })

  it('reverts a merge commit cleanly using parent -m 1', async () => {
    const repo = await createTempRepo()
    const baseBranch = (await runGitChecked(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

    await createBranch(repo, 'feat/m1', { checkout: true })
    fs.writeFileSync(path.join(repo, 'merged-file.txt'), 'from merge branch\n', 'utf8')
    await stageFiles(repo, ['merged-file.txt'], true, false)
    await commitChanges(repo, 'feat: m1 file')

    await runGitChecked(repo, ['checkout', baseBranch])
    fs.writeFileSync(path.join(repo, 'main-only.txt'), 'main\n', 'utf8')
    await stageFiles(repo, ['main-only.txt'], true, false)
    await commitChanges(repo, 'chore: main file')

    const mergeRes = await mergeBranchIntoCurrent(repo, 'feat/m1', { noFastForward: true })
    expect(mergeRes.status).toBe('merged')
    const mergeHash = (await runGitChecked(repo, ['rev-parse', 'HEAD'])).trim()

    const revRes = await revertCommit(repo, mergeHash)
    expect(revRes.ok).toBe(true)
    expect(fs.existsSync(path.join(repo, 'merged-file.txt'))).toBe(false)
  })
})
