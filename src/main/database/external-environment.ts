import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { externalDatabaseLabels } from '@shared/types/external-database'
import type { ExternalDatabaseEndpoint, ExternalDatabaseEngine, ExternalDatabaseEnvironment } from '@shared/types/external-database'

const exec = promisify(execFile)
const localHosts = new Set(['', '.', 'localhost', '127.0.0.1', '::1'])

const engineMeta: Record<ExternalDatabaseEngine, {
  wingetId?: string
  downloadUrl: string
  downloadDomain: string
  posixCommands: string[]
  windowsScript: string
}> = {
  sqlserver: {
    wingetId: 'Microsoft.SQLServer.2022.Express',
    downloadUrl: 'https://www.microsoft.com/en-us/sql-server/sql-server-downloads',
    downloadDomain: 'microsoft.com',
    posixCommands: ['sqlservr', 'sqlcmd'],
    windowsScript: `
      $hasService = Get-Service -Name 'MSSQL*' -ErrorAction SilentlyContinue | Select-Object -First 1
      $hasRegistry = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server'
      $hasExecutable = Get-ChildItem -Path "$env:ProgramFiles\\Microsoft SQL Server\\*\\MSSQL\\Binn\\sqlservr.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hasService -or $hasRegistry -or $hasExecutable) { 'installed' } else { 'missing' }
    `
  },
  oracle: {
    downloadUrl: 'https://www.oracle.com/database/technologies/oracle-database-software-downloads.html',
    downloadDomain: 'oracle.com',
    posixCommands: ['sqlplus', 'tnslsnr'],
    windowsScript: `
      $hasService = Get-Service -Name 'Oracle*' -ErrorAction SilentlyContinue | Select-Object -First 1
      $hasRegistry = Test-Path 'HKLM:\\SOFTWARE\\Oracle'
      $hasHome = [bool]$env:ORACLE_HOME -and (Test-Path $env:ORACLE_HOME)
      $hasExe = Get-Command sqlplus.exe,tnslsnr.exe -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hasService -or $hasRegistry -or $hasHome -or $hasExe) { 'installed' } else { 'missing' }
    `
  },
  mongodb: {
    wingetId: 'MongoDB.Server',
    downloadUrl: 'https://www.mongodb.com/try/download/community',
    downloadDomain: 'mongodb.com',
    posixCommands: ['mongod', 'mongosh'],
    windowsScript: `
      $hasService = Get-Service -Name 'MongoDB*' -ErrorAction SilentlyContinue | Select-Object -First 1
      $hasRegistry = Test-Path 'HKLM:\\SOFTWARE\\MongoDB'
      $hasExecutable = Get-ChildItem -Path "$env:ProgramFiles\\MongoDB\\Server\\*\\bin\\mongod.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
      $hasCmd = Get-Command mongod.exe -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hasService -or $hasRegistry -or $hasExecutable -or $hasCmd) { 'installed' } else { 'missing' }
    `
  }
}

function validateEndpoint(input: unknown): ExternalDatabaseEndpoint {
  const value = (input ?? {}) as Partial<ExternalDatabaseEndpoint>
  if (value.engine !== 'sqlserver' && value.engine !== 'oracle' && value.engine !== 'mongodb') {
    throw new Error('Loại database không hợp lệ.')
  }
  if (typeof value.host !== 'string' || value.host.length > 512 || value.host.includes('\0')) {
    throw new Error('Host database không hợp lệ.')
  }
  return { engine: value.engine, host: value.host.trim().toLowerCase() }
}

export function isLocalDatabaseHost(engine: ExternalDatabaseEngine, rawHost: string): boolean {
  let target = rawHost.trim().toLowerCase()
  if (!target) return true
  if (engine === 'sqlserver' && target.includes('\\')) {
    target = target.slice(0, target.indexOf('\\')).trim()
  } else if (engine === 'oracle') {
    const tnsMatch = /\(\s*host\s*=\s*([^)\s]+)\s*\)/i.exec(target)
    if (tnsMatch) target = tnsMatch[1].trim().toLowerCase()
    else {
      const noScheme = target.replace(/^jdbc:oracle:thin:@\/?\/?/i, '')
      target = noScheme.split(/[/:]/)[0].replace(/^\[(.*)\]$/, '$1')
    }
  } else if (engine === 'mongodb') {
    if (/^mongodb\+srv:\/\//i.test(target)) return false
    if (/^mongodb:\/\//i.test(target)) {
      try {
        target = new URL(target).hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
      } catch {
        return false
      }
    }
  }
  const machine = os.hostname().trim().toLowerCase()
  return localHosts.has(target) || (Boolean(machine) && target === machine)
}

