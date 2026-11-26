import type { BranchInfo, CommitDetail, CommitNode, DiffResult, GraphSegment } from '@shared/types/git'
import { getRepoRoot, runGit, runGitChecked } from './git-runner'

export async function listBranches(dir: string): Promise<BranchInfo[]> {
  const root = await getRepoRoot(dir)
  if (!root) return []
  const fmt = '%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)'
  const res = await runGit(root, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags'])
  if (res.code !== 0) return []

  const items: BranchInfo[] = []
  for (const line of res.stdout.split(/\r?\n/)) {
    const f = line.split('\x1f')
    if (f.length < 5 || /^refs\/remotes\/[^/]+\/HEAD$/.test(f[0])) continue
    const kind: BranchInfo['kind'] = f[0].startsWith('refs/heads/')
      ? 'local'
      : f[0].startsWith('refs/remotes/')
        ? 'remote'
        : 'tag'
    items.push({
      kind,
      name: f[1],
      current: f[2] === '*',
      upstream: f[3],
      track: f[4]
    })
  }
  return items
}

export async function getCommitGraph(dir: string, count = 150): Promise<CommitNode[]> {
  const root = await getRepoRoot(dir)
  if (!root) return []
  const res = await runGit(root, [
    '-c',
    'core.quotePath=false',
    'log',
    '--date-order',
    '--date=format:%d/%m/%Y %H:%M',
    '--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%D%x1f%s',
    '-n',
    String(count),
    '--all'
  ])
  if (res.code !== 0) return []

  const lanes: Array<string | null> = []
  const colors: number[] = []
  let nextColor = 0
  const nodes: CommitNode[] = []

  for (const line of res.stdout.split(/\r?\n/)) {
    const f = line.split('\x1f')
    if (f.length < 7) continue
    const hash = f[0]
    const parents = f[2].split(' ').filter(Boolean)
    const segments: GraphSegment[] = []
    const width = lanes.length

    let col = lanes.indexOf(hash)
    const isTip = col < 0
    if (isTip) {
      col = lanes.indexOf(null)
      if (col < 0) {
        col = lanes.push(null) - 1
        colors.push(0)
      }
      lanes[col] = hash
      colors[col] = nextColor++
    }

    const color = colors[col]
    for (let k = 0; k < width; k++) {
      const w = lanes[k]
      if (w === null) continue
      if (w !== hash) {
        segments.push({ kind: 0, fromCol: k, toCol: k, colorIndex: colors[k] })
        continue
      }
      if (k !== col) {
        segments.push({ kind: 1, fromCol: k, toCol: col, colorIndex: colors[k] })
        lanes[k] = null
      } else if (!isTip) {
        segments.push({ kind: 1, fromCol: col, toCol: col, colorIndex: color })
      }
    }

    lanes[col] = null

    for (let i = 0; i < parents.length; i++) {
      const p = parents[i]
      let e = lanes.indexOf(p)
      if (e >= 0) {
        segments.push({ kind: 2, fromCol: col, toCol: e, colorIndex: i === 0 ? color : colors[e] })
        continue
      }
      if (i === 0) {
        e = col
      } else {
        e = lanes.indexOf(null)
        if (e < 0) {
          e = lanes.push(null) - 1
          colors.push(0)
        }
        colors[e] = nextColor++
      }
      lanes[e] = p
      segments.push({ kind: 2, fromCol: col, toCol: e, colorIndex: colors[e] })
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }

    nodes.push({
      hash,
      shortHash: f[1],
      author: f[3],
      date: f[4],
      refs: f[5],
      subject: f.slice(6).join(' '),
      isMerge: parents.length > 1,
      col,
      colorIndex: color,
      lanes: Math.max(width, lanes.length, col + 1),
      segments
    })
  }

  return nodes
}

export async function getCommitDetail(dir: string, hash: string): Promise<CommitDetail> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Mã commit không hợp lệ')

  const info = await runGitChecked(root, [
    'show',
    '-s',
    '--date=format:%d/%m/%Y %H:%M:%S',
    '--format=Commit:  %H%nTác giả: %an <%ae>%nNgày:    %ad%nCha:     %P%n%n%B',
    hash
  ])
  const filesOut = await runGitChecked(root, [
    '-c',
    'core.quotePath=false',
    'show',
    '--format=',
    '--name-status',
    '-M',
    '-m',
    '--first-parent',
    hash
  ])
  const files = filesOut
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((f) => f.length >= 2)
    .map((f) => ({
      code: f[0].charAt(0),
      path: f[f.length - 1],
      oldPath: f.length > 2 ? f[1] : undefined
    }))

  return { hash, info, files }
}

