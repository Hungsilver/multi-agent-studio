import fs from 'node:fs'
import path from 'node:path'
import type { MergeConflictFile, MergeWorktreeResult, WorktreeInfo } from '@shared/types/git'
import { getRepoRoot, runGit, runGitChecked } from './git-runner'

const WORKTREE_DIR_NAME = '.ai-coding-worktrees'

function ensureExcludeRule(repoRoot: string): void {
  const excludePath = path.join(repoRoot, '.git', 'info', 'exclude')
  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true })
    const cur = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : ''
    const rule = `${WORKTREE_DIR_NAME}/`
    if (!cur.split(/\r?\n/).some((line) => line.trim() === rule)) {
      const next = (cur && !cur.endsWith('\n') ? `${cur}\n` : cur) + `${rule}\n`
      fs.writeFileSync(excludePath, next, 'utf8')
    }
  } catch {
    // ignore if .git/info/exclude is not writable (e.g. linked worktree)
  }
}

function sanitizeBranchSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
  return cleaned || `task-${Date.now().toString(36)}`
}

export async function createIsolatedWorktree(
  dir: string,
  branchSlug?: string
): Promise<{ repoRoot: string; worktreePath: string; branch: string; baseBranch: string }> {
  const repoRoot = await getRepoRoot(dir)
  if (!repoRoot) throw new Error('Thư mục này chưa phải Git repository nên không thể tạo Worktree.')

  const hasHead = (await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])).code === 0
  if (!hasHead) throw new Error('Repository chưa có commit nào — hãy tạo commit đầu tiên trước khi bật Worktree.')

  ensureExcludeRule(repoRoot)

  const baseBranch = (await runGitChecked(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const slug = sanitizeBranchSlug(branchSlug || `ai-${Date.now().toString(36)}`)
  let branch = `ai/${slug}`
  let wtPath = path.join(repoRoot, WORKTREE_DIR_NAME, slug)

  // Tránh trùng branch hoặc folder nếu tạo nhanh liên tiếp
  if (fs.existsSync(wtPath) || (await runGit(repoRoot, ['rev-parse', '--verify', `refs/heads/${branch}`])).code === 0) {
    const suffix = Math.random().toString(36).slice(2, 6)
    branch = `ai/${slug}-${suffix}`
    wtPath = path.join(repoRoot, WORKTREE_DIR_NAME, `${slug}-${suffix}`)
  }

  fs.mkdirSync(path.dirname(wtPath), { recursive: true })
  await runGitChecked(repoRoot, ['worktree', 'add', '-b', branch, wtPath, 'HEAD'], { timeoutMs: 30_000 })

  return {
    repoRoot,
    worktreePath: wtPath,
    branch,
    baseBranch
  }
}

export async function listWorktrees(dir: string): Promise<WorktreeInfo[]> {
  const root = await getRepoRoot(dir)
  if (!root) return []
  const res = await runGit(root, ['worktree', 'list', '--porcelain'])
  if (res.code !== 0) return []

  const items: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.path) {
        items.push({
          path: path.resolve(current.path),
          branch: current.branch ?? '(detached)',
          head: current.head ?? '',
          isMain: items.length === 0,
          locked: Boolean(current.locked)
        })
      }
      current = {}
      continue
    }
    if (line.startsWith('worktree ')) current.path = line.slice(9).trim()
    else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim()
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '').trim()
    else if (line === 'locked') current.locked = true
  }

  if (current.path) {
    items.push({
      path: path.resolve(current.path),
      branch: current.branch ?? '(detached)',
      head: current.head ?? '',
      isMain: items.length === 0,
      locked: Boolean(current.locked)
    })
  }

  return items
}

/** So khớp đường dẫn bền vững (8.3 short name, khác hoa/thường, dấu phân cách) bằng realpath khi có thể. */
function canonicalPath(p: string): string {
  try {
    return fs.realpathSync.native(p).toLowerCase()
  } catch {
    return path.resolve(p).toLowerCase()
  }
}

