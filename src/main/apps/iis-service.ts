import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { IisSiteBinding, IisSiteInfo } from '@shared/types/apps'
import { readAppsConfig, writeAppsConfig } from './apps-store'

const execFileAsync = promisify(execFile)

const WIN_DIR = process.env.WINDIR || 'C:\\Windows'
const IIS_CONFIG_FILE = path.join(WIN_DIR, 'System32', 'inetsrv', 'config', 'applicationHost.config')
const APPCMD_EXE = path.join(WIN_DIR, 'System32', 'inetsrv', 'appcmd.exe')
const POWERSHELL_EXE = path.join(WIN_DIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

let cachedSites: { mtimeMs: number; sites: IisSiteInfo[] } | null = null

export function isIisInstalled(): boolean {
  return fs.existsSync(IIS_CONFIG_FILE)
}

function expandWinEnv(raw: string): string {
  return raw.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] ?? `%${key}%`)
}

function extractAttr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, 'i')
  const m = tag.match(re)
  return m ? m[1] : ''
}

export function parseApplicationHostXml(xmlText: string): IisSiteInfo[] {
  const sitesSectionMatch = xmlText.match(/<sites>([\s\S]*?)<\/sites>/i)
  if (!sitesSectionMatch) return []
  const body = sitesSectionMatch[1]

  const sites: IisSiteInfo[] = []
  const siteRe = /<site\b([^>]*)>([\s\S]*?)<\/site>/gi
  let m: RegExpExecArray | null
  while ((m = siteRe.exec(body)) !== null) {
    const siteAttrs = m[1]
    const siteInner = m[2]
    const name = extractAttr(siteAttrs, 'name')
    const id = parseInt(extractAttr(siteAttrs, 'id') || '0', 10) || 0
    if (!name) continue

    let pool = ''
    let physicalPath = ''
    const defaultsMatch = siteInner.match(/<applicationDefaults\b([^>]*)\/?\s*>/i)
    const defaultPool = defaultsMatch ? extractAttr(defaultsMatch[1], 'applicationPool') : ''
    const appMatch = siteInner.match(/<application\b([^>]*path="\/"[^>]*)>([\s\S]*?)<\/application>/i)
    if (appMatch) {
      pool = extractAttr(appMatch[1], 'applicationPool') || defaultPool || 'DefaultAppPool'
      const vdMatch = appMatch[2].match(/<virtualDirectory\b([^>]*path="\/"[^>]*)\/?\s*>/i)
      if (vdMatch) {
        physicalPath = expandWinEnv(extractAttr(vdMatch[1], 'physicalPath'))
      }
    }

    const bindings: IisSiteBinding[] = []
    const bindRe = /<binding\b([^>]*)\/?\s*>/gi
    let bm: RegExpExecArray | null
    while ((bm = bindRe.exec(siteInner)) !== null) {
      const protocol = extractAttr(bm[1], 'protocol').toLowerCase()
      if (protocol !== 'http' && protocol !== 'https') continue
      const info = extractAttr(bm[1], 'bindingInformation')
      const parts = info.split(':')
      if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
        bindings.push({
          protocol,
          port: parseInt(parts[1], 10),
          host: parts[2] ?? ''
        })
      }
    }

    const localBinds = bindings.filter((b) => !b.host || b.host.toLowerCase() === 'localhost')
    const sorted = [...localBinds].sort((a, b) => Number(b.protocol === 'https') - Number(a.protocol === 'https'))
    const main = sorted[0] ?? bindings[0]
    sites.push({
      name,
      id,
      pool,
      physicalPath,
      bindings,
      port: main?.port ?? 0,
      url: main ? `${main.protocol}://localhost:${main.port}` : ''
    })
  }
  return sites
}

export function getIisSites(): IisSiteInfo[] {
  if (!isIisInstalled()) return []
  try {
    const stat = fs.statSync(IIS_CONFIG_FILE)
    if (cachedSites && cachedSites.mtimeMs === stat.mtimeMs) {
      return cachedSites.sites
    }
    const xml = fs.readFileSync(IIS_CONFIG_FILE, 'utf8')
    const parsed = parseApplicationHostXml(xml)
    cachedSites = { mtimeMs: stat.mtimeMs, sites: parsed }
    return parsed
  } catch {
    return []
  }
}

export async function getIisWorkerPids(): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>()
  try {
    const { stdout } = await execFileAsync('netsh.exe', ['http', 'show', 'servicestate', 'view=requestq'], {
      timeout: 5000,
      windowsHide: true
    })
    let queue: string | null = null
    let inProcs = false
    for (const line of stdout.split(/\r?\n/)) {
      const qm = line.match(/^Request queue name:\s*(.+?)\s*$/)
      if (qm) {
        queue = qm[1]
        inProcs = false
        if (!map.has(queue)) map.set(queue, [])
        continue
      }
      if (!queue) continue
      if (/^\s+Processes:\s*$/.test(line)) {
        inProcs = true
        continue
      }
      const pm = line.match(/^\s+ID:\s*(\d+)/)
      if (inProcs && pm) {
        map.get(queue)!.push(parseInt(pm[1], 10))
        continue
      }
      if (inProcs && !/^\s+ID:/.test(line)) {
        inProcs = false
      }
    }
  } catch {
    // ignore if HTTP service unavailable
  }
  return map
}