export async function getCommitFileDiff(dir: string, hash: string, filePath: string): Promise<DiffResult> {
  const root = await getRepoRoot(dir)
  if (!root) return { path: filePath, original: '', modified: '', unifiedDiff: '', isBinary: false }
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Mã commit không hợp lệ')

  const normalized = filePath.replace(/\\/g, '/')
  const parentRes = await runGit(root, ['rev-parse', `${hash}^`])
  const parentHash = parentRes.code === 0 ? parentRes.stdout.trim() : ''

  const origRes = parentHash ? await runGit(root, ['show', `${parentHash}:${normalized}`]) : { code: 1, stdout: '' }
  const modRes = await runGit(root, ['show', `${hash}:${normalized}`])
  const uniRes = await runGit(root, ['-c', 'core.quotePath=false', 'show', '--format=', '-M', '-m', '--first-parent', hash, '--', normalized])

  return {
    path: normalized,
    original: origRes.code === 0 ? origRes.stdout : '',
    modified: modRes.code === 0 ? modRes.stdout : '',
    unifiedDiff: uniRes.stdout,
    isBinary: false
  }
}

export async function switchBranch(dir: string, name: string, isRemote: boolean): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.includes('..') || name.startsWith('-')) {
    throw new Error('Tên nhánh không hợp lệ')
  }
  const dirty = (await runGitChecked(root, ['status', '--porcelain', '--untracked-files=no'])).trim()
  if (dirty) throw new Error('Đang có thay đổi chưa commit — hãy commit hoặc hoàn tác trước khi đổi nhánh')

  const target = isRemote ? name.replace(/^[^/]+\//, '') : name
  await runGitChecked(root, ['switch', target])
  return `Đã chuyển sang nhánh ${target}`
}

export async function createFlowBranch(
  dir: string,
  type: 'feature' | 'fix' | 'bugfix' | 'hotfix',
  name: string,
  carry: boolean
): Promise<string> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Tên nhánh chỉ gồm chữ thường, số và dấu gạch ngang (vd: ai-workstation)')
  }
  const baseBranch = type === 'hotfix' ? 'production' : 'main'
  const branch = `${type}/${name}`

  const dirty = (await runGitChecked(root, ['status', '--porcelain'])).trim()
  if (dirty && !carry) throw new Error('Đang có thay đổi chưa commit — bật "Mang theo thay đổi" hoặc commit trước')

  await runGitChecked(root, ['fetch', 'origin', '--prune'], { timeoutMs: 60_000 })
  const baseCheck = await runGit(root, ['rev-parse', '--verify', '--quiet', `origin/${baseBranch}`])
  if (baseCheck.code !== 0) throw new Error(`Không tìm thấy origin/${baseBranch}`)

  await runGitChecked(root, ['switch', '--no-track', '-c', branch, `origin/${baseBranch}`])
  return `Đã tạo nhánh ${branch} từ origin/${baseBranch}`
}

export async function pushBranchForMr(dir: string): Promise<{ message: string; mrUrl: string | null }> {
  const root = await getRepoRoot(dir)
  if (!root) throw new Error('Không phải Git repository')
  const branch = (await runGitChecked(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (['main', 'production', 'master', 'HEAD', ''].includes(branch)) {
    throw new Error(`Đang ở '${branch}' — chỉ push nhánh feature/fix/bugfix/hotfix/ai`)
  }
  const target = branch.startsWith('hotfix/') ? 'production' : 'main'
  await runGitChecked(root, ['push', '-u', 'origin', branch], { timeoutMs: 120_000 })

  const remoteOut = (await runGit(root, ['config', '--get', 'remote.origin.url'])).stdout.trim()
  let webUrl: string | null = null
  const sshMatch = remoteOut.match(/^[\w.-]+@([^:]+):(.+?)(\.git)?$/)
  if (sshMatch) {
    webUrl = `https://${sshMatch[1]}/${sshMatch[2]}`
  } else if (remoteOut) {
    webUrl = remoteOut.replace(/:\/\/[^/@\s]+@/, '://').replace(/\.git$/, '')
  }

  let mrUrl: string | null = null
  if (webUrl && /^https?:\/\//.test(webUrl)) {
    if (webUrl.includes('github.com')) {
      mrUrl = `${webUrl}/compare/${target}...${encodeURIComponent(branch)}?expand=1`
    } else {
      mrUrl = `${webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}&merge_request%5Btarget_branch%5D=${target}`
    }
  }
  return {
    message: `Đã push ${branch} → đích ${target}`,
    mrUrl
  }
}
