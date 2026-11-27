import fs from 'node:fs'
import path from 'node:path'
import type { FileTreeEntry, WorkspaceFileContent } from '@shared/types/workspace'

const IGNORED_ENTRIES = new Set([
  'node_modules',
  '.git',
  '.ai-coding-worktrees',
  'dist',
  'out',
  'release',
  '.vite',
  '.next',
  'bin',
  'obj'
])

const MAX_READ_BYTES = 2 * 1024 * 1024 // 2 MB

function resolveSafePath(rootDir: string, relPath: string): { root: string; target: string; relNormalized: string } {
  if (!rootDir) {
    throw new Error('Workspace path trống')
  }
  const root = path.resolve(rootDir)
  const cleaned = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const target = path.resolve(root, cleaned)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Không được phép truy cập đường dẫn ngoài phạm vi workspace')
  }
  return { root, target, relNormalized: relative.replace(/\\/g, '/') }
}

export function listWorkspaceDirectory(rootDir: string, relDir = ''): FileTreeEntry[] {
  const { target } = resolveSafePath(rootDir, relDir)
  if (!fs.existsSync(target)) {
    return []
  }
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) {
    return []
  }

  const entries = fs.readdirSync(target, { withFileTypes: true })
  const items: FileTreeEntry[] = []

  for (const ent of entries) {
    if (IGNORED_ENTRIES.has(ent.name)) continue
    const full = path.join(target, ent.name)
    const isDir = ent.isDirectory()
    let size = 0
    if (!isDir) {
      try {
        size = fs.statSync(full).size
      } catch {
        size = 0
      }
    }
    const rel = relDir ? `${relDir.replace(/\\/g, '/').replace(/\/+$/, '')}/${ent.name}` : ent.name
    items.push({
      name: ent.name,
      relPath: rel,
      isDir,
      size
    })
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return items
}

function readFileContentInternal(target: string, relNormalized: string): WorkspaceFileContent {
  if (!fs.existsSync(target)) {
    throw new Error(`Không tìm thấy file: ${relNormalized}`)
  }
  const stat = fs.statSync(target)
  if (stat.isDirectory()) {
    throw new Error('Đường dẫn là thư mục, không phải file')
  }

  if (stat.size > MAX_READ_BYTES) {
    return {
      relPath: relNormalized,
      content: '',
      size: stat.size,
      isBinary: false,
      tooLarge: true
    }
  }

  const fd = fs.openSync(target, 'r')
  try {
    const sampleSize = Math.min(stat.size, 8192)
    const probe = Buffer.alloc(sampleSize)
    if (sampleSize > 0) {
      fs.readSync(fd, probe, 0, sampleSize, 0)
    }
    if (probe.includes(0)) {
      return {
        relPath: relNormalized,
        content: '',
        size: stat.size,
        isBinary: true,
        tooLarge: false
      }
    }
  } finally {
    fs.closeSync(fd)
  }

  const content = fs.readFileSync(target, 'utf8')
  return {
    relPath: relNormalized,
    content,
    size: stat.size,
    isBinary: false,
    tooLarge: false
  }
}

export function readWorkspaceFile(rootDir: string, relPath: string): WorkspaceFileContent {
  const { target, relNormalized } = resolveSafePath(rootDir, relPath)
  if (!relNormalized) {
    throw new Error(`Không tìm thấy file: ${relPath}`)
  }
  return readFileContentInternal(target, relNormalized)
}

const EXTERNAL_PREVIEW_EXTS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.log', '.html', '.htm', '.svg',
  '.json', '.yml', '.yaml', '.toml', '.xml', '.csv',
  '.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.py', '.go', '.rs', '.java', '.cs', '.sh', '.ps1', '.sql'
])

export function readExternalPreviewFile(absPath: string): WorkspaceFileContent {
  const cleaned = absPath.replace(/^file:\/\//i, '').replace(/^\/([a-zA-Z]:[\\/])/, '$1')
  const resolved = path.resolve(cleaned)
  const ext = path.extname(resolved).toLowerCase()
  if (!EXTERNAL_PREVIEW_EXTS.has(ext)) {
    throw new Error(`Không hỗ trợ mở file ngoài workspace với định dạng "${ext || 'không rõ'}"`)
  }
  return readFileContentInternal(resolved, resolved.replace(/\\/g, '/'))
}

export function writeWorkspaceFile(
  rootDir: string,
  relPath: string,
  content: string
): { relPath: string; size: number; updatedAt: string } {
  const { target, relNormalized } = resolveSafePath(rootDir, relPath)
  if (!relNormalized) {
    throw new Error('Đường dẫn file không hợp lệ')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
  const stat = fs.statSync(target)
  return {
    relPath: relNormalized,
    size: stat.size,
    updatedAt: new Date().toISOString()
  }
}
