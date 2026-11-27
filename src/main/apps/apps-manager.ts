import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  AppsAlertPush,
  AppsBatchAction,
  AppsBatchResult,
  AppShareInfo,
  DevAppConfig,
  DevAppRuntime
} from '@shared/types/apps'
import { assertValidAppId, getAppsLogDir, readAppsConfig } from './apps-store'
import {
  getIisSiteEventLog,
  getIisSites,
  getIisSiteStates,
  getIisWorkerPids,
  invokeIisAdmin
} from './iis-service'
import {
  getCpuCoreCount,
  getListeningPorts,
  getWindowsProcesses,
  isPidAlive,
  killProcessTree,
  stopPortOwner,
  SYSTEM_PROCS,
  testAppHttpHealth,
  type WinProcessInfo
} from './process-inspector'

const execFileAsync = promisify(execFile)
const WIN_DIR = process.env.WINDIR || 'C:\\Windows'
const MAX_LOG_READ_BYTES = 256 * 1024

export interface AppsManagerDeps {
  getListeningPorts: typeof getListeningPorts
  getWindowsProcesses: typeof getWindowsProcesses
  killProcessTree: typeof killProcessTree
  isPidAlive: typeof isPidAlive
  stopPortOwner: typeof stopPortOwner
  testAppHttpHealth: typeof testAppHttpHealth
  getIisSites: typeof getIisSites
  getIisSiteStates: typeof getIisSiteStates
  getIisWorkerPids: typeof getIisWorkerPids
  invokeIisAdmin: typeof invokeIisAdmin
  getIisSiteEventLog: typeof getIisSiteEventLog
  spawn: (command: string, optionsOrArgs: SpawnOptions | readonly string[], maybeOptions?: SpawnOptions) => ChildProcess
  findDevTunnelExe: () => Promise<string | null>
  toolReadyGraceMs: number
  orderedPollMs: number
}

interface ActiveTunnel {
  port: number
  name: string
  pid: number
  logPath: string
  url: string | null
  startedAt: number
  timer: NodeJS.Timeout
}

interface PidRecord {
  pid: number
  createdAtMs: number
  processCreationMs: number | null
  appId: string
  dir: string
  start: string
}

interface ExitStatusEntry {
  pid: number
  code: number | null
  signal: NodeJS.Signals | null
  exitedAt: number
}

function testInRanges(port: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([lo, hi]) => port >= lo && port <= hi)
}

function readPidRecord(pidPath: string): PidRecord | null {
  if (!fs.existsSync(pidPath)) return null
  try {
    const raw = fs.readFileSync(pidPath, 'utf8').trim()
    if (!raw) return null
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10)
      return Number.isInteger(n) && n > 0
        ? { pid: n, createdAtMs: 0, processCreationMs: null, appId: '', dir: '', start: '' }
        : null
    }
    const parsed = JSON.parse(raw) as Partial<PidRecord>
    const n = Number(parsed.pid)
    if (!Number.isInteger(n) || n <= 0) return null
    return {
      pid: n,
      createdAtMs: typeof parsed.createdAtMs === 'number' ? parsed.createdAtMs : 0,
      processCreationMs: typeof parsed.processCreationMs === 'number' ? parsed.processCreationMs : null,
      appId: String(parsed.appId || ''),
      dir: String(parsed.dir || ''),
      start: String(parsed.start || '')
    }
  } catch {
    return null
  }
}

function matchesDirBoundary(textLow: string, cleanDirLow: string): boolean {
  if (!cleanDirLow || !textLow) return false
  let idx = textLow.indexOf(cleanDirLow)
  while (idx >= 0) {
    const after = textLow[idx + cleanDirLow.length]
    if (after === undefined || after === '\\' || after === '/' || after === '"' || after === "'" || after === ' ') {
      return true
    }
    idx = textLow.indexOf(cleanDirLow, idx + 1)
  }
  return false
}

function verifyPidRecord(
  rec: PidRecord | null,
  procByPid: Map<number, WinProcessInfo>,
  expectedDir?: string
): WinProcessInfo | null {
  if (!rec) return null
  const p = procByPid.get(rec.pid)
  if (!p) return null

  if (rec.processCreationMs && rec.processCreationMs > 0 && p.CreationDateMs && p.CreationDateMs > 0) {
    return Math.abs(p.CreationDateMs - rec.processCreationMs) <= 2000 ? p : null
  }
  if (rec.createdAtMs > 0 && p.CreationDateMs && p.CreationDateMs > 0) {
    return p.CreationDateMs >= rec.createdAtMs - 15_000 && p.CreationDateMs <= rec.createdAtMs + 5_000 ? p : null
  }

  // Legacy timestamp-less integer .pid or test mock without CreationDateMs:
  // only accept if dir/cmdline/start confirms identity rather than trusting bare PID alone.
  const cleanDir = (rec.dir || expectedDir || '').replace(/[\\/]+$/, '').toLowerCase()
  if (!cleanDir) return null
  const where = `${p.ExecutablePath || ''} ${p.CommandLine || ''}`.toLowerCase()
  return matchesDirBoundary(where, cleanDir) ? p : null
}

function isDescendantOf(pid: number, ancestorPid: number, procByPid: Map<number, WinProcessInfo>): boolean {
  let cur: number | undefined = pid
  const visited = new Set<number>()
  for (let i = 0; i < 16 && cur !== undefined; i++) {
    if (cur === ancestorPid) return true
    if (visited.has(cur)) return false
    visited.add(cur)
    cur = procByPid.get(cur)?.ParentProcessId
  }
  return false
}

const GENERIC_START_TOKENS = new Set([
  'cmd',
  'cmd.exe',
  'node',
  'node.exe',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'dotnet',
  'dotnet.exe',
  'run',
  'dev',
  'start',
  'watch',
  '--launch-profile',
  '--project',
  '--port',
  '-p'
])

