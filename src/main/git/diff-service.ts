import fs from 'node:fs'
import path from 'node:path'
import type { DiffResult, FileChange, RepoSummary } from '@shared/types/git'
import { getTreeFileContent, listChangedFilesBetweenTrees } from './checkpoint-service'
import { getRepoRoot, resolveSafeRepoPath, runGit, runGitChecked } from './git-runner'

function readTextSafe(fullPath: string): { content: string; isBinary: boolean } {
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return { content: '', isBinary: false }
  }
  const stat = fs.statSync(fullPath)
  if (stat.size > 1024 * 1024) {
    return { content: `(File quá lớn: ${Math.round(stat.size / 1024)} KB)`, isBinary: true }
  }
  const buf = fs.readFileSync(fullPath)
  if (buf.includes(0)) {
    return { content: '(File nhị phân)', isBinary: true }
  }
  return { content: buf.toString('utf8'), isBinary: false }
}

export async function getRepoSummary(dir: string, includeDetails = false): Promise<RepoSummary> {
  const root = await getRepoRoot(dir)
  if (!root) {
    return {
      isRepo: false,
      root: dir,
      branch: '',
      upstream: null,
      ahead: 0,
      behind: 0,
      addedLines: 0,
      deletedLines: 0,
      untrackedCount: 0,
      dirtyCount: 0
    }
  }

  const branchRes = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = branchRes.code === 0 ? branchRes.stdout.trim() : 'HEAD'

  const upRes = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const upstream = upRes.code === 0 ? upRes.stdout.trim() : null

  let ahead = 0
  let behind = 0
  if (upstream) {
    const ab = await runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
    if (ab.code === 0) {
      const parts = ab.stdout.trim().split(/\s+/)
      ahead = parseInt(parts[0] ?? '0', 10) || 0
      behind = parseInt(parts[1] ?? '0', 10) || 0
    }
  }

  const statRes = await runGit(root, ['diff', '--shortstat', 'HEAD'])
  const addMatch = statRes.stdout.match(/(\d+)\s+insertion/)
  const delMatch = statRes.stdout.match(/(\d+)\s+deletion/)

  const untrackedRes = await runGit(root, ['ls-files', '--others', '--exclude-standard'])
  const untrackedCount = untrackedRes.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('.ai-coding-worktrees')).length

  const statusRes = await runGit(root, ['status', '--porcelain'])
  const dirtyCount = statusRes.stdout.split(/\r?\n/).filter((l) => l.trim()).length

  const summary: RepoSummary = {
    isRepo: true,
    root,
    branch,
    upstream,
    ahead,
    behind,
    addedLines: addMatch ? parseInt(addMatch[1], 10) : 0,
    deletedLines: delMatch ? parseInt(delMatch[1], 10) : 0,
    untrackedCount,
    dirtyCount
  }
  if (includeDetails) {
    const [head, upstreamRemote, incomingDiff] = await Promise.all([
      runGit(root, ['log', '-1', '--format=%h%x00%s%x00%an%x00%aI', 'HEAD', '--']),
      runGit(root, ['for-each-ref', '--format=%(upstream:remotename)', '--', `refs/heads/${branch}`]),
      behind > 0 ? runGit(root, ['diff', '--find-renames', '--name-status', '-z', 'HEAD...@{u}', '--']) : null
    ])
    if (incomingDiff?.code === 0) {
      const counts = { files: 0, added: 0, modified: 0, deleted: 0, renamed: 0 }
      const entries = incomingDiff.stdout.split('\0')
      for (let index = 0; entries[index];) {
        const status = entries[index][0]
        counts.files++
        if (status === 'A' || status === 'C') counts.added++
        else if (status === 'D') counts.deleted++
        else if (status === 'R') counts.renamed++
        else counts.modified++
        // Rename and copy records have both the old and new path.
        index += status === 'R' || status === 'C' ? 3 : 2
      }
      summary.incomingChanges = counts
    }
    if (head.code === 0) {
      const [shortHash, subject, author, date] = head.stdout.trim().split('\0')
      summary.headCommit = { shortHash, subject, author, date }
    }
    const remote = await runGit(root, ['remote', 'get-url', '--', upstreamRemote.stdout.trim() || 'origin'])
    if (remote.code === 0) {
      summary.remoteUrl = remote.stdout.trim().replace(/(:\/\/)[^/@\s]+@/, '$1').replace(/[?#].*$/, '')
    }
  }
  return summary
}

export async function getWorkingChanges(dir: string): Promise<FileChange[]> {
  const root = await getRepoRoot(dir)
  if (!root) return []

  const res = await runGit(root, [
    '-c',
    'core.quotePath=false',
    '-c',
    'status.relativePaths=false',
    'status',
    '--porcelain=v2',
    '--untracked-files=all'
  ])
  if (res.code !== 0) return []

  const numstatUnstaged = new Map<string, { add: number; del: number }>()
  const numstatStaged = new Map<string, { add: number; del: number }>()

  const ns1 = await runGit(root, ['-c', 'core.quotePath=false', 'diff', '--numstat'])
  for (const l of ns1.stdout.split(/\r?\n/)) {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (m) numstatUnstaged.set(m[3], { add: parseInt(m[1], 10) || 0, del: parseInt(m[2], 10) || 0 })
  }
  const ns2 = await runGit(root, ['-c', 'core.quotePath=false', 'diff', '--cached', '--numstat'])
  for (const l of ns2.stdout.split(/\r?\n/)) {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (m) numstatStaged.set(m[3], { add: parseInt(m[1], 10) || 0, del: parseInt(m[2], 10) || 0 })
  }

  const out: FileChange[] = []
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith('1 ')) {
      const m = line.match(/^1 (\S)(\S) (?:\S+ ){6}(.+)$/)
      if (!m) continue
      const [, x, y, p] = m
      if (x !== '.') {
        const s = numstatStaged.get(p)
        out.push({ path: p, code: x, staged: true, additions: s?.add, deletions: s?.del })
      }
      if (y !== '.') {
        const s = numstatUnstaged.get(p)
        out.push({ path: p, code: y, staged: false, additions: s?.add, deletions: s?.del })
      }
    } else if (line.startsWith('2 ')) {
      const m = line.match(/^2 (\S)(\S) (?:\S+ ){7}(.+)$/)
      if (!m) continue
      const [, x, y, rawPaths] = m
      const [p, oldP] = rawPaths.split('\t')
      if (x !== '.') out.push({ path: p, oldPath: oldP, code: x, staged: true })
      if (y !== '.') out.push({ path: p, code: y, staged: false })
    } else if (line.startsWith('u ')) {
      const m = line.match(/^u \S\S (?:\S+ ){8}(.+)$/)
      if (m) out.push({ path: m[1], code: 'U', staged: false })
    } else if (line.startsWith('? ')) {
      const p = line.slice(2)
      if (!p.startsWith('.ai-coding-worktrees')) {
        out.push({ path: p, code: '?', staged: false })
      }
    }
  }
  return out
}