/**
 * Xóa worktree phụ đã đăng ký của repo. Mặc định dùng `git worktree remove` thường: Git từ chối khi còn thay đổi
 * chưa commit / file untracked, lỗi được ném ra nguyên văn và KHÔNG có fallback xóa đệ quy.
 * `force` chỉ nên bật sau khi người dùng đã xác nhận rõ nguy cơ mất thay đổi.
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  deleteBranch = false,
  force = false
): Promise<void> {
  const root = await getRepoRoot(repoRoot)
  if (!root) throw new Error('Không tìm thấy repository gốc để xóa Worktree.')

  const target = canonicalPath(worktreePath)
  const list = await listWorktrees(root)
  const found = list.find((w) => canonicalPath(w.path) === target)
  if (!found) {
    throw new Error(`Đường dẫn không phải Worktree đã đăng ký của repository này: ${worktreePath}`)
  }
  if (found.isMain || target === canonicalPath(root)) {
    throw new Error('Không thể xóa thư mục repository chính.')
  }

  const branchToDelete = deleteBranch && found.branch && !found.branch.startsWith('(') ? found.branch : null

  const res = await runGit(root, ['worktree', 'remove', ...(force ? ['--force'] : []), found.path], { timeoutMs: 20_000 })
  if (res.code !== 0) {
    throw new Error((res.stderr || res.stdout || 'git worktree remove thất bại').trim())
  }
  await runGit(root, ['worktree', 'prune'])

  // Chỉ xóa nhánh sau khi Git đã xác nhận xóa worktree; -d giữ lại nhánh chưa merge trừ khi người dùng đã force
  if (branchToDelete) {
    const br = await runGit(root, ['branch', force ? '-D' : '-d', branchToDelete])
    if (br.code !== 0) {
      throw new Error(`Đã xóa Worktree nhưng giữ lại nhánh ${branchToDelete}: ${(br.stderr || br.stdout).trim()}`)
    }
  }
}

export async function mergeWorktreeBranch(repoRoot: string, worktreeBranch: string): Promise<string> {
  const root = await getRepoRoot(repoRoot)
  if (!root) throw new Error('Không tìm thấy repository gốc')
  const dirty = (await runGitChecked(root, ['status', '--porcelain', '--untracked-files=no'])).trim()
  if (dirty) {
    throw new Error('Repo gốc đang có thay đổi chưa commit — hãy commit hoặc stash trước khi merge worktree.')
  }
  const res = await runGit(root, ['merge', '--no-edit', worktreeBranch], { timeoutMs: 30_000 })
  if (res.code !== 0) {
    await runGit(root, ['merge', '--abort'])
    throw new Error(`Merge xung đột hoặc lỗi:\n${res.stderr || res.stdout}`)
  }
  return (res.stdout || `Đã merge nhánh ${worktreeBranch} vào nhánh hiện tại`).trim()
}

function assertSafeRepoFile(repoRoot: string, relPath: string): string {
  const resolvedRoot = path.resolve(repoRoot)
  const resolvedTarget = path.resolve(resolvedRoot, relPath)
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    throw new Error(`Đường dẫn file không hợp lệ: ${relPath}`)
  }
  return resolvedTarget
}

export async function collectUnmergedConflicts(repoRoot: string): Promise<MergeConflictFile[]> {
  const diffRes = await runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U'])
  if (diffRes.code !== 0 || !diffRes.stdout.trim()) return []

  const files = diffRes.stdout
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean)

  const conflicts: MergeConflictFile[] = []
  for (const rel of files) {
    const [oursRes, theirsRes] = await Promise.all([
      runGit(repoRoot, ['show', `:2:${rel}`]),
      runGit(repoRoot, ['show', `:3:${rel}`])
    ])
    let mergedContent = ''
    try {
      const abs = assertSafeRepoFile(repoRoot, rel)
      if (fs.existsSync(abs)) {
        mergedContent = fs.readFileSync(abs, 'utf8')
      }
    } catch {
      mergedContent = ''
    }
    conflicts.push({
      filePath: rel,
      oursContent: oursRes.code === 0 ? oursRes.stdout : '',
      theirsContent: theirsRes.code === 0 ? theirsRes.stdout : '',
      mergedContent
    })
  }
  return conflicts
}

export async function prepareAndMergeWorktree(
  repoRoot: string,
  worktreePath: string,
  worktreeBranch: string,
  options: { autoCommitWorktree?: boolean; autoCommitMain?: boolean; commitMessage?: string } = {}
): Promise<MergeWorktreeResult> {
  const root = await getRepoRoot(repoRoot)
  if (!root) throw new Error('Không tìm thấy repository gốc')

  const targetBranch = (await runGitChecked(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

  // 1. Tự lưu commit thay đổi đang mở trong Worktree (nếu có) trước khi merge
  if (options.autoCommitWorktree !== false && worktreePath && fs.existsSync(worktreePath)) {
    const wtDirty = (await runGitChecked(worktreePath, ['status', '--porcelain'])).trim()
    if (wtDirty) {
      await runGitChecked(worktreePath, ['add', '-A'])
      await runGitChecked(worktreePath, [
        'commit',
        '-m',
        options.commitMessage?.trim() || `chore(worktree): auto-save ${worktreeBranch} before merge`
      ])
    }
  }

  // 2. Kiểm tra nhánh chính có thay đổi chưa commit không
  const mainStatusRaw = await runGitChecked(root, ['status', '--porcelain'])
  if (mainStatusRaw.trim()) {
    const dirtyFiles = mainStatusRaw
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.slice(3).trim())
      .filter(Boolean)

    if (!options.autoCommitMain) {
      return {
        status: 'main-dirty',
        message: 'Nhánh chính đang có thay đổi chưa commit — hãy commit tạm trước khi merge.',
        repoRoot: root,
        sourceBranch: worktreeBranch,
        targetBranch,
        conflicts: [],
        dirtyFiles
      }
    }

    await runGitChecked(root, ['add', '-A'])
    await runGitChecked(root, ['commit', '-m', 'wip: auto-save main branch before worktree merge'])
  }

  // 3. Thử merge nhánh worktree vào nhánh chính
  const mergeRes = await runGit(root, ['merge', '--no-edit', worktreeBranch], { timeoutMs: 30_000 })
  if (mergeRes.code === 0) {
    return {
      status: 'merged',
      message: (mergeRes.stdout || `Đã merge nhánh ${worktreeBranch} vào ${targetBranch}.`).trim(),
      repoRoot: root,
      sourceBranch: worktreeBranch,
      targetBranch,
      conflicts: []
    }
  }

  // 4. Giữ trạng thái conflict để user hoặc AI giải quyết từng file
  const conflicts = await collectUnmergedConflicts(root)
  if (conflicts.length > 0) {
    return {
      status: 'conflict',
      message: `Phát hiện ${conflicts.length} file xung đột khi merge ${worktreeBranch} → ${targetBranch}`,
      repoRoot: root,
      sourceBranch: worktreeBranch,
      targetBranch,
      conflicts
    }
  }

  await runGit(root, ['merge', '--abort'])
  throw new Error(`Merge lỗi:\n${mergeRes.stderr || mergeRes.stdout}`)
}

async function detectActiveGitOp(root: string): Promise<'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'> {
  const dirRes = await runGit(root, ['rev-parse', '--git-dir'])
  const raw = dirRes.code === 0 ? dirRes.stdout.trim() : ''
  const gitDir = raw ? (path.isAbsolute(raw) ? raw : path.resolve(root, raw)) : path.join(root, '.git')

  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) return 'merge'
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
    return 'rebase'
  }
  if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) return 'revert'
  return 'none'
}

export async function getMergeConflictStatus(
  repoRoot: string
): Promise<{ inProgress: boolean; conflicts: MergeConflictFile[] }> {
  const root = await getRepoRoot(repoRoot)
  if (!root) return { inProgress: false, conflicts: [] }
  const op = await detectActiveGitOp(root)
  const conflicts = await collectUnmergedConflicts(root)
  return { inProgress: op !== 'none' || conflicts.length > 0, conflicts }
}

export async function resolveMergeConflictFile(
  repoRoot: string,
  filePath: string,
  strategy: 'ours' | 'theirs' | 'custom',
  customContent?: string
): Promise<{ remaining: MergeConflictFile[] }> {
  const root = await getRepoRoot(repoRoot)
  if (!root) throw new Error('Không tìm thấy repository gốc')

  if (strategy === 'ours') {
    await runGitChecked(root, ['checkout', '--ours', '--', filePath])
  } else if (strategy === 'theirs') {
    await runGitChecked(root, ['checkout', '--theirs', '--', filePath])
  } else {
    const abs = assertSafeRepoFile(root, filePath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, customContent ?? '', 'utf8')
  }

  await runGitChecked(root, ['add', '--', filePath])
  return { remaining: await collectUnmergedConflicts(root) }
}

export async function finalizeWorktreeMerge(
  repoRoot: string,
  action: 'complete' | 'abort',
  commitMessage?: string
): Promise<string> {
  const root = await getRepoRoot(repoRoot)
  if (!root) throw new Error('Không tìm thấy repository gốc')

  const op = await detectActiveGitOp(root)

  if (action === 'abort') {
    if (op === 'rebase') {
      await runGitChecked(root, ['rebase', '--abort'])
      return 'Đã hủy Rebase và khôi phục trạng thái trước đó.'
    }
    if (op === 'cherry-pick') {
      await runGitChecked(root, ['cherry-pick', '--abort'])
      return 'Đã hủy Cherry-pick và khôi phục trạng thái trước đó.'
    }
    if (op === 'revert') {
      await runGitChecked(root, ['revert', '--abort'])
      return 'Đã hủy Revert và khôi phục trạng thái trước đó.'
    }
    if (op === 'merge') {
      await runGitChecked(root, ['merge', '--abort'])
      return 'Đã hủy quá trình merge và khôi phục trạng thái trước đó.'
    }
    await runGitChecked(root, ['reset', '--merge'])
    return 'Đã hủy trạng thái xung đột và khôi phục working tree.'
  }

  const remaining = await collectUnmergedConflicts(root)
  if (remaining.length > 0) {
    throw new Error(`Vẫn còn ${remaining.length} file chưa giải quyết xung đột (${remaining.map((c) => c.filePath).join(', ')}).`)
  }

  if (op === 'rebase' || op === 'cherry-pick' || op === 'revert') {
    const res = await runGitChecked(root, ['-c', 'core.editor=true', op, '--continue'], {
      env: { GIT_EDITOR: 'true' },
      timeoutMs: 60_000
    })
    return res.trim() || `Đã hoàn tất ${op} thành công.`
  }

  if (op === 'none') {
    return 'Đã giải quyết xong xung đột (các file đã được stage, sẵn sàng Commit).'
  }

  const args = commitMessage?.trim() ? ['commit', '-m', commitMessage.trim()] : ['commit', '--no-edit']
  const res = await runGitChecked(root, args, { timeoutMs: 20_000 })
  return res.trim() || 'Đã hoàn tất merge và commit thành công.'
}
