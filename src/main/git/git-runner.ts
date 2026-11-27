import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

let cachedGitExe: string | null = null

export function findGitExe(): string {
  if (cachedGitExe && fs.existsSync(cachedGitExe)) return cachedGitExe
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedGitExe = c
      return c
    }
  }
  cachedGitExe = 'git'
  return 'git'
}

export function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; stdin?: string } = {}
): Promise<GitRunResult> {
  const exe = findGitExe()
  const timeoutMs = options.timeoutMs ?? 60_000

  return new Promise((resolve) => {
    if (options.stdin !== undefined) {
      const child = spawn(exe, args, {
        cwd,
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
        shell: false
      })
      const outChunks: Buffer[] = []
      const errChunks: Buffer[] = []
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
          resolve({ code: -1, stdout: Buffer.concat(outChunks).toString('utf8'), stderr: 'git timeout' })
        }
      }, timeoutMs)

      child.stdout.on('data', (d: Buffer) => outChunks.push(d))
      child.stderr.on('data', (d: Buffer) => errChunks.push(d))
      child.on('error', (err) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve({ code: -1, stdout: '', stderr: err.message })
        }
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve({
            code: code ?? -1,
            stdout: Buffer.concat(outChunks).toString('utf8'),
            stderr: Buffer.concat(errChunks).toString('utf8')
          })
        }
      })
      child.stdin.write(options.stdin, 'utf8')
      child.stdin.end()
      return
    }

    execFile(
      exe,
      args,
      {
        cwd,
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8'
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
          return
        }
        const anyErr = err as NodeJS.ErrnoException & { code?: number | string }
        const code = typeof anyErr.code === 'number' ? anyErr.code : 1
        resolve({ code, stdout: stdout ?? '', stderr: stderr || err.message })
      }
    )
  })
}

export async function runGitChecked(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; stdin?: string } = {}
): Promise<string> {
  const res = await runGit(cwd, args, options)
  if (res.code !== 0) {
    throw new Error((res.stderr || res.stdout || `git ${args[0]} failed (${res.code})`).trim())
  }
  return res.stdout
}

export async function getRepoRoot(dir: string): Promise<string | null> {
  if (!dir || !fs.existsSync(dir)) return null
  const res = await runGit(dir, ['rev-parse', '--show-toplevel'], { timeoutMs: 10_000 })
  if (res.code !== 0) return null
  return path.resolve(res.stdout.trim())
}

export function resolveSafeRepoPath(root: string, relPath: string): string {
  const base = path.resolve(root)
  const full = path.resolve(base, relPath)
  if (!full.toLowerCase().startsWith((base.endsWith(path.sep) ? base : base + path.sep).toLowerCase()) && full.toLowerCase() !== base.toLowerCase()) {
    throw new Error(`Đường dẫn ngoài repository: ${relPath}`)
  }
  return full
}
