import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import type { PtyCreateOptions, PtySessionInfo } from '@shared/types/workspace'
import { getEnrichedEnv } from '../system/env-resolver'

interface NodePtyInstance {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number }) => void) => void
}

interface NodePtyModule {
  spawn: (
    file: string,
    args: string[],
    options: { name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string> }
  ) => NodePtyInstance
}

interface ManagedPty {
  id: string
  title: string
  cwd: string
  backend: 'conpty' | 'pipe'
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}

export class PtyManager extends EventEmitter {
  private readonly sessions = new Map<string, ManagedPty>()

  private tryLoadNodePty(): NodePtyModule | null {
    try {
      // Dynamic require inside try/catch so ABI mismatch never crashes main process
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@lydell/node-pty') as NodePtyModule
      if (mod && typeof mod.spawn === 'function') return mod
      return null
    } catch {
      return null
    }
  }

  create(opts: PtyCreateOptions): PtySessionInfo {
    const id = opts.id || randomUUID()
    const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : process.env.USERPROFILE || process.cwd()
    const title = opts.title || 'PowerShell'
    const env = getEnrichedEnv()

    const stringEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') stringEnv[k] = v
    }

    const shellExe = opts.initialCommand || 'powershell.exe'
    const shellArgs = opts.initialCommand
      ? opts.args ?? []
      : ['-NoLogo', '-NoExit']

    const nodePty = this.tryLoadNodePty()
    if (nodePty) {
      try {
        const pty = nodePty.spawn(shellExe, shellArgs, {
          name: 'xterm-256color',
          cols: 110,
          rows: 30,
          cwd,
          env: stringEnv
        })

        pty.onData((data) => {
          this.emit('pty:data', { ptyId: id, data })
        })
        pty.onExit(({ exitCode }) => {
          this.sessions.delete(id)
          this.emit('pty:exit', { ptyId: id, exitCode })
        })

        this.sessions.set(id, {
          id,
          title,
          cwd,
          backend: 'conpty',
          write: (d) => pty.write(d),
          resize: (cols, rows) => {
            try {
              pty.resize(Math.max(20, cols), Math.max(5, rows))
            } catch {
              // ignore resize errors on closing pty
            }
          },
          kill: () => {
            try {
              // Gửi lệnh exit trước trên ConPTY để tránh AttachConsole warning từ helper node-pty khi thoát app
              pty.write('\r\nexit\r\n')
              setTimeout(() => {
                try {
                  pty.kill()
                } catch {
                  // ignore
                }
              }, 120)
            } catch {
              // ignore
            }
          }
        })

        return { id, title, cwd, backend: 'conpty' }
      } catch {
        // fallback to pipe shell below
      }
    }

    // Fallback: pipe process (works even if ConPTY native binary fails)
    const fallbackArgs = opts.initialCommand ? (opts.args ?? []) : ['-NoLogo', '-NoExit', '-Command', '-']
    const child: ChildProcessWithoutNullStreams = spawn(shellExe, fallbackArgs, {
      cwd,
      env,
      shell: false,
      windowsHide: true
    })

    child.stdout.on('data', (chunk: Buffer) => {
      this.emit('pty:data', { ptyId: id, data: chunk.toString('utf8').replace(/\n/g, '\r\n') })
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.emit('pty:data', { ptyId: id, data: chunk.toString('utf8').replace(/\n/g, '\r\n') })
    })
    child.on('close', (code) => {
      this.sessions.delete(id)
      this.emit('pty:exit', { ptyId: id, exitCode: code ?? 0 })
    })

    this.sessions.set(id, {
      id,
      title,
      cwd,
      backend: 'pipe',
      write: (d) => {
        try {
          child.stdin.write(d)
        } catch {
          // ignore
        }
      },
      resize: () => {
        // no-op for pipe fallback
      },
      kill: () => {
        try {
          if (child.pid) {
            spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
          }
        } catch {
          // ignore
        }
      }
    })

    return { id, title, cwd, backend: 'pipe' }
  }

  write(ptyId: string, data: string): void {
    this.sessions.get(ptyId)?.write(data)
  }

  resize(ptyId: string, cols: number, rows: number): void {
    this.sessions.get(ptyId)?.resize(cols, rows)
  }

  kill(ptyId: string): void {
    const s = this.sessions.get(ptyId)
    if (!s) return
    s.kill()
    this.sessions.delete(ptyId)
  }

  killAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.kill(id)
    }
  }
}
