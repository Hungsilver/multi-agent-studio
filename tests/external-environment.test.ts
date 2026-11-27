import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkExternalDatabaseEnvironment, installExternalDatabaseEnvironment, isLocalDatabaseHost } from '../src/main/database/external-environment'

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: exec })
}))

describe('external database environment', () => {
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

  it('classifies local and remote hosts across engines', () => {
    expect(isLocalDatabaseHost('sqlserver', '.\\SQLEXPRESS')).toBe(true)
    expect(isLocalDatabaseHost('sqlserver', 'db.prod.local')).toBe(false)
    expect(isLocalDatabaseHost('oracle', 'localhost:1521/FREEPDB1')).toBe(true)
    expect(isLocalDatabaseHost('oracle', '(DESCRIPTION=(ADDRESS=(HOST=10.0.0.5)(PORT=1521)))')).toBe(false)
    expect(isLocalDatabaseHost('mongodb', 'mongodb://127.0.0.1:27017')).toBe(true)
    expect(isLocalDatabaseHost('mongodb', 'mongodb+srv://cluster.mongodb.net')).toBe(false)
  })

  it('skips environment check for remote hosts', async () => {
    await expect(checkExternalDatabaseEnvironment({ engine: 'mongodb', host: 'mongodb+srv://cluster.mongodb.net' }))
      .resolves.toMatchObject({ status: 'remote', canInstall: false })
    expect(exec).not.toHaveBeenCalled()
  })

  it('reports installed when local SQL Server or MongoDB is present', async () => {
    exec.mockResolvedValue({ stdout: 'installed\r\n' })
    await expect(checkExternalDatabaseEnvironment({ engine: 'sqlserver', host: '127.0.0.1' }))
      .resolves.toMatchObject({ status: 'installed', canInstall: false })
  })

  it('offers manual download and WinGet install for missing SQL Server and MongoDB, and manual download for Oracle', async () => {
    await expect(checkExternalDatabaseEnvironment({ engine: 'sqlserver', host: '127.0.0.1' }))
      .resolves.toMatchObject({ status: 'missing', canInstall: true, wingetId: 'Microsoft.SQLServer.2022.Express' })
    await expect(checkExternalDatabaseEnvironment({ engine: 'oracle', host: 'localhost:1521/FREEPDB1' }))
      .resolves.toMatchObject({ status: 'missing', canInstall: false, downloadUrl: expect.stringContaining('oracle.com') })

    await installExternalDatabaseEnvironment({ engine: 'mongodb', host: '127.0.0.1' })
    expect(exec).toHaveBeenLastCalledWith(expect.stringContaining('winget.exe'), expect.arrayContaining([
      'install', '--id', 'MongoDB.Server', '--exact', '--source', 'winget'
    ]), { windowsHide: true })
  })
})
