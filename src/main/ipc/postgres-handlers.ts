import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { clipboard, dialog, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import type { PostgresExportFormat, PostgresExportPage } from '@shared/types/database'
import { checkExternalDatabaseEnvironment, installExternalDatabaseEnvironment } from '../database/external-environment'
import { checkPostgresEnvironment, installPostgresEnvironment } from '../database/postgres-environment'
import { exportPostgresFile, exportPostgresText, type WritePostgresRows } from '../database/postgres-export'
import { connectionOptions, PostgresWorkspace } from '../database/postgres-workspace'
import type { ExternalDatabaseWorkspace } from '../database/external-workspace'

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

function exportFormat(format: unknown): PostgresExportFormat {
  if (format === 'csv' || format === 'json') return format
  throw new Error('Định dạng xuất dữ liệu không hợp lệ.')
}

function includeExportHeaders(source: unknown): boolean {
  return !(source && typeof source === 'object' && 'includeHeaders' in source && source.includeHeaders === false)
}

function exportReader(workspace: PostgresWorkspace, id: unknown, source: unknown): (write: WritePostgresRows) => Promise<void> {
  if (!source || typeof source !== 'object') throw new Error('Yêu cầu xuất dữ liệu không hợp lệ.')
  return async (write) => {
    if ('schema' in source && 'table' in source && 'options' in source) {
      await workspace.exportRows(id, source.schema, source.table, source.options, write)
      return
    }
    const page = source as PostgresExportPage
    if (!Array.isArray(page.columns) || !Array.isArray(page.rows) || !page.columns.every((name) => typeof name === 'string') ||
        !page.rows.every((row) => Array.isArray(row) && row.length === page.columns.length && row.every((value) => value === null || typeof value === 'string'))) {
      throw new Error('Dữ liệu xuất không hợp lệ.')
    }
    for (const cell of page.clippedCells ?? []) {
      const [row, column] = cell.split(':').map(Number)
      const originalRow = page.rowIndexes?.[row] ?? row
      if (page.rows[row]?.[column] === undefined || !Number.isSafeInteger(originalRow) || originalRow < 0) {
        throw new Error('Ô xuất dữ liệu không hợp lệ.')
      }
      page.rows[row][column] = workspace.fullValue(id, page.valueCacheId, `${page.resultIndex}:${originalRow}:${column}`)
    }
    await write(page.columns, page.rows)
  }
}

export function registerPostgresHandlers(getWindow: () => BrowserWindow | null, workspace: PostgresWorkspace, external: ExternalDatabaseWorkspace): void {
  const expected = new URL(process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')))
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    'postgres:check-environment': checkPostgresEnvironment,
    'postgres:install-environment': installPostgresEnvironment,
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
    'postgres:query': (id, statement) => workspace.query(id, statement),
    'postgres:objects': (id) => workspace.objects(id),
    'postgres:object-definition': (id, kind, oid) => workspace.objectDefinition(id, kind, oid),
    'postgres:drop-object': (id, object) => workspace.dropObject(id, object),
    'postgres:table-structure': (id, schema, table) => workspace.tableStructure(id, schema, table),
    'postgres:apply-structure': (id, change) => workspace.applyStructure(id, change),
    'database:connect': (input) => external.connect(input),
    'database:test': (input) => external.test(input),
    'database:check-environment': checkExternalDatabaseEnvironment,
    'database:install-environment': installExternalDatabaseEnvironment,
    'database:disconnect': (id) => external.disconnect(id),
    'database:resources': (id) => external.list(id),
    'database:preview': (id, resource) => external.preview(id, resource),
    'database:query': (id, sql, resource) => external.query(id, sql, resource),
    'postgres:browse': (id, schema, table, options) => workspace.browse(id, schema, table, options),
    'postgres:cell': async (id, token, cell) => workspace.fullValue(id, token, cell),
    'postgres:save-cell': (id, schema, table, edit) => workspace.saveCell(id, schema, table, edit),
    'postgres:export-clipboard': async (id, format, source) => {
      clipboard.writeText(await exportPostgresText(exportFormat(format), exportReader(workspace, id, source), includeExportHeaders(source)))
    },
    'postgres:export': async (id, requestedFormat, source, target = 'file') => {
      const window = getWindow()
      if (!window || (target !== 'file' && target !== 'clipboard')) {
        throw new Error('Yêu cầu xuất dữ liệu không hợp lệ.')
      }
      const format = exportFormat(requestedFormat)
      const read = exportReader(workspace, id, source)
      const includeHeaders = includeExportHeaders(source)
      if (target === 'clipboard') {
        clipboard.writeText(await exportPostgresText(format, read, includeHeaders))
        return true
      }
      const destination = await dialog.showSaveDialog(window, {
        title: 'Xuất kết quả PostgreSQL',
        defaultPath: `postgres-results.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
      })
      if (destination.canceled || !destination.filePath) return false
      await exportPostgresFile(destination.filePath, format, read, includeHeaders)
      return true
    }
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow()
      const frame = event.senderFrame
      if (!window || event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame) {
        throw new Error('Yêu cầu database không hợp lệ.')
      }
      const actual = new URL(frame.url)
      if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname) {
        throw new Error('Yêu cầu database không hợp lệ.')
      }
      return handler(...args)
    })
  }
}
