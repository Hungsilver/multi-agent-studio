import { execFile } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const WIN_DIR = process.env.WINDIR || 'C:\\Windows'
const POWERSHELL_EXE = path.join(WIN_DIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export const SYSTEM_PROCS = new Set([
  'System',
  'Idle',
  'svchost',
  'lsass',
  'services',
  'wininit',
  'spoolsv',
  'smss',
  'csrss',
  'winlogon'
])

export interface ListeningPortInfo {
  localPort: number
  owningProcess: number
}

export interface WinProcessInfo {
  ProcessId: number
  ParentProcessId?: number
  Name: string
  ExecutablePath?: string | null
  CommandLine?: string | null
  CreationDateMs?: number
  WorkingSetSize?: number
  KernelModeTime?: number
  UserModeTime?: number
}

export async function getListeningPorts(): Promise<ListeningPortInfo[]> {
  const out: ListeningPortInfo[] = []
  const runNetstat = async (proto: string): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', proto], {
        timeout: 6000,
        windowsHide: true
      })
      return stdout
    } catch {
      return ''
    }
  }

  const [v4, v6] = await Promise.all([runNetstat('TCP'), runNetstat('TCPv6')])
  for (const line of `${v4}\n${v6}`.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
    if (m) {
      out.push({ localPort: parseInt(m[1], 10), owningProcess: parseInt(m[2], 10) })
    }
  }
  return out
}

export async function getWindowsProcesses(options: {
  filterPids?: number[]
  includeAllForMetrics?: boolean
  includeCommandLine?: boolean
} = {}): Promise<WinProcessInfo[]> {
  const { filterPids, includeAllForMetrics = false, includeCommandLine = true } = options
  if (!includeAllForMetrics && (!filterPids || filterPids.length === 0)) {
    return []
  }

  const cimProps = includeAllForMetrics
    ? 'ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate, WorkingSetSize, KernelModeTime, UserModeTime' +
      (includeCommandLine ? ', CommandLine' : '')
    : 'ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate' + (includeCommandLine ? ', CommandLine' : '')

  const selectProps = includeAllForMetrics
    ? 'ProcessId, ParentProcessId, Name, ExecutablePath, WorkingSetSize, KernelModeTime, UserModeTime' +
      (includeCommandLine ? ', CommandLine' : '') +
      ", @{N='CreationDateMs';E={if($_.CreationDate -is [datetime]){[int64]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds}else{0}}}"
    : 'ProcessId, ParentProcessId, Name, ExecutablePath' +
      (includeCommandLine ? ', CommandLine' : '') +
      ", @{N='CreationDateMs';E={if($_.CreationDate -is [datetime]){[int64]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds}else{0}}}"

  const filterClause =
    !includeAllForMetrics && filterPids && filterPids.length > 0
      ? `-Filter "${filterPids.filter((p) => Number.isInteger(p) && p > 0).map((p) => `ProcessId=${p}`).join(' OR ')}"`
      : ''

  if (!includeAllForMetrics && !filterClause) return []

  const psScript = `
$ProgressPreference = 'SilentlyContinue'
$items = @(Get-CimInstance Win32_Process ${filterClause} -Property ${cimProps} -ErrorAction SilentlyContinue | Select-Object ${selectProps})
if (-not $items.Count) { Write-Output '[]'; exit 0 }
$items | ConvertTo-Json -Compress
`
  try {
    const { stdout } = await execFileAsync(POWERSHELL_EXE, ['-NoProfile', '-Command', psScript], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    const trimmed = stdout.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed) as WinProcessInfo | WinProcessInfo[]
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function probeHost(
  hostname: string,
  isHttps: boolean,
  port: number,
  timeoutMs: number
): Promise<{ ok: boolean; code: number; ms: number }> {
  return new Promise((resolve) => {
    const client = isHttps ? https : http
    const startedAt = Date.now()
    let settled = false
    const done = (ok: boolean, code: number): void => {
      if (settled) return
      settled = true
      resolve({ ok, code, ms: Date.now() - startedAt })
    }

    const req = client.request(
      {
        hostname,
        port,
        path: '/',
        method: 'GET',
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: false } : {})
      },
      (res) => {
        const code = res.statusCode ?? 0
        res.resume()
        done(code > 0 && code < 500, code)
      }
    )

    req.on('timeout', () => {
      req.destroy()
      done(false, 0)
    })
    req.on('error', () => {
      done(false, 0)
    })
    req.end()
  })
}

export async function testAppHttpHealth(
  url: string,
  port: number,
  timeoutMs = 2500
): Promise<{ ok: boolean; code: number; ms: number }> {
  if (!port) {
    return { ok: false, code: 0, ms: 0 }
  }
  const isHttps = url.toLowerCase().startsWith('https:')
  const v4Budget = Math.min(1200, timeoutMs)
  const v4 = await probeHost('127.0.0.1', isHttps, port, v4Budget)
  if (v4.code > 0) return v4

  // Vite/Node often binds ::1 only on Windows; fall back cleanly to IPv6 loopback
  const v6Budget = Math.max(500, timeoutMs - v4.ms)
  const v6 = await probeHost('::1', isHttps, port, v6Budget)
  return v6.code > 0 ? v6 : v4
}

export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 4) return
  if (!(await isPidAlive(pid))) return

  let taskkillErr = ''
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      timeout: 8000,
      windowsHide: true
    })
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string; killed?: boolean }
    taskkillErr = String(e.stderr || e.stdout || e.message || (e.killed ? 'timeout' : 'taskkill thất bại')).trim()
    await new Promise((r) => setTimeout(r, 120))
    if (!(await isPidAlive(pid))) {
      return
    }
    throw new Error(`Không thể dừng tiến trình PID ${pid}: ${taskkillErr || 'Không rõ lỗi'}`)
  }

  for (let i = 0; i < 10; i++) {
    if (!(await isPidAlive(pid))) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`Tiến trình PID ${pid} vẫn đang chạy sau khi yêu cầu dừng.`)
}

export async function isPidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function stopPortOwner(port: number): Promise<string> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Port không hợp lệ: ${port}`)
  }
  const listening = await getListeningPorts()
  const hit = listening.find((c) => c.localPort === port)
  if (!hit) return `Port ${port} đã trống.`

  const owner = hit.owningProcess
  const procs = await getWindowsProcesses({ filterPids: [owner], includeCommandLine: false })
  const proc = procs[0]
  const procName = proc ? proc.Name.replace(/\.exe$/i, '') : '?'
  const exePath = String(proc?.ExecutablePath || '')

  if (owner <= 4 || SYSTEM_PROCS.has(procName) || exePath.toLowerCase().startsWith(`${WIN_DIR.toLowerCase()}\\`)) {
    throw new Error(`Port ${port} do Windows giữ (${procName}, PID ${owner}) — không tắt từ panel được.`)
  }

  await killProcessTree(owner)
  await new Promise((r) => setTimeout(r, 500))

  const after = await getListeningPorts()
  if (after.some((c) => c.localPort === port)) {
    throw new Error(`Đã tắt ${procName} (PID ${owner}) nhưng port ${port} vẫn bị giữ.`)
  }
  return `Đã tắt ${procName} (PID ${owner}) — port ${port} đã trống.`
}

export function getCpuCoreCount(): number {
  return Math.max(1, os.cpus().length)
}