function wingetPath(): string | undefined {
  const root = process.env.LOCALAPPDATA
  return root && path.isAbsolute(root) ? path.join(root, 'Microsoft', 'WindowsApps', 'winget.exe') : undefined
}

async function hasWinget(): Promise<boolean> {
  const file = wingetPath()
  if (!file) return false
  try {
    await exec(file, ['--version'], { windowsHide: true, timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function windowsInstallation(engine: ExternalDatabaseEngine): Promise<'installed' | 'missing' | 'unknown'> {
  const root = process.env.SystemRoot
  if (!root || !path.isAbsolute(root)) return 'unknown'
  const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    const { stdout } = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', engineMeta[engine].windowsScript], {
      windowsHide: true, timeout: 5000
    })
    const result = stdout.trim()
    return result === 'installed' || result === 'missing' ? result : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function posixInstallation(commands: string[]): Promise<boolean> {
  for (const cmd of commands) {
    try {
      await exec('which', [cmd], { timeout: 3000 })
      return true
    } catch {
      // Try next candidate command.
    }
  }
  return false
}

export async function checkExternalDatabaseEnvironment(input: unknown): Promise<ExternalDatabaseEnvironment> {
  const { engine, host } = validateEndpoint(input)
  const label = externalDatabaseLabels[engine]
  const meta = engineMeta[engine]
  if (!isLocalDatabaseHost(engine, host)) {
    return {
      status: 'remote',
      message: 'Dùng “Kiểm tra kết nối” để xác minh máy chủ, tài khoản và database đích.',
      canInstall: false
    }
  }

  if (process.platform !== 'win32') {
    const ok = await posixInstallation(meta.posixCommands)
    return ok
      ? {
          status: 'installed',
          message: `Đã cài đặt môi trường ${label} trên máy. Dùng “Kiểm tra kết nối” để xác minh port, tài khoản và database đích.`,
          canInstall: false
        }
      : {
          status: 'missing',
          message: `Chưa phát hiện môi trường ${label} trên máy. Bạn có thể tự cài từ ${meta.downloadDomain} hoặc chạy qua Docker.`,
          canInstall: false,
          downloadUrl: meta.downloadUrl
        }
  }

  const installed = await windowsInstallation(engine)
  if (installed === 'installed') {
    return {
      status: 'installed',
      message: `Đã cài đặt môi trường ${label} trên Windows. Dùng “Kiểm tra kết nối” để xác minh port, tài khoản và database đích.`,
      canInstall: false
    }
  }
  if (installed === 'unknown') {
    return {
      status: 'unverified',
      message: `Chưa xác định được ${label} đã được cài trên Windows hay chưa. Dùng “Kiểm tra kết nối” để thử trực tiếp.`,
      canInstall: false
    }
  }

  const missing = `Chưa phát hiện môi trường ${label} trên Windows.`
  const canWinget = Boolean(meta.wingetId && await hasWinget())
  if (!meta.wingetId) {
    return {
      status: 'missing',
      message: `${missing} Bạn có thể tự tải bộ cài từ ${meta.downloadDomain} hoặc chạy qua Docker.`,
      canInstall: false,
      downloadUrl: meta.downloadUrl
    }
  }
  if (!canWinget) {
    return {
      status: 'missing',
      message: `${missing} Cần WinGet (App Installer) để hệ thống cài hộ, hoặc bạn có thể tự cài từ ${meta.downloadDomain}.`,
      canInstall: false,
      downloadUrl: meta.downloadUrl,
      wingetId: meta.wingetId
    }
  }
  return {
    status: 'missing',
    message: missing,
    canInstall: true,
    downloadUrl: meta.downloadUrl,
    wingetId: meta.wingetId
  }
}

let installingEngine: ExternalDatabaseEngine | null = null

export async function installExternalDatabaseEnvironment(input: unknown): Promise<void> {
  const endpoint = validateEndpoint(input)
  if (installingEngine) throw new Error(`Trình cài đặt ${externalDatabaseLabels[installingEngine]} đang chạy.`)
  installingEngine = endpoint.engine
  try {
    const environment = await checkExternalDatabaseEnvironment(endpoint)
    const file = wingetPath()
    if (!environment.canInstall || !environment.wingetId || !file) throw new Error(environment.message)
    try {
      await exec(file, [
        'install', '--id', environment.wingetId, '--exact', '--source', 'winget', '--no-upgrade',
        '--interactive', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements'
      ], { windowsHide: true })
    } catch (error) {
      const code = (error as { code?: number | string }).code
      const detail = typeof code === 'number' ? ` (mã 0x${(code >>> 0).toString(16)})` : ''
      throw new Error(`WinGet chưa hoàn tất cài ${externalDatabaseLabels[endpoint.engine]}${detail}. Hãy kiểm tra bộ cài hoặc thử lại.`)
    }
  } finally {
    installingEngine = null
  }
}
