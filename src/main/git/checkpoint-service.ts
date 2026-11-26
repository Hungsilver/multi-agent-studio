import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDefaultDataDir } from '../storage/database'
import { getRepoRoot, resolveSafeRepoPath, runGit, runGitChecked } from './git-runner'

export interface CapturedCheckpoint {
  treeHash: string | null
  backupId: string | null
}

function getBackupDir(backupId: string): string {
  return path.join(getDefaultDataDir(), 'checkpoints', backupId)
}

/**
 * Chụp toàn bộ trạng thái working tree (bao gồm cả file đã sửa, file staged và untracked trừ thư mục ignored)
 * bằng GIT_INDEX_FILE tạm + `git write-tree`. Hoàn toàn KHÔNG chạm vào index thật, git stash list, hay git log.
 */
export async function captureCheckpoint(dir: string): Promise<CapturedCheckpoint> {
  const root = await getRepoRoot(dir)
  if (!root) return { treeHash: null, backupId: null }

  const backupId = randomUUID()
  const tmpIndex = path.join(os.tmpdir(), `aict-idx-${backupId}`)

  try {
    // Khởi tạo temp index từ HEAD (nếu repo đã có commit)
    const hasHead = (await runGit(root, ['rev-parse', '--verify', 'HEAD'], { timeoutMs: 5000 })).code === 0
    if (hasHead) {
      await runGit(root, ['read-tree', 'HEAD'], { env: { GIT_INDEX_FILE: tmpIndex } })
    }

    // Thêm toàn bộ working tree (tracked + untracked không bị gitignore, bỏ qua .ai-coding-worktrees)
    await runGit(
      root,
      ['add', '-A', '--', '.', ':!.ai-coding-worktrees'],
      { env: { GIT_INDEX_FILE: tmpIndex }, timeoutMs: 30_000 }
    )

    const treeOut = await runGitChecked(root, ['write-tree'], {
      env: { GIT_INDEX_FILE: tmpIndex },
      timeoutMs: 15_000
    })
    const treeHash = treeOut.trim()

    return { treeHash, backupId }
  } catch {
    return { treeHash: null, backupId: null }
  } finally {
    if (fs.existsSync(tmpIndex)) {
      try {
        fs.unlinkSync(tmpIndex)
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Liệt kê danh sách file thay đổi giữa preTreeHash và postTreeHash (hoặc working tree hiện tại nếu postTreeHash null).
 */
export async function listChangedFilesBetweenTrees(
  dir: string,
  preTreeHash: string,
  postTreeHash: string | null
): Promise<Array<{ path: string; code: string }>> {
  const root = await getRepoRoot(dir)
  if (!root || !preTreeHash) return []

  let targetTree = postTreeHash
  if (!targetTree) {
    const snap = await captureCheckpoint(root)
    targetTree = snap.treeHash
  }
  if (!targetTree || targetTree === preTreeHash) return []

  const res = await runGit(root, ['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-status', preTreeHash, targetTree])
  if (res.code !== 0) return []

  const files: Array<{ path: string; code: string }> = []
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 2) continue
    files.push({ code: parts[0].charAt(0), path: parts[parts.length - 1] })
  }
  return files
}

/**
 * Khôi phục toàn bộ working tree về đúng snapshot `preTreeHash` (Undo 1 Turn AI).
 * - File có trong preTreeHash: ghi đè đúng nội dung từ tree object.
 * - File được tạo mới sau preTreeHash (có trong working tree hiện tại nhưng không có trong preTreeHash): xóa khỏi working tree.
 */
export async function restoreCheckpoint(dir: string, preTreeHash: string): Promise<void> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Thư mục không phải Git repository')
  if (!/^[0-9a-f]{40}$/i.test(preTreeHash)) throw new Error('Mã checkpoint tree không hợp lệ')

  const curSnap = await captureCheckpoint(root)
  const tmpIndex = path.join(os.tmpdir(), `aict-restore-${randomUUID()}`)

  try {
    // Tìm các file được thêm mới so với preTreeHash để xóa khỏi working tree
    if (curSnap.treeHash) {
      const addedRes = await runGit(root, [
        '-c',
        'core.quotePath=false',
        'diff-tree',
        '-r',
        '--diff-filter=A',
        '--name-only',
        preTreeHash,
        curSnap.treeHash
      ])
      if (addedRes.code === 0) {
        for (const rel of addedRes.stdout.split(/\r?\n/)) {
          const clean = rel.trim()
          if (!clean) continue
          const full = resolveSafeRepoPath(root, clean)
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            fs.unlinkSync(full)
          }
        }
      }
    }

    // Nạp preTreeHash vào temp index rồi checkout nội dung ra working tree
    await runGitChecked(root, ['read-tree', preTreeHash], { env: { GIT_INDEX_FILE: tmpIndex } })
    await runGitChecked(root, ['checkout-index', '-a', '-f'], { env: { GIT_INDEX_FILE: tmpIndex } })
  } finally {
    if (fs.existsSync(tmpIndex)) {
      try {
        fs.unlinkSync(tmpIndex)
      } catch {
        // ignore
      }
    }
    const backup = getBackupDir(preTreeHash)
    if (fs.existsSync(backup)) {
      // keep clean if unused
    }
  }
}

/**
 * Khôi phục duy nhất 1 file về trạng thái tại `preTreeHash`.
 */
export async function restoreFileFromCheckpoint(
  dir: string,
  preTreeHash: string,
  relPath: string
): Promise<void> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Thư mục không phải Git repository')
  if (!/^[0-9a-f]{40}$/i.test(preTreeHash)) throw new Error('Mã checkpoint tree không hợp lệ')

  const normalized = relPath.replace(/\\/g, '/')
  const full = resolveSafeRepoPath(root, normalized)
  const existsInTree = await runGit(root, ['cat-file', '-e', `${preTreeHash}:${normalized}`])

  if (existsInTree.code !== 0) {
    // File chưa từng tồn tại ở preTreeHash -> xóa file
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      fs.unlinkSync(full)
    }
    return
  }

  const blob = await runGit(root, ['show', `${preTreeHash}:${normalized}`])
  if (blob.code !== 0) throw new Error(blob.stderr || 'Không đọc được nội dung checkpoint')
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, blob.stdout, 'utf8')
}

export async function getTreeFileContent(root: string, treeHash: string, relPath: string): Promise<string> {
  const normalized = relPath.replace(/\\/g, '/')
  const check = await runGit(root, ['cat-file', '-e', `${treeHash}:${normalized}`])
  if (check.code !== 0) return ''
  const res = await runGit(root, ['show', `${treeHash}:${normalized}`])
  return res.code === 0 ? res.stdout : ''
}
