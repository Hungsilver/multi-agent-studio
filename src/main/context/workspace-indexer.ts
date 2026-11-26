import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AiAttachment } from '@shared/types/ai'
import { getRepoRoot, runGit } from '../git/git-runner'
import { getDefaultDataDir } from '../storage/database'

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'bin', 'obj', '.ai-coding-worktrees'])

function walkFilesFallback(dir: string, base: string, acc: string[], limit: number): void {
  if (acc.length >= limit) return
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (acc.length >= limit) return
      if (IGNORE_DIRS.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      const rel = path.relative(base, full).replace(/\\/g, '/')
      if (ent.isDirectory()) {
        walkFilesFallback(full, base, acc, limit)
      } else {
        acc.push(rel)
      }
    }
  } catch {
    // ignore
  }
}

export async function searchWorkspaceFiles(dir: string, query: string): Promise<string[]> {
  if (!dir || !fs.existsSync(dir)) return []
  let files: string[] = []

  const root = await getRepoRoot(dir)
  if (root) {
    const res = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard'], { timeoutMs: 8000 })
    if (res.code === 0) {
      files = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('.ai-coding-worktrees'))
    }
  }

  if (files.length === 0) {
    walkFilesFallback(dir, dir, files, 1500)
  }

  const q = query.trim().toLowerCase()
  if (!q) return files.slice(0, 30)

  const scored = files
    .map((f) => {
      const low = f.toLowerCase()
      const idx = low.indexOf(q)
      if (idx === -1) return null
      const basenameMatch = path.basename(low).includes(q) ? 0 : 1
      return { f, score: basenameMatch * 1000 + idx }
    })
    .filter((x): x is { f: string; score: number } => Boolean(x))
    .sort((a, b) => a.score - b.score || a.f.length - b.f.length)

  return scored.slice(0, 30).map((x) => x.f)
}

export function saveClipboardImage(sessionId: string, base64DataUrl: string): AiAttachment {
  const m = base64DataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/)
  if (!m) throw new Error('Định dạng ảnh clipboard không hợp lệ')
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace(/\+xml$/, '')
  const buf = Buffer.from(m[2], 'base64')
  const dir = path.join(getDefaultDataDir(), 'attachments', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const filename = `img-${Date.now()}-${randomUUID().slice(0, 6)}.${ext}`
  const full = path.join(dir, filename)
  fs.writeFileSync(full, buf)

  return {
    id: randomUUID(),
    type: 'image',
    label: filename,
    path: full
  }
}