function tokenizeStartCommand(cmd: string): string[] {
  const matches = cmd.match(/"[^"]+"|'[^']+'|\S+/g) ?? []
  return matches
    .map((m) => m.replace(/^["']|["']$/g, '').trim().toLowerCase())
    .filter((t) => t.length >= 2 && !GENERIC_START_TOKENS.has(t))
}

function getOtherSubDirs(appId: string, cleanDir: string, allApps: DevAppConfig[]): string[] {
  return allApps
    .filter((x) => x.id !== appId && x.dir)
    .map((x) => x.dir.replace(/[\\/]+$/, '').toLowerCase())
    .filter((d) => d.startsWith(`${cleanDir}\\`) || d.startsWith(`${cleanDir}/`))
}

function isProcessOwnedByApp(
  app: DevAppConfig,
  proc: WinProcessInfo,
  pidRec: PidRecord | null,
  procByPid: Map<number, WinProcessInfo>,
  allApps: DevAppConfig[]
): boolean {
  const verifiedRoot = verifyPidRecord(pidRec, procByPid, app.dir)
  if (verifiedRoot && isDescendantOf(proc.ProcessId, verifiedRoot.ProcessId, procByPid)) {
    return true
  }

  const cleanDir = app.dir.replace(/[\\/]+$/, '').toLowerCase()
  if (!cleanDir) return false

  const whereLow = `${proc.ExecutablePath || ''} ${proc.CommandLine || ''}`.toLowerCase()
  if (!matchesDirBoundary(whereLow, cleanDir)) return false

  const otherSubDirs = getOtherSubDirs(app.id, cleanDir, allApps)
  if (otherSubDirs.some((sub) => matchesDirBoundary(whereLow, sub))) {
    return false
  }

  const sameDirSiblings = allApps.filter(
    (x) => x.id !== app.id && x.dir && x.dir.replace(/[\\/]+$/, '').toLowerCase() === cleanDir
  )
  if (sameDirSiblings.length === 0) {
    return true
  }

  const siblingTokens = new Set<string>(sameDirSiblings.flatMap((s) => tokenizeStartCommand(s.start)))
  const myUniqueTokens = tokenizeStartCommand(app.start).filter((t) => !siblingTokens.has(t))
  if (myUniqueTokens.length === 0) {
    return false
  }
  const cmdLow = String(proc.CommandLine || '').toLowerCase()
  return myUniqueTokens.some((tok) => cmdLow.includes(tok))
}

async function defaultFindDevTunnelExe(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where.exe', ['devtunnel.exe'], { timeout: 3000, windowsHide: true })
    const hit = stdout.split(/\r?\n/).find((l) => l.trim())
    if (hit) return hit.trim()
  } catch {
    // try default winget path
  }
  const wingetLink = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'devtunnel.exe')
  return fs.existsSync(wingetLink) ? wingetLink : null
}

function findDotnet8Project(dir: string): string {
  const projects = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csproj'))
  if (projects.length > 1) {
    throw new Error(`Có nhiều file .csproj trong "${dir}"; hãy đặt thư mục app trỏ đúng project cần build.`)
  }
  if (projects.length === 0) {
    throw new Error(`Không tìm thấy file .csproj trong "${dir}".`)
  }
  const full = path.join(dir, projects[0])
  const content = fs.readFileSync(full, 'utf8')
  const matches = Array.from(content.matchAll(/<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/gi))
  const frameworks = matches.flatMap((m) => m[1].split(';').map((s) => s.trim()))
  if (!frameworks.includes('net8.0')) {
    throw new Error(`Project "${projects[0]}" không target net8.0.`)
  }
  return full
}

function findSolutionUpwards(dir: string): string {
  let current = path.resolve(dir)
  const localNames = new Set(
    fs
      .readdirSync(current)
      .filter((f) => f.toLowerCase().endsWith('.csproj'))
      .map((f) => path.basename(f, '.csproj'))
  )
  localNames.add(path.basename(current))

  while (current) {
    const solutions = fs
      .readdirSync(current)
      .filter((f) => {
        const ext = path.extname(f).toLowerCase()
        return ext === '.sln' || ext === '.slnx'
      })
    if (solutions.length === 1) {
      return path.join(current, solutions[0])
    }
    if (solutions.length > 1) {
      const matching = solutions.filter((s) => localNames.has(path.basename(s, path.extname(s))))
      if (matching.length === 1) return path.join(current, matching[0])
      throw new Error(`Có nhiều file solution trong "${current}", không xác định được solution chính.`)
    }
    const parent = path.dirname(current)
    if (!parent || parent === current) break
    current = parent
  }
  throw new Error(`Không tìm thấy file .sln hoặc .slnx từ thư mục "${dir}" trở lên.`)
}

export class AppsManager extends EventEmitter {
  private readonly dataDir?: string
  private readonly deps: AppsManagerDeps
  private readonly cpuPrev = new Map<string, { tsMs: number; cpuTicks: number }>()
  private readonly expectStop = new Map<string, number>()
  private readonly restartLog = new Map<string, number[]>()
  private readonly tunnels = new Map<number, ActiveTunnel>()
  private readonly exitStatus = new Map<string, ExitStatusEntry>()
  private lastSnapshot: DevAppRuntime[] = []
  private snapshotSeq = 0
  private lastAppliedSeq = 0

  constructor(dataDir?: string, deps?: Partial<AppsManagerDeps>) {
    super()
    this.dataDir = dataDir
    this.deps = {
      getListeningPorts,
      getWindowsProcesses,
      killProcessTree,
      isPidAlive,
      stopPortOwner,
      testAppHttpHealth,
      getIisSites,
      getIisSiteStates,
      getIisWorkerPids,
      invokeIisAdmin,
      getIisSiteEventLog,
      spawn: (command, optionsOrArgs, maybeOptions) =>
        typeof maybeOptions === 'object'
          ? spawn(command, optionsOrArgs as readonly string[], maybeOptions)
          : spawn(command, optionsOrArgs as SpawnOptions),
      findDevTunnelExe: defaultFindDevTunnelExe,
      toolReadyGraceMs: 2500,
      orderedPollMs: 1500,
      ...deps
    }
  }

  private emitAlert(payload: AppsAlertPush): void {
    this.emit('apps:alert', payload)
  }

  async listDevApps(includeStats?: boolean, skipWatcher = false): Promise<DevAppRuntime[]> {
    const seq = ++this.snapshotSeq
    const cfg = readAppsConfig(this.dataDir)
    const wantStats = includeStats ?? cfg.showStats
    const catPorts = new Set(cfg.apps.filter((a) => a.port > 0).map((a) => a.port))
    const allPorts = await this.deps.getListeningPorts()
    const relevantConns = allPorts.filter((c) => testInRanges(c.localPort, cfg.scanRanges) || catPorts.has(c.localPort))

    const logDir = getAppsLogDir(this.dataDir)
    const pidRecords = new Map<string, PidRecord | null>()
    for (const a of cfg.apps) {
      if (!a.iis) pidRecords.set(a.id, readPidRecord(path.join(logDir, `${a.id}.pid`)))
    }

    const hasIisApps = cfg.apps.some((a) => Boolean(a.iis))
    const pids = Array.from(new Set(relevantConns.map((c) => c.owningProcess)))
    const needFullProcessTree = cfg.apps.some((a) => !a.iis) || wantStats
    const [procsList, iisWorkers, iisSites, iisSiteStates] = await Promise.all([
      needFullProcessTree || pids.length > 0
        ? this.deps.getWindowsProcesses({
            filterPids: pids,
            includeAllForMetrics: needFullProcessTree,
            includeCommandLine: true
          })
        : Promise.resolve([] as WinProcessInfo[]),
      hasIisApps ? this.deps.getIisWorkerPids() : Promise.resolve(new Map<string, number[]>()),
      Promise.resolve(hasIisApps ? this.deps.getIisSites() : []),
      hasIisApps ? this.deps.getIisSiteStates() : Promise.resolve(new Map<string, 'Started' | 'Stopped' | 'Unknown'>())
    ])

    const procByPid = new Map<number, WinProcessInfo>()
    const childrenByPid = new Map<number, number[]>()
    for (const p of procsList) {
      procByPid.set(p.ProcessId, p)
      if (p.ParentProcessId !== undefined) {
        if (!childrenByPid.has(p.ParentProcessId)) childrenByPid.set(p.ParentProcessId, [])
        childrenByPid.get(p.ParentProcessId)!.push(p.ProcessId)
      }
    }

    const byPort = new Map<number, WinProcessInfo | undefined>()
    for (const c of relevantConns) {
      if (!byPort.has(c.localPort)) {
        byPort.set(c.localPort, procByPid.get(c.owningProcess))
      }
    }

    const claimedPorts = new Set<number>()
    const rows: DevAppRuntime[] = []

    for (const a of cfg.apps) {
      const tunnel = a.port ? this.tunnels.get(a.port) : undefined
      const tunnelUrl = tunnel?.url ?? null
      const tunnelPending = Boolean(tunnel && !tunnel.url)
      if (a.iis) {
        const proc = a.port ? byPort.get(a.port) : undefined
        const isSys = Boolean(proc && proc.ProcessId <= 4)
        const siteState = iisSiteStates.get(a.iis)
        const running = siteState === 'Started' ? true : siteState === 'Stopped' ? false : isSys
        const busy = Boolean(proc && !isSys)
        if (proc && a.port && (running || isSys)) claimedPorts.add(a.port)
        const pool = iisSites.find((s) => s.name === a.iis)?.pool ?? ''
        const workers = running && pool && iisWorkers.has(pool) ? iisWorkers.get(pool)! : []
        rows.push({
          ...a,
          known: true,
          running,
          busy,
          busyPid: busy && proc ? proc.ProcessId : 0,
          pid: running ? workers[0] ?? 0 : 0,
          processName: !running ? '' : workers.length > 0 ? 'w3wp' : 'IIS (pool rảnh)',
          pool,
          tunnelUrl,
          tunnelPending
        })
        continue
      }

      const pidRec = pidRecords.get(a.id) ?? null

      if (!a.port) {
        const verifiedRoot = verifyPidRecord(pidRec, procByPid, a.dir)
        const cleanDir = a.dir.replace(/[\\/]+$/, '').toLowerCase()
        const tp =
          verifiedRoot ??
          (cleanDir
            ? procsList.find(
                (p) =>
                  p.Name.toLowerCase() !== 'cmd.exe' &&
                  isProcessOwnedByApp(a, p, pidRec, procByPid, cfg.apps)
              )
            : undefined)
        rows.push({
          ...a,
          known: true,
          running: Boolean(tp),
          busy: false,
          busyPid: 0,
          pid: tp?.ProcessId ?? 0,
          processName: tp ? tp.Name.replace(/\.exe$/i, '') : '',
          tunnelUrl: null,
          tunnelPending: false
        })
        continue
      }

      const proc = byPort.get(a.port)
      const mine = proc ? isProcessOwnedByApp(a, proc, pidRec, procByPid, cfg.apps) : false
      if (mine) claimedPorts.add(a.port)

      rows.push({
        ...a,
        known: true,
        running: mine,
        busy: Boolean(proc && !mine),
        busyPid: proc && !mine && proc ? proc.ProcessId : 0,
        pid: mine && proc ? proc.ProcessId : 0,
        processName: proc ? proc.Name.replace(/\.exe$/i, '') : '',
        tunnelUrl,
        tunnelPending
      })
    }

    // Add unknown listening ports in scanRanges ("Khác (đang chạy)")
    const extraPorts = Array.from(byPort.keys()).sort((a, b) => a - b)
    for (const port of extraPorts) {
      if (claimedPorts.has(port)) continue
      const proc = byPort.get(port)
      if (!proc) continue
      const procName = proc.Name.replace(/\.exe$/i, '')
      const exePath = String(proc.ExecutablePath || '')
      if (SYSTEM_PROCS.has(procName) || exePath.toLowerCase().startsWith(`${WIN_DIR.toLowerCase()}\\`)) continue
      if (catPorts.has(port) && !testInRanges(port, cfg.scanRanges)) continue
      const tunnel = this.tunnels.get(port)
      rows.push({
        id: `port-${port}`,
        group: 'Khác (đang chạy)',
        name: procName,
        type: /^(node|bun|deno)$/i.test(procName) ? 'frontend' : 'backend',
        port,
        url: `http://localhost:${port}`,
        dir: '',
        start: '',
        known: false,
        running: true,
        busy: false,
        busyPid: 0,
        pid: proc.ProcessId,
        processName: procName,
        executablePath: exePath,
        tunnelUrl: tunnel?.url ?? null,
        tunnelPending: Boolean(tunnel && !tunnel.url)
      })
    }

    if (wantStats) {
      await this.attachRuntimeStats(rows, procByPid, childrenByPid)
    }

    if (!skipWatcher && seq > this.lastAppliedSeq) {
      const rowIds = new Set(rows.map((r) => r.id))
      for (const k of this.cpuPrev.keys()) {
        if (!rowIds.has(k)) this.cpuPrev.delete(k)
      }
      const nowMs = Date.now()
      for (const [k, ts] of this.expectStop.entries()) {
        if (nowMs - ts >= 120_000) this.expectStop.delete(k)
      }
      this.checkCrashAndAutoRestart(this.lastSnapshot, rows)
      this.lastAppliedSeq = seq
      this.lastSnapshot = rows
    }
    return rows
  }

  private async attachRuntimeStats(
    rows: DevAppRuntime[],
    procByPid: Map<number, WinProcessInfo>,
    childrenByPid: Map<number, number[]>
  ): Promise<void> {
    const cores = getCpuCoreCount()
    const nowMs = Date.now()
    const logDir = getAppsLogDir(this.dataDir)

    for (const r of rows) {
      if (!r.running || !r.pid) continue
      const roots = [r.pid]
      const rec = readPidRecord(path.join(logDir, `${r.id}.pid`))
      const verifiedRoot = verifyPidRecord(rec, procByPid, r.dir)
      if (verifiedRoot) roots.push(verifiedRoot.ProcessId)

      const seen = new Set<number>()
      const stack = [...roots]
      while (stack.length > 0) {
        const pid = stack.pop()!
        if (seen.has(pid) || !procByPid.has(pid)) continue
        seen.add(pid)
        for (const child of childrenByPid.get(pid) ?? []) {
          stack.push(child)
        }
      }

      let ramBytes = 0
      let cpuTicks = 0
      for (const pid of seen) {
        const p = procByPid.get(pid)!
        ramBytes += Number(p.WorkingSetSize ?? 0)
        cpuTicks += Number(p.KernelModeTime ?? 0) + Number(p.UserModeTime ?? 0)
      }

      let cpuPct: number | null = null
      const prev = this.cpuPrev.get(r.id)
      if (prev && nowMs > prev.tsMs) {
        const deltaTicks100ns = cpuTicks - prev.cpuTicks
        const elapsedTicks100ns = (nowMs - prev.tsMs) * 10_000
        cpuPct = Math.max(0, Math.round((deltaTicks100ns * 1000) / (elapsedTicks100ns * cores)) / 10)
      }
      this.cpuPrev.set(r.id, { tsMs: nowMs, cpuTicks })
      r.cpuPct = cpuPct
      r.ramMb = Math.round(ramBytes / (1024 * 1024))
    }

    const healthTargets = rows.filter((r) => r.running && r.port > 0)
    await Promise.all(
      healthTargets.map(async (r) => {
        const h = await this.deps.testAppHttpHealth(r.url, r.port)
        r.healthMs = h.ms
        r.healthCode = h.code
        r.healthOk = h.ok
      })
    )
  }

  private checkCrashAndAutoRestart(prev: DevAppRuntime[], next: DevAppRuntime[]): void {
    if (prev.length === 0) return
    const now = Date.now()
    for (const oldApp of prev) {
      if (!oldApp.running || !oldApp.known || oldApp.type === 'tool') continue
      const curApp = next.find((n) => n.id === oldApp.id)
      if (!curApp || curApp.running) continue
      const expectedAt = this.expectStop.get(oldApp.id)
      if (expectedAt && now - expectedAt < 120_000) continue

      if (curApp.autoRestart && !curApp.iis) {
        const hist = (this.restartLog.get(oldApp.id) ?? []).filter((t) => now - t < 10 * 60 * 1000)
        if (hist.length < 3) {
          this.restartLog.set(oldApp.id, [...hist, now])
          this.emitAlert({
            kind: 'auto-restart',
            appId: oldApp.id,
            title: `${oldApp.name} bị sập`,
            message: `Đang tự khởi động lại (lần ${hist.length + 1}/3 trong 10 phút).`
          })
          void this.startDevApp(oldApp.id).catch((err) => {
            this.emitAlert({
              kind: 'crash',
              appId: oldApp.id,
              title: `Không thể tự khởi động lại ${oldApp.name}`,
              message: err instanceof Error ? err.message : 'Lỗi không xác định'
            })
          })
          continue
        }
        this.emitAlert({
          kind: 'crash',
          appId: oldApp.id,
          title: `${oldApp.name} sập liên tục`,
          message: 'Đã tự khởi động lại 3 lần trong 10 phút — hãy kiểm tra Log.'
        })
        continue
      }

      this.emitAlert({
        kind: 'crash',
        appId: oldApp.id,
        title: `${oldApp.name} đã tắt`,
        message: 'App đang chạy bị dừng bất ngờ (sập hoặc tắt từ bên ngoài).'
      })
    }
  }

  async startDevApp(id: string): Promise<string> {
    const validId = assertValidAppId(id)
    const cfg = readAppsConfig(this.dataDir)
    const app = cfg.apps.find((a) => a.id === validId)
    if (!app) throw new Error(`Không tìm thấy "${validId}" trong danh mục app.`)
    if (!app.iis && (!app.dir || !fs.existsSync(app.dir))) throw new Error(`Không thấy thư mục: ${app.dir}`)
    if (!app.iis && !app.start.trim()) {
      throw new Error('App chưa có lệnh Start — bấm Sửa cấu hình để điền lệnh khởi chạy.')
    }

    const snapshot = await this.listDevApps(false, true)
    const cur = snapshot.find((x) => x.id === validId)
    if (cur?.running) return `${app.name} đang chạy rồi.`
    if (cur?.busy) throw new Error(`Port ${app.port} đang bị ${cur.processName} (PID ${cur.busyPid}) chiếm.`)
    if (app.iis) {
      await this.deps.invokeIisAdmin([app.iis], 'start')
      return `Đã khởi động site IIS ${app.iis} (port ${app.port}).`
    }

    const logDir = getAppsLogDir(this.dataDir)
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, `${validId}.log`)
    const header = `==== ${new Date().toLocaleString('vi-VN')}  ${app.start}  (${app.dir})\n`
    try {
      fs.writeFileSync(logPath, header, 'utf8')
    } catch {
      throw new Error(`File log ${validId}.log đang bị tiến trình khác giữ — bấm Stop để dọn tiến trình cũ rồi Start lại.`)
    }

    this.exitStatus.delete(validId)
    const createdAtMs = Date.now()
    const outFd = fs.openSync(logPath, 'a')
    let child: ChildProcess
    try {
      child = await new Promise<ChildProcess>((resolve, reject) => {
        const cp = this.deps.spawn(app.start, {
          cwd: app.dir,
          shell: true,
          detached: false,
          windowsHide: true,
          stdio: ['ignore', outFd, outFd]
        })
        const onEarlyError = (err: Error): void => {
          cp.off('spawn', onSpawn)
          reject(err)
        }
        const onSpawn = (): void => {
          cp.off('error', onEarlyError)
          resolve(cp)
        }
        cp.once('error', onEarlyError)
        cp.once('spawn', onSpawn)
        cp.on('exit', (code, signal) => {
          if (cp.pid) {
            this.exitStatus.set(validId, { pid: cp.pid, code, signal, exitedAt: Date.now() })
          }
        })
      })
    } finally {
      try {
        fs.closeSync(outFd)
      } catch {
        // ignore double-close
      }
    }

    child.on('error', (err) => {
      this.emitAlert({
        kind: 'crash',
        appId: validId,
        title: `${app.name} gặp lỗi tiến trình`,
        message: err.message || 'Lỗi tiến trình khi đang chạy.'
      })
    })

    if (child.pid) {
      let processCreationMs: number | null = null
      try {
        const info = await this.deps.getWindowsProcesses({ filterPids: [child.pid], includeCommandLine: false })
        if (info[0]?.CreationDateMs && info[0].CreationDateMs > 0) {
          processCreationMs = info[0].CreationDateMs
        }
      } catch {
        // fallback to createdAtMs window
      }
      const record: PidRecord = {
        pid: child.pid,
        createdAtMs,
        processCreationMs,
        appId: validId,
        dir: app.dir,
        start: app.start
      }
      fs.writeFileSync(path.join(logDir, `${validId}.pid`), JSON.stringify(record), 'utf8')
    }
    child.unref()

    return app.port ? `Đang khởi động ${app.name} (port ${app.port})…` : `Đang chạy ${app.name}…`
  }

  async stopDevApp(id: string): Promise<string> {
    const validId = assertValidAppId(id)
    this.expectStop.set(validId, Date.now())

    const snapshot = await this.listDevApps(false, true)
    const app = snapshot.find((x) => x.id === validId)
    if (!app) throw new Error(`Không có ứng dụng "${validId}".`)

    if (!app.known && app.port > 0) {
      return this.deps.stopPortOwner(app.port)
    }

    if (app.iis) {
      await this.deps.invokeIisAdmin([app.iis], 'stop')
      return `Đã dừng site IIS ${app.iis}.`
    }

    const cfg = readAppsConfig(this.dataDir)
    const logDir = getAppsLogDir(this.dataDir)
    const pidFile = path.join(logDir, `${validId}.pid`)
    const pidRec = readPidRecord(pidFile)

    const allProcs = await this.deps.getWindowsProcesses({ includeAllForMetrics: true, includeCommandLine: true })
    const procByPid = new Map<number, WinProcessInfo>()
    for (const p of allProcs) procByPid.set(p.ProcessId, p)

    const verifiedRoot = verifyPidRecord(pidRec, procByPid, app.dir)
    if (verifiedRoot) {
      await this.deps.killProcessTree(verifiedRoot.ProcessId)
    }
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile)
      } catch {
        // ignore
      }
    }

    let killedOwnedPortProc = false
    if (app.running && app.pid) {
      const portProc = procByPid.get(app.pid)
      if (portProc && isProcessOwnedByApp(app, portProc, pidRec, procByPid, cfg.apps)) {
        await this.deps.killProcessTree(app.pid)
        killedOwnedPortProc = true
      }
    }

    if (!verifiedRoot && !killedOwnedPortProc && app.busy) {
      throw new Error(
        `Port ${app.port} đang bị tiến trình khác (${app.processName || '?'}, PID ${app.busyPid}) chiếm — dùng "Giải phóng port" nếu muốn tắt.`
      )
    }

    if (app.dir) {
      const cleanDir = app.dir.replace(/[\\/]+$/, '').toLowerCase()
      const sameDirSiblings = cfg.apps.filter(
        (x) => x.id !== validId && x.dir && x.dir.replace(/[\\/]+$/, '').toLowerCase() === cleanDir
      )
      if (sameDirSiblings.length === 0) {
        const otherSubDirs = getOtherSubDirs(validId, cleanDir, cfg.apps)
        const otherVerifiedPids = new Set<number>()
        for (const other of cfg.apps) {
          if (other.id === validId || other.iis) continue
          const oRec = readPidRecord(path.join(logDir, `${other.id}.pid`))
          const oRoot = verifyPidRecord(oRec, procByPid, other.dir)
          if (oRoot) otherVerifiedPids.add(oRoot.ProcessId)
        }

        const freshProcs = await this.deps.getWindowsProcesses({ includeAllForMetrics: true, includeCommandLine: true })
        const freshMap = new Map<number, WinProcessInfo>()
        for (const p of freshProcs) freshMap.set(p.ProcessId, p)

        const lingering = freshProcs.filter((p) => {
          if (p.ProcessId <= 4 || p.ProcessId === process.pid || p.ProcessId === process.ppid) return false
          for (const oPid of otherVerifiedPids) {
            if (isDescendantOf(p.ProcessId, oPid, freshMap)) return false
          }
          const nameLow = p.Name.toLowerCase()
          const cmdLow = String(p.CommandLine || '').toLowerCase()
          const exeLow = String(p.ExecutablePath || '').toLowerCase()
          if (otherSubDirs.some((sub) => matchesDirBoundary(exeLow, sub) || matchesDirBoundary(cmdLow, sub))) {
            return false
          }
          return (
            (['node.exe', 'cmd.exe', 'dotnet.exe'].includes(nameLow) && matchesDirBoundary(cmdLow, cleanDir)) ||
            matchesDirBoundary(exeLow, cleanDir)
          )
        })
        await Promise.all(lingering.map((p) => this.deps.killProcessTree(p.ProcessId)))
      }
    }

    return app.port ? `Đã dừng ${app.name} (port ${app.port}).` : `Đã dừng ${app.name}.`
  }

  async runBatchAction(action: AppsBatchAction, ids: string[], phaseTimeoutSec = 180): Promise<AppsBatchResult> {
    if (action === 'startseq') {
      return this.startOrdered(ids, phaseTimeoutSec)
    }

    const cfg = readAppsConfig(this.dataDir)
    const iisApps = cfg.apps.filter((a) => ids.includes(a.id) && Boolean(a.iis))
    const localIds = ids.filter((id) => !iisApps.some((a) => a.id === id))
    const messages: string[] = []
    const errors: string[] = []

    if (iisApps.length > 0) {
      try {
        await this.deps.invokeIisAdmin(
          iisApps.map((a) => a.iis!),
          action
        )
        messages.push(`Đã ${action} ${iisApps.length} site IIS.`)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Lỗi thao tác IIS')
      }
    }

    if (action === 'stop' || action === 'restart') {
      for (const id of localIds) {
        try {
          messages.push(await this.stopDevApp(id))
        } catch (err) {
          errors.push(`${id}: ${err instanceof Error ? err.message : 'Lỗi Stop'}`)
        }
      }
    }

    if (action === 'restart' && localIds.length > 0) {
      await new Promise((r) => setTimeout(r, 1200))
    }

    if (action === 'start' || action === 'restart') {
      for (const id of localIds) {
        try {
          messages.push(await this.startDevApp(id))
        } catch (err) {
          errors.push(`${id}: ${err instanceof Error ? err.message : 'Lỗi Start'}`)
        }
      }
    }

    return { ok: errors.length === 0, messages, errors }
  }

  private async startOrdered(ids: string[], phaseTimeoutSec = 180): Promise<AppsBatchResult> {
    const cfg = readAppsConfig(this.dataDir)
    const picked = cfg.apps.filter((a) => ids.includes(a.id))
    const phases: Array<Array<'tool' | 'backend' | 'bff' | 'frontend'>> = [
      ['tool'],
      ['backend'],
      ['bff'],
      ['frontend']
    ]
    const known = new Set(['tool', 'backend', 'bff', 'frontend'])
    const messages: string[] = []
    const errors: string[] = []
    const logDir = getAppsLogDir(this.dataDir)

    for (const ph of phases) {
      const groupApps = picked.filter((a) => ph.includes(a.type) || (ph.includes('backend') && !known.has(a.type)))
      if (groupApps.length === 0) continue

      const waiting = new Set<string>()
      const startedAtMap = new Map<string, number>()
      for (const app of groupApps) {
        try {
          const msg = await this.startDevApp(app.id)
          messages.push(msg)
          if (!msg.includes('đang chạy rồi')) {
            waiting.add(app.id)
            startedAtMap.set(app.id, Date.now())
          }
        } catch (err) {
          errors.push(`${app.id}: ${err instanceof Error ? err.message : 'Lỗi khởi động'}`)
        }
      }

      const pollIntervalMs = ph[0] === 'tool' ? Math.min(300, this.deps.orderedPollMs) : this.deps.orderedPollMs
      const deadline = Date.now() + phaseTimeoutSec * 1000
      while (waiting.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs))
        const snap = ph[0] === 'tool' ? [] : await this.listDevApps(false, true)
        for (const appId of Array.from(waiting)) {
          const app = groupApps.find((a) => a.id === appId)!
          const pidRec = readPidRecord(path.join(logDir, `${appId}.pid`))
          const pid = pidRec?.pid ?? null
          const ex = this.exitStatus.get(appId)
          const exitedThisRun = Boolean(ex && pid !== null && ex.pid === pid)
          const alive = Boolean(app.iis) || (!exitedThisRun && pid !== null && (await this.deps.isPidAlive(pid)))

          if (ph[0] === 'tool' && app.port === 0 && !app.iis) {
            if (!alive || exitedThisRun) {
              if (exitedThisRun && ex!.code !== null && ex!.code !== 0) {
                errors.push(`${appId}: tool thoát với mã lỗi ${ex!.code} — xem log.`)
              } else if (exitedThisRun && ex!.signal) {
                errors.push(`${appId}: tool bị dừng bởi tín hiệu ${ex!.signal} — xem log.`)
              } else {
                messages.push(`${app.name} đã chạy xong.`)
              }
              waiting.delete(appId)
            } else if (Date.now() - (startedAtMap.get(appId) ?? Date.now()) >= this.deps.toolReadyGraceMs) {
              messages.push(`${app.name} đang chạy nền.`)
              waiting.delete(appId)
            }
            continue
          }

          if (snap.find((x) => x.id === appId)?.running) {
            waiting.delete(appId)
          } else if (!alive) {
            const exitHint = exitedThisRun && ex!.code !== null ? ` (mã ${ex!.code})` : ''
            errors.push(`${appId}: tiến trình đã thoát${exitHint} trước khi mở port ${app.port} — xem log.`)
            waiting.delete(appId)
          }
        }
      }

      for (const leftId of waiting) {
        const leftApp = groupApps.find((a) => a.id === leftId)
        if (leftApp && leftApp.port === 0 && !leftApp.iis) {
          errors.push(`${leftId}: quá ${phaseTimeoutSec}s tool vẫn chưa hoàn tất hoặc chưa ổn định.`)
        } else {
          errors.push(`${leftId}: quá ${phaseTimeoutSec}s chưa thấy lắng nghe port.`)
        }
      }
    }

    return { ok: errors.length === 0, messages, errors }
  }

  async runMaintenanceTask(
    id: string,
    task: 'npm-install' | 'dotnet-build',
    stopFirst = false
  ): Promise<string> {
    const validId = assertValidAppId(id)
    const cfg = readAppsConfig(this.dataDir)
    const app = cfg.apps.find((a) => a.id === validId)
    if (!app || !app.dir || !fs.existsSync(app.dir)) {
      throw new Error(`Không tìm thấy thư mục project của "${validId}".`)
    }

    let exe = ''
    let args: string[] = []
    let label = ''

    if (task === 'npm-install') {
      const pkgPath = path.join(app.dir, 'package.json')
      if (!fs.existsSync(pkgPath)) {
        throw new Error('Không tìm thấy package.json trong thư mục project.')
      }
      exe = path.join(WIN_DIR, 'System32', 'cmd.exe')
      args = ['/d', '/c', 'npm', 'install']
      label = 'npm install'
    } else {
      let target = ''
      if (app.iis) {
        target = findSolutionUpwards(app.dir)
        label = 'dotnet build solution'
      } else if (app.type === 'backend' || app.type === 'bff') {
        target = findDotnet8Project(app.dir)
        label = 'dotnet build API .NET 8'
      } else {
        throw new Error('Build chỉ hỗ trợ site IIS hoặc API backend .NET 8.')
      }
      exe = 'dotnet.exe'
      args = ['build', target]
    }

    if (stopFirst) {
      await this.stopDevApp(validId)
    }

    const logDir = getAppsLogDir(this.dataDir)
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, `${validId}-${task}.log`)
    let buildError = ''

    try {
      const { stdout, stderr } = await execFileAsync(exe, args, {
        cwd: app.dir,
        timeout: 300_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
      fs.writeFileSync(logPath, `${label}\nProject: ${app.dir}\n${stdout}\n${stderr}`, 'utf8')
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      fs.writeFileSync(
        logPath,
        `${label} FAILED\nProject: ${app.dir}\n${e.stdout || ''}\n${e.stderr || e.message || ''}`,
        'utf8'
      )
      buildError = `${label} thất bại — xem log: ${logPath}`
    }

    if (stopFirst) {
      try {
        await this.startDevApp(validId)
      } catch (restartErr) {
        const rMsg = restartErr instanceof Error ? restartErr.message : 'Khởi động lại lỗi'
        throw new Error(buildError ? `${buildError}\nKhởi động lại cũng lỗi: ${rMsg}` : `${label} xong nhưng khởi động lại lỗi: ${rMsg}`)
      }
    }

    if (buildError) throw new Error(buildError)
    return stopFirst ? `${label} hoàn tất & đã khởi động lại.` : `${label} hoàn tất (log: ${path.basename(logPath)}).`
  }

  async getAppLog(id: string, tail = 300): Promise<string> {
    const validId = assertValidAppId(id)
    const cfg = readAppsConfig(this.dataDir)
    const app = cfg.apps.find((a) => a.id === validId)
    if (app?.iis) {
      return this.deps.getIisSiteEventLog(app.iis)
    }
    const logPath = path.join(getAppsLogDir(this.dataDir), `${validId}.log`)
    if (!fs.existsSync(logPath)) {
      return '(Chưa có log — app này chưa được khởi động từ Multi-Agent Studio.)'
    }
    const fd = fs.openSync(logPath, 'r')
    let raw = ''
    let startOffset = 0
    try {
      const size = fs.fstatSync(fd).size
      const readLen = Math.min(size, MAX_LOG_READ_BYTES)
      startOffset = Math.max(0, size - readLen)
      if (readLen > 0) {
        const buf = Buffer.alloc(readLen)
        fs.readSync(fd, buf, 0, readLen, startOffset)
        raw = buf.toString('utf8')
      }
    } finally {
      fs.closeSync(fd)
    }
    if (startOffset > 0) {
      const nl = raw.indexOf('\n')
      if (nl >= 0) raw = raw.slice(nl + 1)
    }
    const lines = raw.split(/\r?\n/)
    const safeTail = Math.min(Math.max(10, tail), 2000)
    return lines.slice(Math.max(0, lines.length - safeTail)).join('\n')
  }

  clearAppLog(id: string): void {
    const validId = assertValidAppId(id)
    const logPath = path.join(getAppsLogDir(this.dataDir), `${validId}.log`)
    if (!fs.existsSync(logPath)) return
    try {
      fs.truncateSync(logPath, 0)
    } catch {
      fs.writeFileSync(logPath, '', 'utf8')
    }
  }

  async startTunnel(port: number, name: string): Promise<string> {
    if (!Number.isInteger(port) || port <= 0) throw new Error('App không có port để public.')
    const existing = this.tunnels.get(port)
    if (existing) return existing.url ? `Port ${port} đang public: ${existing.url}` : `Đang tạo tunnel cho port ${port}…`

    const exe = await this.deps.findDevTunnelExe()
    if (!exe) {
      throw new Error('Máy chưa cài devtunnel CLI (chạy `winget install -e --id Microsoft.devtunnel` hoặc cài từ aka.ms/devtunnels/download).')
    }

    const logDir = getAppsLogDir(this.dataDir)
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, `tunnel-${port}.log`)
    fs.writeFileSync(logPath, '', 'utf8')
    const fd = fs.openSync(logPath, 'a')
    let child: ChildProcess
    try {
      child = await new Promise<ChildProcess>((resolve, reject) => {
        const cp = this.deps.spawn(exe, ['host', '-p', String(port), '--allow-anonymous'], {
          detached: false,
          windowsHide: true,
          stdio: ['ignore', fd, fd]
        })
        const onEarlyErr = (err: Error): void => {
          cp.off('spawn', onSpawn)
          reject(err)
        }
        const onSpawn = (): void => {
          cp.off('error', onEarlyErr)
          resolve(cp)
        }
        cp.once('error', onEarlyErr)
        cp.once('spawn', onSpawn)
      })
    } finally {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore close error
      }
    }
    child.unref()

    const pid = child.pid ?? 0
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const t = this.tunnels.get(port)
      if (!t || t.url) return
      if (Date.now() - t.startedAt > 60_000) {
        clearInterval(t.timer)
        return
      }
      try {
        const txt = fs.readFileSync(logPath, 'utf8')
        const m = txt.match(/https:\/\/[^\s,]+\.devtunnels\.ms[^\s,]*/i)
        if (m) {
          t.url = m[0].replace(/\/+$/, '')
          this.emitAlert({
            kind: 'tunnel',
            title: `${name} đã public ra Internet`,
            message: t.url,
            url: t.url
          })
          clearInterval(t.timer)
        }
      } catch {
        // ignore read race
      }
    }, 1000)

    this.tunnels.set(port, { port, name, pid, logPath, url: null, startedAt, timer })

    child.on('error', (err) => {
      const cur = this.tunnels.get(port)
      if (!cur || cur.pid !== pid) return
      clearInterval(cur.timer)
      this.tunnels.delete(port)
      this.emitAlert({
        kind: 'crash',
        title: `Tunnel ${name} lỗi khởi chạy`,
        message: err.message || 'Không chạy được devtunnel'
      })
    })

    child.on('exit', (code) => {
      const cur = this.tunnels.get(port)
      if (!cur || cur.pid !== pid) return
      clearInterval(cur.timer)
      this.tunnels.delete(port)
      let tail = ''
      try {
        const lines = fs
          .readFileSync(logPath, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
        tail = lines.slice(-3).join(' · ')
      } catch {
        // ignore unreadable tunnel log
      }
      this.emitAlert({
        kind: 'crash',
        title: `Tunnel ${name} đã dừng`,
        message: tail || `devtunnel thoát với mã ${code ?? '?'}`
      })
    })

    return `Đang tạo tunnel công khai cho ${name} (port ${port})…`
  }

  async stopTunnel(port: number): Promise<string> {
    const t = this.tunnels.get(port)
    if (!t) return `Port ${port} không có tunnel đang chạy.`

    if (t.pid > 0) {
      try {
        await this.deps.killProcessTree(t.pid)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không dừng được tiến trình tunnel'
        throw new Error(`Không thể dừng tunnel port ${port} (${t.name}): ${msg}`)
      }
    }

    clearInterval(t.timer)
    this.tunnels.delete(port)
    return `Đã dừng public port ${port} (${t.name}).`
  }

  async stopAllTunnels(): Promise<{ stopped: number; errors: string[] }> {
    let stopped = 0
    const errors: string[] = []
    for (const port of Array.from(this.tunnels.keys())) {
      try {
        await this.stopTunnel(port)
        stopped++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(msg)
        this.emitAlert({
          kind: 'crash',
          title: `Không thể dừng tunnel port ${port}`,
          message: msg
        })
      }
    }
    return { stopped, errors }
  }

  getShareInfo(appName: string, group: string, port: number, url?: string): AppShareInfo {
    const ifaces = os.networkInterfaces()
    const ips: string[] = []
    for (const [ifaceName, list] of Object.entries(ifaces)) {
      if (!list || /vEthernet|Loopback/i.test(ifaceName)) continue
      for (const addr of list) {
        if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
          ips.push(addr.address)
        }
      }
    }
    const lanIp =
      ips.find((ip) => /^(172\.(1[6-9]|2\d|3[01])|192\.168\.|10\.)/.test(ip)) ?? ips[0] ?? 'localhost'
    const tailscaleIp = ips.find((ip) => ip.startsWith('100.')) ?? null
    const scheme = url?.toLowerCase().startsWith('https:') ? 'https' : 'http'
    const targetPort = port || 5173
    const lanUrl = `${scheme}://${lanIp}:${targetPort}`
    const tailscaleUrl = tailscaleIp ? `${scheme}://${tailscaleIp}:${targetPort}` : null
    const cleanGroup = group && group !== 'Khác (đang chạy)' ? group : appName

    const messageTemplate = [
      `Chào bạn, link test ${cleanGroup} (${appName}):`,
      `👉 ${lanUrl}`,
      tailscaleUrl ? `🌐 Link Tailscale VPN: ${tailscaleUrl}` : '',
      '',
      scheme === 'https'
        ? `Lưu ý (chỉ lần đầu khi mở link HTTPS tự ký): chọn "Nâng cao" (Advanced) -> "Tiếp tục truy cập ${lanIp} (không an toàn)".`
        : ''
    ]
      .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
      .join('\n')

    return { group: cleanGroup, appName, lanIp, tailscaleIp, lanUrl, tailscaleUrl, messageTemplate }
  }
}