export function parseAppcmdSiteList(output: string): Map<string, 'Started' | 'Stopped' | 'Unknown'> {
  const states = new Map<string, 'Started' | 'Stopped' | 'Unknown'>()
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/SITE\s+"([^"]+)"\s+\(([^)]*)\)/i)
    if (!m) continue
    const siteName = m[1]
    const meta = m[2]
    const stateMatch = meta.match(/\bstate:(Started|Stopped)\b/i)
    if (stateMatch) {
      states.set(siteName, stateMatch[1].toLowerCase() === 'started' ? 'Started' : 'Stopped')
    } else {
      states.set(siteName, 'Unknown')
    }
  }
  return states
}

export async function getIisSiteStates(
  runCmd: (file: string, args: string[], opts: { timeout: number; windowsHide: boolean }) => Promise<{ stdout: string }> = execFileAsync
): Promise<Map<string, 'Started' | 'Stopped' | 'Unknown'>> {
  if (!fs.existsSync(APPCMD_EXE) && runCmd === execFileAsync) {
    return new Map()
  }
  try {
    const { stdout } = await runCmd(APPCMD_EXE, ['list', 'site'], {
      timeout: 5000,
      windowsHide: true
    })
    return parseAppcmdSiteList(stdout)
  } catch {
    return new Map()
  }
}

export interface IisSiteCommand {
  site: string
  args: string[]
  ignoreNotRunning?: boolean
}

/** Xây lệnh appcmd chỉ tác động đúng site được chọn, không dừng hoặc recycle application pool dùng chung. */
export function buildIisSiteCommands(sites: IisSiteInfo[], action: 'start' | 'stop' | 'restart'): IisSiteCommand[] {
  const cmds: IisSiteCommand[] = []
  for (const site of sites) {
    if (action === 'start') {
      cmds.push({ site: site.name, args: ['start', 'site', `/site.name:${site.name}`] })
    } else if (action === 'stop') {
      cmds.push({ site: site.name, args: ['stop', 'site', `/site.name:${site.name}`] })
    } else {
      cmds.push({ site: site.name, args: ['stop', 'site', `/site.name:${site.name}`], ignoreNotRunning: true })
      cmds.push({ site: site.name, args: ['start', 'site', `/site.name:${site.name}`] })
    }
  }
  return cmds
}

export interface InvokeIisAdminOptions {
  getSites?: () => IisSiteInfo[]
  runElevated?: (
    script: string,
    resultPath: string
  ) => Promise<{ exitCode: number; cancelled?: boolean; stderr?: string }>
}

export async function invokeIisAdmin(
  siteNames: string[],
  action: 'start' | 'stop' | 'restart',
  options?: InvokeIisAdminOptions
): Promise<void> {
  if (siteNames.length === 0) return
  const allSites = (options?.getSites ?? getIisSites)()
  const selectedSites: IisSiteInfo[] = []
  for (const name of siteNames) {
    const site = allSites.find((s) => s.name === name)
    if (!site) throw new Error(`IIS không có site "${name}"`)
    selectedSites.push(site)
  }

  const cmds = buildIisSiteCommands(selectedSites, action)
  const quotePs = (v: string): string => `'${v.replace(/'/g, "''")}'`
  const appCmdQ = quotePs(APPCMD_EXE)
  const resultPath = path.join(os.tmpdir(), `aict-iis-${process.pid}-${crypto.randomUUID()}.json`)
  const resultQ = quotePs(resultPath)

  const psSteps = cmds.map((c) => {
    const argsLiteral = c.args.map(quotePs).join(', ')
    const siteQ = quotePs(c.site)
    const ignoreCheck = c.ignoreNotRunning
      ? `$code -ne 0 -and $code -ne 1062 -and ($out -notmatch 'already stopped|not started|is not running')`
      : '$code -ne 0'
    return [
      `$out = (& ${appCmdQ} ${argsLiteral} 2>&1 | Out-String).Trim()`,
      '$code = $LASTEXITCODE',
      `if (${ignoreCheck}) {`,
      `  @{ ok = $false; site = ${siteQ}; exitCode = $code; output = $out } | ConvertTo-Json -Compress | Set-Content -Path ${resultQ} -Encoding UTF8`,
      '  exit $code',
      '}'
    ].join('\n')
  })

  const innerScript = [
    ...psSteps,
    `@{ ok = $true } | ConvertTo-Json -Compress | Set-Content -Path ${resultQ} -Encoding UTF8`,
    'exit 0'
  ].join('\n')

  const defaultRunElevated = async (
    script: string
  ): Promise<{ exitCode: number; cancelled?: boolean; stderr?: string }> => {
    const encodedInner = Buffer.from(script, 'utf16le').toString('base64')
    const psExeQ = quotePs(POWERSHELL_EXE)
    const launcher = `$p = Start-Process -FilePath ${psExeQ} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-EncodedCommand','${encodedInner}' -ErrorAction Stop; exit $p.ExitCode`
    try {
      await execFileAsync(POWERSHELL_EXE, ['-NoProfile', '-Command', launcher], {
        timeout: 60_000,
        windowsHide: true
      })
      return { exitCode: 0 }
    } catch (err: unknown) {
      const e = err as { code?: number | string; stderr?: string; message?: string }
      const rawMsg = `${e.stderr || ''} ${e.message || ''}`
      if (/1223|canceled by the user|was canceled/i.test(rawMsg)) {
        return { exitCode: 1223, cancelled: true, stderr: rawMsg.trim() }
      }
      return {
        exitCode: typeof e.code === 'number' && e.code !== 0 ? e.code : 1,
        stderr: rawMsg.trim()
      }
    }
  }

  try {
    const runRes = await (options?.runElevated ?? defaultRunElevated)(innerScript, resultPath)
    if (runRes.cancelled) {
      throw new Error('Đã hủy — thao tác IIS cần quyền Administrator (bấm Yes ở hộp UAC).')
    }

    if (fs.existsSync(resultPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, '')) as {
          ok?: boolean
          site?: string
          exitCode?: number
          output?: string
        }
        if (parsed.ok === false) {
          throw new Error(
            `Lỗi IIS (${parsed.site || siteNames.join(', ')}, mã ${parsed.exitCode ?? runRes.exitCode}): ${parsed.output || 'appcmd thất bại'}`
          )
        }
      } catch (readErr) {
        if (readErr instanceof Error && readErr.message.startsWith('Lỗi IIS (')) {
          throw readErr
        }
      }
    }

    if (runRes.exitCode !== 0) {
      throw new Error(
        `Lỗi thực thi lệnh IIS (mã ${runRes.exitCode}): ${runRes.stderr || 'Không rõ nguyên nhân'}`
      )
    }
  } finally {
    try {
      if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath)
    } catch {
      // ignore cleanup error
    }
  }
}

