import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { connectionOptions, PostgresWorkspace } from '../database/postgres-workspace'

function credentialScope(input: ReturnType<typeof connectionOptions>): string {
  return JSON.stringify([input.host, input.port, input.user, input.ssl])
}

function resolveCredentials(input: unknown, credential: unknown): ReturnType<typeof connectionOptions> {
  const options = connectionOptions(input)
  if (options.password || credential === undefined) return options
  if (typeof credential !== 'string' || credential.length > 65_536) throw new Error('Mật khẩu đã lưu không hợp lệ.')
  try {
    const stored = JSON.parse(safeStorage.decryptString(Buffer.from(credential, 'base64')))
    if (stored.scope !== credentialScope(options)) throw new Error('Credential scope mismatch')
    return connectionOptions({ ...options, password: stored.password })
  } catch {
    throw new Error('Không dùng được mật khẩu đã lưu cho kết nối này. Hãy nhập lại mật khẩu.')
  }
}

export function registerPostgresHandlers(getWindow: () => BrowserWindow | null, workspace: PostgresWorkspace): void {
  const expected = new URL(process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')))
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    'postgres:connect': async (input, credential, replaceId) => workspace.connect(resolveCredentials(input, credential), replaceId),
    'postgres:test': async (input, credential) => {
      const probe = new PostgresWorkspace()
      try {
        await probe.connect(resolveCredentials(input, credential))
      } finally {
        await probe.close()
      }
    },
    'postgres:seal': async (input, credential) => {
      if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
        throw new Error('Kho mật khẩu mã hóa của hệ điều hành chưa sẵn sàng.')
      }
      const options = resolveCredentials(input, credential)
      if (!options.password) return undefined
      return safeStorage.encryptString(JSON.stringify({
        scope: credentialScope(options), password: options.password
      })).toString('base64')
    },
    'postgres:reveal': async (input, credential) => resolveCredentials(input, credential).password,
    'postgres:databases': (id) => workspace.databases(id),
    'postgres:disconnect': (id) => workspace.disconnect(id),
    'postgres:relations': (id) => workspace.relations(id),
    'postgres:inspect': (id, schema, relation, mode) => workspace.inspect(id, schema, relation, mode),
    'postgres:query': (id, statement) => workspace.query(id, statement)
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow()
      const frame = event.senderFrame
      if (!window || event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame) {
        throw new Error('Yêu cầu PostgreSQL không hợp lệ.')
      }
      const actual = new URL(frame.url)
      if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname) {
        throw new Error('Yêu cầu PostgreSQL không hợp lệ.')
      }
      return handler(...args)
    })
  }
}