export async function getFileDiff(
  dir: string,
  filePath: string,
  staged: boolean,
  code: string
): Promise<DiffResult> {
  const root = await getRepoRoot(dir)
  if (!root) {
    return { path: filePath, original: '', modified: '', unifiedDiff: '', isBinary: false }
  }
  const normalized = filePath.replace(/\\/g, '/')
  const full = resolveSafeRepoPath(root, normalized)

  if (code === '?') {
    const mod = readTextSafe(full)
    return {
      path: normalized,
      original: '',
      modified: mod.content,
      unifiedDiff: '',
      isBinary: mod.isBinary
    }
  }

  let original = ''
  let modified = ''
  let isBinary = false

  if (staged) {
    const headRes = await runGit(root, ['show', `HEAD:${normalized}`])
    original = headRes.code === 0 ? headRes.stdout : ''
    const idxRes = await runGit(root, ['show', `:${normalized}`])
    modified = idxRes.code === 0 ? idxRes.stdout : ''
  } else {
    const baseRef = `:${normalized}`
    const baseRes = await runGit(root, ['show', baseRef])
    if (baseRes.code === 0) {
      original = baseRes.stdout
    } else {
      const headRes = await runGit(root, ['show', `HEAD:${normalized}`])
      original = headRes.code === 0 ? headRes.stdout : ''
    }
    const disk = readTextSafe(full)
    modified = disk.content
    isBinary = disk.isBinary
  }

  const diffArgs = ['-c', 'core.quotePath=false', 'diff']
  if (staged) diffArgs.push('--cached')
  diffArgs.push('-M', '--', normalized)
  const unified = await runGit(root, diffArgs)

  return {
    path: normalized,
    original,
    modified,
    unifiedDiff: unified.stdout,
    isBinary
  }
}

