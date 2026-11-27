import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PostgresEndpoint, PostgresEnvironment } from '@shared/types/database'

const exec = promisify(execFile)
const loopbacks = ['127.0.0.1', '::1']
const windowsInstallCheck = `
  $hasService = Get-Service -Name 'postgres*' -ErrorAction SilentlyContinue | Select-Object -First 1
  $hasRegistry = Get-ChildItem -LiteralPath 'HKLM:\\SOFTWARE\\PostgreSQL\\Installations', 'HKLM:\\SOFTWARE\\WOW6432Node\\PostgreSQL\\Installations' -ErrorAction SilentlyContinue | Select-Object -First 1
  $hasExecutable = (Get-ChildItem -Path "$env:ProgramFiles\\PostgreSQL\\*\\bin\\postgres.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($hasService -or $hasRegistry -or $hasExecutable) { 'installed' } else { 'missing' }
`

function validateEndpoint(input: unknown): PostgresEndpoint {
  const { host, port } = (input ?? {}) as Partial<PostgresEndpoint>
  if (typeof host !== 'string' || !host.trim() || host.length > 255 || host.includes('\0') ||
      typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Host hoặc port PostgreSQL không hợp lệ.')
  }
  return { host: host.trim().toLowerCase(), port }
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

async function windowsInstallation(): Promise<'installed' | 'missing' | 'unknown'> {
  const root = process.env.SystemRoot
  if (!root || !path.isAbsolute(root)) return 'unknown'
  const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    const { stdout } = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', windowsInstallCheck], {
      windowsHide: true, timeout: 5000
    })
    const result = stdout.trim()
    return result === 'installed' || result === 'missing' ? result : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function checkPostgresEnvironment(input: unknown): Promise<PostgresEnvironment> {
  const { host } = validateEndpoint(input)
  const status = (status: PostgresEnvironment['status'], message: string): PostgresEnvironment => ({
    status, message, canInstall: false
  })
  if (host !== 'localhost' && !loopbacks.includes(host)) {
    return status('remote', 'Dùng “Kiểm tra kết nối” để xác minh máy chủ, tài khoản và database đích.')
  }

  if (process.platform !== 'win32') {
    try {
      await exec('which', ['psql'], { timeout: 3000 })
      return status('installed', 'Đã cài đặt môi trường PostgreSQL trên máy. Dùng “Kiểm tra kết nối” để xác minh port, tài khoản và database đích.')
    } catch {
      return status('missing', 'Chưa phát hiện môi trường PostgreSQL trên máy. Hãy tự cài PostgreSQL hoặc chạy container rồi dùng “Kiểm tra kết nối”.')
    }
  }

  const installed = await windowsInstallation()
  if (installed === 'installed') {
    return status('installed', 'Đã cài đặt môi trường PostgreSQL trên Windows. Dùng “Kiểm tra kết nối” để xác minh port, tài khoản và database đích.')
  }
  if (installed === 'unknown') {
    return status('unverified', 'Chưa xác định được PostgreSQL đã được cài trên Windows hay chưa. Dùng “Kiểm tra kết nối” để thử trực tiếp.')
  }

  const missing = 'Chưa phát hiện môi trường PostgreSQL trên Windows.'
  if (!await hasWinget()) {
    return status('missing', `${missing} Cần WinGet (App Installer) để hệ thống cài hộ, hoặc bạn có thể tự cài từ postgresql.org.`)
  }
  return { status: 'missing', message: missing, canInstall: true }
}

let installing = false

export async function installPostgresEnvironment(input: unknown): Promise<void> {
  if (installing) throw new Error('Trình cài đặt PostgreSQL đang chạy.')
  installing = true
  try {
    const environment = await checkPostgresEnvironment(input)
    const file = wingetPath()
    if (!environment.canInstall || !file) throw new Error(environment.message)
    try {
      await exec(file, [
        'install', '--id', 'PostgreSQL.PostgreSQL.17', '--exact', '--source', 'winget', '--no-upgrade',
        '--interactive', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements'
      ], { windowsHide: true })
    } catch (error) {
      const code = (error as { code?: number | string }).code
      const detail = typeof code === 'number' ? ` (mã 0x${(code >>> 0).toString(16)})` : ''
      throw new Error(`WinGet chưa hoàn tất cài PostgreSQL${detail}. Hãy kiểm tra bộ cài hoặc thử lại.`)
    }
  } finally {
    installing = false
  }
}
