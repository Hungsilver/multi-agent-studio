import fs from 'node:fs'
import path from 'node:path'
import type {
  GitActionResult,
  GitMergeResult,
  HunkAction,
  RepoOperationState,
  ResetMode,
  StashEntry
} from '@shared/types/git'
import { buildSingleHunkPatch, parseUnifiedDiff } from '@shared/utils/diff-hunks'
import { getFileDiff } from './diff-service'
import { getRepoRoot, runGit, runGitChecked } from './git-runner'
import { getMergeConflictStatus } from './worktree-service'

export function assertValidRefName(ref: string): string {
  const trimmed = ref.trim()
  if (
    !trimmed ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith('.lock') ||
    trimmed === '@' ||
    trimmed.includes('..') ||
    trimmed.includes('@{') ||
    /[\s~^:?*[\]\\]/.test(trimmed)
  ) {
    throw new Error(`Tên ref/nhánh không hợp lệ: "${ref}"`)
  }
  return trimmed
}

export function assertValidCommitHash(hash: string): string {
  const trimmed = hash.trim()
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    throw new Error(`Mã commit không hợp lệ: "${hash}"`)
  }
  return trimmed
}

export function assertValidStashRef(ref: string): string {
  const trimmed = ref.trim()
  if (!/^stash@\{\d+\}$/.test(trimmed)) {
    throw new Error(`Mã stash không hợp lệ: "${ref}"`)
  }
  return trimmed
}

async function resolveGitDir(root: string): Promise<string> {
  const res = await runGit(root, ['rev-parse', '--git-dir'])
  if (res.code !== 0) return path.join(root, '.git')
  const raw = res.stdout.trim()
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw)
}

export async function getRepoOperationState(dir: string): Promise<RepoOperationState> {
  const root = await getRepoRoot(dir)
  if (!root) {
    return { state: 'none', headBranch: '', conflictCount: 0 }
  }
  const gitDir = await resolveGitDir(root)
  const headRes = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const headBranch = headRes.code === 0 ? headRes.stdout.trim() : 'HEAD'

  const conflictsRes = await runGit(root, ['diff', '--name-only', '--diff-filter=U'])
  const conflictCount = conflictsRes.stdout.split(/\r?\n/).filter((l) => l.trim()).length

  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
    return { state: 'merge', headBranch, conflictCount }
  }
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
    return { state: 'rebase', headBranch, conflictCount }
  }
  if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return { state: 'cherry-pick', headBranch, conflictCount }
  }
  if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) {
    return { state: 'revert', headBranch, conflictCount }
  }
  return { state: 'none', headBranch, conflictCount }
}

export async function fetchAll(dir: string, prune = true): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const args = ['fetch', '--all', '--tags']
  if (prune) args.push('--prune')
  await runGitChecked(root, args, { timeoutMs: 90_000 })
  return prune ? 'Đã fetch toàn bộ remote (--prune).' : 'Đã fetch toàn bộ remote.'
}

export async function pullCurrentBranch(dir: string, options: { rebase?: boolean } = {}): Promise<GitActionResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const args = ['pull']
  if (options.rebase) args.push('--rebase')
  const res = await runGit(root, args, { timeoutMs: 90_000 })
  if (res.code === 0) {
    return { ok: true, message: res.stdout.trim() || 'Đã pull cập nhật mới nhất.' }
  }
  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      ok: false,
      message: `Pull phát sinh ${st.conflicts.length} file xung đột — hãy giải quyết xung đột.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || 'Pull thất bại').trim())
}

export async function pushCurrentBranch(
  dir: string,
  options: { forceWithLease?: boolean; pushTags?: boolean } = {}
): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const branch = (await runGitChecked(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (!branch || branch === 'HEAD') {
    throw new Error('HEAD đang detached — hãy checkout một nhánh local trước khi push.')
  }
  const upRes = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const args = ['push']
  if (options.forceWithLease) args.push('--force-with-lease')
  if (options.pushTags) args.push('--tags')
  if (upRes.code !== 0) {
    args.push('-u', 'origin', branch)
  }
  const res = await runGitChecked(root, args, { timeoutMs: 120_000 })
  return res.trim() || `Đã push nhánh ${branch} lên remote.`
}

export async function createBranch(
  dir: string,
  name: string,
  options: { startPoint?: string; checkout?: boolean } = {}
): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validName = assertValidRefName(name)
  const start = options.startPoint?.trim()
    ? /^[0-9a-f]{7,40}$/i.test(options.startPoint.trim())
      ? assertValidCommitHash(options.startPoint)
      : assertValidRefName(options.startPoint)
    : ''

  if (options.checkout !== false) {
    const args = ['checkout', '-b', validName]
    if (start) args.push(start)
    await runGitChecked(root, args)
    return `Đã tạo và chuyển sang nhánh ${validName}`
  }

  const args = ['branch', validName]
  if (start) args.push(start)
  await runGitChecked(root, args)
  return `Đã tạo nhánh ${validName}`
}

export async function renameBranch(dir: string, oldName: string, newName: string): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const oldRef = assertValidRefName(oldName)
  const newRef = assertValidRefName(newName)
  await runGitChecked(root, ['branch', '-m', '--', oldRef, newRef])
  return `Đã đổi tên nhánh ${oldRef} → ${newRef}`
}

export async function deleteBranch(dir: string, name: string, force = false): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validName = assertValidRefName(name)
  const cur = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  if (cur === validName) {
    throw new Error(`Không thể xóa nhánh đang checkout (${validName})`)
  }
  await runGitChecked(root, ['branch', force ? '-D' : '-d', '--', validName])
  return `Đã xóa nhánh ${validName}`
}

export async function mergeBranchIntoCurrent(
  dir: string,
  sourceRef: string,
  options: { noFastForward?: boolean } = {}
): Promise<GitMergeResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validSource = assertValidRefName(sourceRef)
  const args = ['merge', '--no-edit']
  if (options.noFastForward) args.push('--no-ff')
  args.push(validSource)

  const res = await runGit(root, args, { timeoutMs: 60_000 })
  if (res.code === 0) {
    const out = res.stdout.trim()
    if (/already up to date/i.test(out)) {
      return { status: 'up-to-date', message: `Nhánh hiện tại đã cập nhật theo ${validSource}.`, conflicts: [] }
    }
    return { status: 'merged', message: out || `Đã merge ${validSource} vào nhánh hiện tại.`, conflicts: [] }
  }

  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      status: 'conflict',
      message: `Phát sinh ${st.conflicts.length} file xung đột khi merge ${validSource}.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || 'Merge thất bại').trim())
}