export async function getTurnChangedFiles(
  dir: string,
  preTreeHash: string,
  postTreeHash: string | null
): Promise<FileChange[]> {
  const items = await listChangedFilesBetweenTrees(dir, preTreeHash, postTreeHash)
  return items.map((i) => ({ path: i.path, code: i.code, staged: false }))
}

export async function getTurnFileDiff(
  dir: string,
  preTreeHash: string,
  postTreeHash: string | null,
  filePath: string
): Promise<DiffResult> {
  const root = await getRepoRoot(dir)
  if (!root) return { path: filePath, original: '', modified: '', unifiedDiff: '', isBinary: false }

  const normalized = filePath.replace(/\\/g, '/')
  const original = await getTreeFileContent(root, preTreeHash, normalized)
  let modified = ''
  let isBinary = false
  if (postTreeHash) {
    modified = await getTreeFileContent(root, postTreeHash, normalized)
  } else {
    const disk = readTextSafe(resolveSafeRepoPath(root, normalized))
    modified = disk.content
    isBinary = disk.isBinary
  }
  return {
    path: normalized,
    original,
    modified,
    unifiedDiff: '',
    isBinary
  }
}

export async function stageFiles(dir: string, paths: string[], stage: boolean, all = false): Promise<void> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  if (all) {
    await runGitChecked(root, stage ? ['add', '-A'] : ['reset', '-q'])
    return
  }
  for (let i = 0; i < paths.length; i += 40) {
    const chunk = paths.slice(i, i + 40)
    await runGitChecked(root, stage ? ['add', '-A', '--', ...chunk] : ['reset', '-q', '--', ...chunk])
  }
}

export async function commitChanges(
  dir: string,
  message: string,
  options: { amend?: boolean } = {}
): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const msg = message.trim()
  if (!msg) throw new Error('Commit message không được để trống')

  if (!options.amend) {
    const staged = (await runGitChecked(root, ['diff', '--cached', '--name-only'])).trim()
    if (!staged) throw new Error('Chưa có file nào được stage')
  }

  const args = options.amend ? ['commit', '--amend', '-F', '-'] : ['commit', '-F', '-']
  const res = await runGit(root, args, { stdin: `${msg}\n`, timeoutMs: 60_000 })
  if (res.code !== 0) {
    throw new Error((res.stderr || res.stdout || 'Commit lỗi').trim())
  }
  return res.stdout.split(/\r?\n/)[0] || (options.amend ? 'Đã amend commit thành công' : 'Đã commit thành công')
}

export async function getLastCommitMessage(dir: string): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) return ''
  const res = await runGit(root, ['log', '-1', '--pretty=%B'])
  return res.code === 0 ? res.stdout.trim() : ''
}

export async function revertWorkingFile(dir: string, change: FileChange): Promise<void> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const full = resolveSafeRepoPath(root, change.path)
  if (change.code === 'U') throw new Error(`${change.path} đang xung đột merge`)

  if (!change.staged) {
    if (change.code === '?') {
      if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true })
    } else {
      await runGitChecked(root, ['restore', '--worktree', '--', change.path])
    }
    return
  }

  if (change.code === 'A') {
    await runGitChecked(root, ['rm', '--cached', '-q', '-f', '--', change.path])
    if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true })
  } else {
    await runGitChecked(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', change.path])
  }
}