export async function getIisSiteEventLog(siteName: string, max = 40): Promise<string> {
  const site = getIisSites().find((s) => s.name === siteName)
  if (!site) throw new Error(`IIS không có site "${siteName}"`)
  const safeMax = Math.min(Math.max(1, max), 100)
  const q = (v: string): string => `'${v.replace(/'/g, "''")}'`
  const script = `
$siteId = ${site.id}
$sitePath = ${q(site.physicalPath || '')}
$pool = ${q(site.pool || '')}
$events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 1,2,3; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 2000 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProviderName -match 'ASP\\.NET|IIS|W3SVC|WAS|\\.NET Runtime|Application Error' -and (
      $_.Message -match "W3SVC/$siteId/" -or
      ($sitePath -and $_.Message.IndexOf($sitePath, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      ($pool -and $_.Message.IndexOf($pool, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    )
  } | Select-Object -First ${safeMax})
if (-not $events.Count) { Write-Output ''; exit 0 }
($events | ForEach-Object {
  "==== " + $_.TimeCreated.ToString('dd/MM HH:mm:ss') + "  [" + $_.LevelDisplayName + "] " + $_.ProviderName + " #" + $_.Id + "\`n" +
  (($_.Message -split "\`r?\`n" | Where-Object { $_.Trim() } | Select-Object -First 25) -join "\`n")
}) -join "\`n\`n"
`
  const header = `Site IIS: ${site.name} · pool ${site.pool} · ${site.url}\nThư mục: ${site.physicalPath}\nLog lỗi Windows Event Log (7 ngày gần nhất):\n`
  try {
    const { stdout } = await execFileAsync(POWERSHELL_EXE, ['-NoProfile', '-Command', script], {
      timeout: 20_000,
      windowsHide: true
    })
    return stdout.trim() ? `${header}\n${stdout.trim()}` : `${header}\n(Không có lỗi nào được ghi cho site này.)`
  } catch {
    return `${header}\n(Không đọc được Windows Event Log.)`
  }
}

export function addIisSitesToCatalog(
  siteNames: string[],
  dataDir?: string
): { added: number; updated: number } {
  const allSites = getIisSites()
  const cfg = readAppsConfig(dataDir)
  let added = 0
  let updated = 0

  for (const name of siteNames) {
    const site = allSites.find((s) => s.name === name)
    if (!site) throw new Error(`IIS không có site "${name}"`)
    const id = `iis-${site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
    const obj = {
      id,
      group: 'IIS',
      name: site.name,
      type: 'backend' as const,
      iis: site.name,
      port: site.port,
      url: site.url,
      dir: site.physicalPath,
      start: ''
    }
    const existingIdx = cfg.apps.findIndex((a) => a.id === id)
    if (existingIdx >= 0) {
      cfg.apps[existingIdx] = obj
      updated++
    } else {
      cfg.apps.push(obj)
      added++
    }
  }

  const activeIds = new Set(cfg.apps.map((a) => a.id))
  cfg.removed = cfg.removed.filter((r) => !activeIds.has(r.id))
  writeAppsConfig(cfg, dataDir)
  return { added, updated }
}
