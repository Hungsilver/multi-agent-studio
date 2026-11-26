import fs from 'node:fs'
import path from 'node:path'
import type { WorktreeInfo } from '@shared/types/git'
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

export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  deleteBranch = false
): Promise<void> {
  const root = await getRepoRoot(repoRoot)
  if (!root) return

  let branchToDelete: string | null = null
  if (deleteBranch) {
    const list = await listWorktrees(root)
    const found = list.find((w) => path.resolve(w.path).toLowerCase() === path.resolve(worktreePath).toLowerCase())
    if (found && found.branch && !found.branch.startsWith('(')) {
      branchToDelete = found.branch
    }
  }

  await runGit(root, ['worktree', 'remove', '--force', worktreePath], { timeoutMs: 20_000 })
  await runGit(root, ['worktree', 'prune'])

  if (branchToDelete) {
    await runGit(root, ['branch', '-D', branchToDelete])
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
