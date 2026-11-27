import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkPostgresEnvironment, installPostgresEnvironment } from '../src/main/database/postgres-environment'

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: exec })
}))

describe('PostgreSQL environment', () => {
  const endpoint = { host: 'localhost', port: 5432 }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    vi.stubEnv('SystemRoot', process.platform === platform.value ? 'C:\\Windows' : '/Windows')
    vi.stubEnv('LOCALAPPDATA', process.platform === platform.value ? 'C:\\Users\\test\\AppData\\Local' : '/appdata')
    exec.mockImplementation(async (_file, args: string[]) => ({ stdout: args[0] === '-NoProfile' ? 'missing\r\n' : '' }))
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it('does not check or install for a remote host', async () => {
    const remote = { ...endpoint, host: 'database.example' }
    await expect(checkPostgresEnvironment(remote)).resolves.toMatchObject({ status: 'remote', canInstall: false })
    await expect(installPostgresEnvironment(remote)).rejects.toThrow('Kiểm tra kết nối')
    expect(exec).not.toHaveBeenCalled()
  })

  it('reports installed regardless of port without probing TCP ports', async () => {
    exec.mockResolvedValue({ stdout: 'installed\r\n' })
    await expect(checkPostgresEnvironment({ host: '127.0.0.1', port: 63303 })).resolves.toMatchObject({ status: 'installed', canInstall: false })
    await expect(installPostgresEnvironment(endpoint)).rejects.toThrow('Đã cài đặt môi trường PostgreSQL')
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('reports missing WinGet and offers auto-install when local PostgreSQL is missing', async () => {
    await expect(checkPostgresEnvironment({ ...endpoint, port: 63303 })).resolves.toMatchObject({ status: 'missing', canInstall: true })
    exec.mockResolvedValueOnce({ stdout: 'missing' }).mockRejectedValueOnce(new Error('missing WinGet'))
    await expect(checkPostgresEnvironment(endpoint)).resolves.toMatchObject({ status: 'missing', canInstall: false, message: expect.stringContaining('WinGet') })
  })

  it('rechecks eligibility at install time and launches the exact package in interactive mode', async () => {
    await expect(checkPostgresEnvironment(endpoint)).resolves.toMatchObject({ status: 'missing', canInstall: true })
    expect(exec).toHaveBeenCalledTimes(2)
    await installPostgresEnvironment(endpoint)
    expect(exec).toHaveBeenCalledTimes(5)
    expect(exec).toHaveBeenLastCalledWith(expect.stringContaining('winget.exe'), expect.arrayContaining([
      'install', '--id', 'PostgreSQL.PostgreSQL.17', '--exact', '--source', 'winget', '--no-upgrade', '--interactive'
    ]), { windowsHide: true })
  })
})