export async function rebaseCurrentOnto(dir: string, targetRef: string): Promise<GitActionResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validTarget = assertValidRefName(targetRef)
  const res = await runGit(root, ['rebase', validTarget], { timeoutMs: 90_000 })
  if (res.code === 0) {
    return { ok: true, message: `Đã rebase nhánh hiện tại lên ${validTarget}.` }
  }
  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      ok: false,
      message: `Rebase gặp ${st.conflicts.length} file xung đột — hãy giải quyết rồi Tiếp tục hoặc Hủy rebase.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || 'Rebase thất bại').trim())
}

export async function continueOrAbortOperation(
  dir: string,
  op: 'merge' | 'rebase' | 'cherry-pick' | 'revert',
  action: 'continue' | 'abort'
): Promise<GitActionResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const flag = action === 'abort' ? '--abort' : '--continue'
  const res = await runGit(root, ['-c', 'core.editor=true', op, flag], {
    env: { GIT_EDITOR: 'true' },
    timeoutMs: 60_000
  })
  if (res.code === 0) {
    return {
      ok: true,
      message: action === 'abort' ? `Đã hủy ${op} và khôi phục trạng thái trước đó.` : `Đã hoàn tất ${op}.`
    }
  }
  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      ok: false,
      message: `Vẫn còn ${st.conflicts.length} file xung đột cần xử lý.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || `Thao tác ${op} ${flag} thất bại`).trim())
}

export async function listStashes(dir: string): Promise<StashEntry[]> {
  const root = await getRepoRoot(dir)
  if (!root) return []
  const res = await runGit(root, ['stash', 'list', '--format=%gd%x1f%gs%x1f%cr'])
  if (res.code !== 0 || !res.stdout.trim()) return []

  const items: StashEntry[] = []
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [ref = '', subject = '', date = ''] = line.split('\x1f')
    const idxMatch = ref.match(/^stash@\{(\d+)\}$/)
    const index = idxMatch ? parseInt(idxMatch[1], 10) : items.length
    const colonIdx = subject.indexOf(':')
    const branch = colonIdx > 0 ? subject.slice(0, colonIdx).replace(/^WIP on |^On /i, '').trim() : ''
    const message = colonIdx > 0 ? subject.slice(colonIdx + 1).trim() : subject.trim()
    items.push({ ref, index, branch, message: message || ref, date })
  }
  return items
}

export async function saveStash(dir: string, message?: string, includeUntracked = true): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const args = ['stash', 'push']
  if (includeUntracked) args.push('-u')
  const msg = (message ?? '').trim()
  if (msg) args.push('-m', msg)
  const out = await runGitChecked(root, args)
  if (/no local changes to save/i.test(out)) {
    throw new Error('Không có thay đổi nào để Stash.')
  }
  return out.trim() || 'Đã lưu Stash thành công.'
}

export async function applyOrPopStash(dir: string, stashRef: string, pop: boolean): Promise<GitActionResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validRef = assertValidStashRef(stashRef)
  const res = await runGit(root, ['stash', pop ? 'pop' : 'apply', validRef])
  if (res.code === 0) {
    return { ok: true, message: `Đã ${pop ? 'pop' : 'apply'} ${validRef}.` }
  }
  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      ok: false,
      message: `${pop ? 'Pop' : 'Apply'} ${validRef} phát sinh ${st.conflicts.length} file xung đột.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || 'Thao tác stash thất bại').trim())
}

export async function dropStash(dir: string, stashRef: string): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validRef = assertValidStashRef(stashRef)
  await runGitChecked(root, ['stash', 'drop', validRef])
  return `Đã xóa ${validRef}.`
}

export async function getStashDiff(dir: string, stashRef: string): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) return ''
  const validRef = assertValidStashRef(stashRef)
  const res = await runGit(root, ['-c', 'core.quotePath=false', 'stash', 'show', '-p', '--include-untracked', validRef])
  return res.code === 0 ? res.stdout : ''
}

export async function createTag(
  dir: string,
  name: string,
  target?: string,
  message?: string
): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validName = assertValidRefName(name)
  const validTarget = target?.trim()
    ? /^[0-9a-f]{7,40}$/i.test(target.trim())
      ? assertValidCommitHash(target)
      : assertValidRefName(target)
    : 'HEAD'
  const msg = (message ?? '').trim()
  const args = msg ? ['tag', '-a', validName, validTarget, '-m', msg] : ['tag', validName, validTarget]
  await runGitChecked(root, args)
  return `Đã tạo tag ${validName}`
}

export async function deleteTag(dir: string, name: string): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validName = assertValidRefName(name)
  await runGitChecked(root, ['tag', '-d', validName])
  return `Đã xóa tag ${validName}`
}

async function isMergeCommit(root: string, hash: string): Promise<boolean> {
  const res = await runGit(root, ['rev-list', '--parents', '-n', '1', hash])
  if (res.code !== 0) return false
  return res.stdout.trim().split(/\s+/).filter(Boolean).length > 2
}

export async function cherryPickCommit(dir: string, hash: string): Promise<GitActionResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validHash = assertValidCommitHash(hash)
  const isMerge = await isMergeCommit(root, validHash)
  const args = isMerge ? ['cherry-pick', '-m', '1', validHash] : ['cherry-pick', validHash]
  const res = await runGit(root, args)
  if (res.code === 0) {
    return { ok: true, message: `Đã cherry-pick commit ${validHash.slice(0, 7)}.` }
  }
  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      ok: false,
      message: `Cherry-pick ${validHash.slice(0, 7)} gặp ${st.conflicts.length} file xung đột.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || 'Cherry-pick thất bại').trim())
}

export async function revertCommit(dir: string, hash: string): Promise<GitActionResult> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validHash = assertValidCommitHash(hash)
  const isMerge = await isMergeCommit(root, validHash)
  const args = isMerge ? ['revert', '--no-edit', '-m', '1', validHash] : ['revert', '--no-edit', validHash]
  const res = await runGit(root, args)
  if (res.code === 0) {
    return { ok: true, message: `Đã tạo commit revert cho ${validHash.slice(0, 7)}.` }
  }
  const st = await getMergeConflictStatus(root)
  if (st.conflicts.length > 0) {
    return {
      ok: false,
      message: `Revert ${validHash.slice(0, 7)} gặp ${st.conflicts.length} file xung đột.`,
      conflicts: st.conflicts
    }
  }
  throw new Error((res.stderr || res.stdout || 'Revert commit thất bại').trim())
}

export async function resetToCommit(dir: string, hash: string, mode: ResetMode): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validHash = assertValidCommitHash(hash)
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
    throw new Error(`Chế độ reset không hợp lệ: ${mode}`)
  }
  await runGitChecked(root, ['reset', `--${mode}`, validHash])
  return `Đã reset (--${mode}) về commit ${validHash.slice(0, 7)}.`
}

export async function checkoutCommit(dir: string, hash: string): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const validHash = assertValidCommitHash(hash)
  await runGitChecked(root, ['checkout', '--detach', validHash])
  return `Đã checkout detached HEAD tại ${validHash.slice(0, 7)}.`
}

export async function applyHunkPatch(
  dir: string,
  filePath: string,
  staged: boolean,
  action: HunkAction,
  hunkIndex: number
): Promise<void> {
  if ((staged && action !== 'unstage') || (!staged && action === 'unstage')) {
    throw new Error(`Hành động "${action}" không khớp với trạng thái staged=${String(staged)}`)
  }
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const diff = await getFileDiff(root, filePath, staged, 'M')
  const parsed = parseUnifiedDiff(diff.unifiedDiff)
  const patch = buildSingleHunkPatch(parsed, hunkIndex)

  const args =
    action === 'stage'
      ? ['apply', '--cached', '--recount', '--whitespace=nowarn', '-']
      : action === 'unstage'
        ? ['apply', '--cached', '--reverse', '--recount', '--whitespace=nowarn', '-']
        : ['apply', '--reverse', '--recount', '--whitespace=nowarn', '-']

  await runGitChecked(root, args, { stdin: patch })
}
