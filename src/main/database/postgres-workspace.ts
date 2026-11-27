import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Client, Query } from 'pg'
import { dropPostgresObject, listPostgresObjects, readPostgresObject } from './postgres-objects'
import { applyTableStructure, readTableStructure } from './postgres-structure'
import { postgresCellUpdate, postgresPreviewSql, previewLimit, quotePostgresIdentifier as quote } from '@shared/utils/postgres-preview'
import type { PostgresPreviewOptions } from '@shared/utils/postgres-preview'
import type { QueryArrayConfig, QueryResultBase } from 'pg'
import type {
  PostgresAuthMethod,
  PostgresConnectionInfo,
  PostgresCellEdit,
  PostgresGridMetadata,
  PostgresObject,
  PostgresQueryResponse,
  PostgresRelation,
  PostgresResult,
  PostgresSslMode,
  PostgresTableStructure
} from '@shared/types/database'

const maxResults = 20
const maxCellLength = 8_192
const maxResultCharacters = 1_000_000

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return value
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return value.trim() || undefined
}

function readPemOrFile(value: string, label: string): string {
  if (value.includes('-----BEGIN')) return value
  try {
    return readFileSync(value, 'utf8')
  } catch {
    throw new Error(`Không thể đọc file ${label}: ${value}`)
  }
}

export interface PostgresParsedOptions extends Omit<PostgresConnectionInfo, 'id'> {
  password: string
  authMethod: PostgresAuthMethod
  sslMode: PostgresSslMode
  sslCert?: string
  sslKey?: string
  sslRootCert?: string
}

export function connectionOptions(input: unknown): PostgresParsedOptions {
  if (!input || typeof input !== 'object') throw new Error('Thông tin kết nối không hợp lệ.')
  const config = input as Record<string, unknown>
  const { port, password, ssl } = config
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Port PostgreSQL phải từ 1 đến 65535.')
  }
  if (typeof password !== 'string' || password.length > 8192 || password.includes('\0') || typeof ssl !== 'boolean') {
    throw new Error('Thông tin xác thực không hợp lệ.')
  }
  const authMethod: PostgresAuthMethod = config.authMethod === undefined ? 'password'
    : config.authMethod === 'password' || config.authMethod === 'trust' || config.authMethod === 'cert'
      ? config.authMethod
      : (() => { throw new Error('Phương thức đăng nhập PostgreSQL không hợp lệ.') })()
  const rawSslMode = config.sslMode
  const sslMode: PostgresSslMode = rawSslMode === undefined ? (ssl ? 'verify-full' : 'disable')
    : rawSslMode === 'disable' || rawSslMode === 'require' || rawSslMode === 'verify-ca' || rawSslMode === 'verify-full'
      ? rawSslMode
      : (() => { throw new Error('Chế độ SSL PostgreSQL không hợp lệ.') })()
  const sslCert = optionalText(config.sslCert, 'Client Certificate', 16_384)
  const sslKey = optionalText(config.sslKey, 'Client Key', 16_384)
  const sslRootCert = optionalText(config.sslRootCert, 'CA Root Certificate', 16_384)
  if (authMethod === 'cert' && (!sslCert || !sslKey)) {
    throw new Error('Đăng nhập bằng chứng chỉ SSL yêu cầu Client Certificate và Client Key.')
  }
  const effectiveSslMode: PostgresSslMode = authMethod === 'cert' && sslMode === 'disable' ? 'verify-full' : sslMode
  return {
    host: requireText(config.host, 'Host', 255).trim(),
    database: requireText(config.database, 'Tên database', 255),
    user: requireText(config.user, 'Người dùng', 255),
    port,
    password: authMethod === 'trust' ? '' : password,
    ssl: effectiveSslMode !== 'disable',
    authMethod,
    sslMode: effectiveSslMode,
    sslCert,
    sslKey,
    sslRootCert
  }
}

function runQuery(client: Client, text: string, values: unknown[] = [], maxRows = 500,
  cacheValues?: (values: Map<string, string>) => string | undefined): Promise<PostgresQueryResponse> {
  const startedAt = performance.now()
  const byResult = new Map<QueryResultBase, Pick<PostgresResult, 'rows' | 'truncated'> & { clipped: Map<string, string | null> }>()
  let remainingCharacters = maxResultCharacters
  let remainingCache = 2_000_000
  return new Promise((resolve, reject) => {
    const config: QueryArrayConfig<unknown[]> = {
      text,
      values,
      rowMode: 'array',
      types: { getTypeParser: () => (value: string) => value }
    }
    const query = new Query<(string | null)[]>(config)
    query.on('row', (row, result) => {
      if (!result) return
      let records = byResult.get(result)
      if (!records) {
        if (byResult.size >= maxResults) return
        records = { rows: [], truncated: false, clipped: new Map() }
        byResult.set(result, records)
      }
      if (records.rows.length >= maxRows || remainingCharacters <= 0) {
        records.truncated = true
        return
      }
      const displayRow = row.map((value, column) => {
        if (value === null) return null
        if (value.length <= maxCellLength) return value
        records.truncated = true
        const canCache = value.length <= remainingCache
        records.clipped.set(`${records.rows.length}:${column}`, canCache ? value : null)
        if (canCache) remainingCache -= value.length
        return value.slice(0, maxCellLength) + '…'
      })
      remainingCharacters -= displayRow.reduce((total, value) => total + (value?.length ?? 0) + 8, 0)
      if (remainingCharacters < 0) {
        records.truncated = true
        return
      }
      records.rows.push(displayRow)
    })
    query.on('error', reject)
    query.on('end', (result) => {
      const results: QueryResultBase[] = Array.isArray(result) ? result : [result]
      const fullValues = new Map<string, string>()
      const output = results.slice(0, maxResults).map((item, index) => {
          const records = byResult.get(item)
          const clippedCells: string[] = []
          for (const [cell, value] of records?.clipped ?? []) {
            if (Number(cell.split(':')[0]) >= (records?.rows.length ?? 0)) continue
            clippedCells.push(cell)
            if (value !== null) fullValues.set(`${index}:${cell}`, value)
          }
          return {
            command: item.command ?? '',
            rowCount: item.rowCount,
            columns: item.fields.map((field) => field.name),
            rows: records?.rows ?? [],
            truncated: records?.truncated ?? false,
            ...(clippedCells.length ? { clippedCells } : {})
          }
      })
      resolve({
        results: output,
        elapsedMs: Math.round(performance.now() - startedAt),
        omittedResults: Math.max(0, results.length - maxResults),
        valueCacheId: cacheValues?.(fullValues)
      })
    })
    client.query(query)
  })
}

export class PostgresWorkspace {
  private session: { id: string; client: Client; busy: boolean } | null = null
  private connecting: Client | null = null
  private readonly fullValues = new Map<string, { client: Client; values: Map<string, string> }>()

  private read(client: Client, sql: string, maxRows?: number): Promise<PostgresQueryResponse> {
    return runQuery(client, sql, [], maxRows, (values) => {
      if (!values.size || this.session?.client !== client) return
      while (this.fullValues.size >= 12) {
        const oldest = this.fullValues.keys().next().value
        if (oldest === undefined) break
        this.fullValues.delete(oldest)
      }
      const id = randomUUID()
      this.fullValues.set(id, { client, values })
      return id
    })
  }

  fullValue(id: unknown, token: unknown, cell: unknown): string {
    const cached = typeof token === 'string' ? this.fullValues.get(token) : undefined
    const value = this.session && this.session.id === id && cached?.client === this.session.client && typeof cell === 'string'
      ? cached.values.get(cell) : undefined
    if (value === undefined) throw new Error('Giá trị đầy đủ đã hết hạn hoặc vượt giới hạn bộ nhớ. Hãy tải lại kết quả.')
    return value
  }

  async connect(input: unknown, replaceId?: unknown): Promise<PostgresConnectionInfo> {
    const previous = this.session
    if (this.connecting || (previous && (previous.id !== replaceId || previous.busy))) {
      throw new Error('Hãy đợi thao tác hiện tại hoàn tất hoặc ngắt kết nối trước.')
    }
    if (replaceId && !previous) throw new Error('Kết nối PostgreSQL đã đóng.')
    if (previous && ['T', 'E'].includes(previous.client.getTransactionStatus() ?? '')) {
      throw new Error('Hãy COMMIT hoặc ROLLBACK trước khi chuyển database.')
    }
    const { password, ssl, authMethod: _authMethod, sslMode, sslCert, sslKey, sslRootCert, ...options } = connectionOptions(input)
    const id = randomUUID()
    const sslConfig = sslMode === 'disable'
      ? false
      : {
          rejectUnauthorized: sslMode === 'verify-ca' || sslMode === 'verify-full',
          ...(sslCert ? { cert: readPemOrFile(sslCert, 'Client Certificate') } : {}),
          ...(sslKey ? { key: readPemOrFile(sslKey, 'Client Key') } : {}),
          ...(sslRootCert ? { ca: readPemOrFile(sslRootCert, 'CA Root Certificate') } : {})
        }
    const client = new Client({
      ...options,
      password: () => password,
      ssl: sslConfig,
      application_name: 'Multi-Agent Studio',
      connectionTimeoutMillis: 8000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 120_000,
      keepAlive: true
    })
    this.connecting = client
    const forgetClient = (): void => {
      if (this.session?.client === client) this.session = null
    }
    client.on('error', forgetClient)
    client.on('end', forgetClient)
    try {
      await client.connect()
      if (this.connecting !== client) throw new Error('Đã hủy kết nối PostgreSQL.')
      this.session = { id, client, busy: false }
      this.fullValues.clear()
      await previous?.client.end().catch(() => undefined)
      return { id, ...options, ssl }
    } catch (error) {
      await client.end().catch(() => undefined)
      if ((error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED') {
        const local = ['localhost', '127.0.0.1', '::1'].includes(options.host.toLowerCase())
        throw new Error(local
          ? `Không có máy chủ PostgreSQL phản hồi ở ${options.host}:${options.port}. Kiểm tra đã cài và khởi động PostgreSQL hoặc container, rồi đối chiếu port.`
          : `Máy chủ ${options.host}:${options.port} từ chối kết nối. Kiểm tra host, port và dịch vụ PostgreSQL.`)
      }
      throw error
    } finally {
      if (this.connecting === client) this.connecting = null
    }
  }

  async disconnect(id: unknown): Promise<void> {
    const session = this.session
    if (!session || session.id !== id) return
    this.session = null
    this.fullValues.clear()
    await session.client.end()
  }

  async close(): Promise<void> {
    const clients = new Set([this.session?.client, this.connecting])
    this.session = null
    this.fullValues.clear()
    this.connecting = null
    await Promise.all([...clients].map((client) => client?.end().catch(() => undefined)))
  }

  private async withClient<T>(id: unknown, operation: (client: Client) => Promise<T>): Promise<T> {
    const session = this.session
    if (!session || session.id !== id) throw new Error('Kết nối PostgreSQL đã đóng. Hãy kết nối lại.')
    if (session.busy) throw new Error('PostgreSQL đang xử lý một thao tác khác.')
    session.busy = true
    try {
      return await operation(session.client)
    } finally {
      session.busy = false
    }
  }

  async relations(id: unknown): Promise<PostgresRelation[]> {
    return this.withClient(id, async (client) => {
      const result = await client.query<PostgresRelation>(`
        SELECT n.nspname AS schema, c.relname AS name,
          CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
            WHEN 'f' THEN 'foreign table' ELSE 'table' END AS kind
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
        ORDER BY n.nspname, c.relname
      `)
      return result.rows
    })
  }

  async databases(id: unknown): Promise<string[]> {
    return this.withClient(id, async (client) => {
      const result = await client.query<{ datname: string }>(`
        SELECT datname FROM pg_catalog.pg_database
        WHERE datallowconn AND NOT datistemplate
          AND pg_catalog.has_database_privilege(oid, 'CONNECT')
        ORDER BY datname
      `)
      return result.rows.map(({ datname }) => datname)
    })
  }

  objects(id: unknown): Promise<PostgresObject[]> {
    return this.withClient(id, listPostgresObjects)
  }

  objectDefinition(id: unknown, kind: unknown, oid: unknown): Promise<string> {
    return this.withClient(id, (client) => readPostgresObject(client, kind, oid))
  }

  dropObject(id: unknown, object: unknown): Promise<void> {
    return this.withClient(id, (client) => dropPostgresObject(client, object))
  }

  tableStructure(id: unknown, schema: unknown, table: unknown): Promise<PostgresTableStructure> {
    const schemaName = requireText(schema, 'Schema', 255)
    const tableName = requireText(table, 'Tên bảng', 255)
    return this.withClient(id, (client) => readTableStructure(client, schemaName, tableName))
  }

  applyStructure(id: unknown, change: unknown): Promise<void> {
    return this.withClient(id, (client) => applyTableStructure(client, change))
  }

  async inspect(id: unknown, schema: unknown, relation: unknown, mode: unknown): Promise<PostgresQueryResponse> {
    const schemaName = requireText(schema, 'Schema', 255)
    const relationName = requireText(relation, 'Tên bảng', 255)
    if (mode !== 'data' && mode !== 'columns') throw new Error('Chế độ xem bảng không hợp lệ.')
    if (mode === 'data') return this.browse(id, schemaName, relationName, {})
    return this.withClient(id, (client) => {
      return runQuery(client, `
        SELECT a.attname AS "Column", pg_catalog.format_type(a.atttypid, a.atttypmod) AS "Type",
          NOT a.attnotnull AS "Nullable",
          pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS "Default"
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
      `, [schemaName, relationName])
    })
  }

  private async gridMetadata(client: Client, schema: string, table: string): Promise<PostgresGridMetadata> {
    const result = await client.query<{ name: string; category: string; primary: boolean; editable: boolean }>(`
      SELECT a.attname AS name, t.typcategory AS category,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_index i
          CROSS JOIN LATERAL pg_catalog.unnest(i.indkey) WITH ORDINALITY AS key_column(attnum, position)
          WHERE i.indrelid = c.oid AND i.indisprimary AND key_column.position <= i.indnkeyatts AND key_column.attnum = a.attnum
        ) AS primary,
        (c.relkind IN ('r', 'p') AND (c.relkind = 'p' OR NOT c.relhassubclass)
          AND a.attgenerated = '' AND a.attidentity = ''
          AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'UPDATE')) AS editable
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `, [schema, table])
    const kinds = { S: 'string', N: 'number', D: 'temporal', B: 'boolean' } as const
    return {
      columns: Object.fromEntries(result.rows.map(({ name, category, primary, editable }) => [
        name, { kind: kinds[category as keyof typeof kinds] ?? 'other', editable: editable && !primary }
      ])),
      primaryKey: result.rows.filter((column) => column.primary).map((column) => column.name)
    }
  }

  private gridOptions(input: unknown, grid: PostgresGridMetadata): PostgresPreviewOptions {
    if (!input || typeof input !== 'object') throw new Error('Bộ lọc không hợp lệ.')
    const { sort, filters = [] } = input as PostgresPreviewOptions
    const column = (name: unknown): PostgresGridMetadata['columns'][string] => {
      if (typeof name !== 'string' || !Object.hasOwn(grid.columns, name)) throw new Error('Cột không hợp lệ.')
      return grid.columns[name]
    }
    if (sort) {
      column(sort.column)
      if (sort.direction !== 'ASC' && sort.direction !== 'DESC') throw new Error('Thứ tự sắp xếp không hợp lệ.')
    }
    if (!Array.isArray(filters) || filters.length > Object.keys(grid.columns).length) throw new Error('Bộ lọc không hợp lệ.')
    return {
      sort,
      filters: filters.map((filter) => {
        const { kind } = column(filter.column)
        const isString = kind === 'string'
        const operator = filter.operator ?? (isString ? 'contains' : '=')
        const operators = kind === 'number' || kind === 'temporal' ? ['=', '<', '>', '<=', '>=', 'between'] : isString ? ['contains', '='] : ['=']
        if (!operators.includes(operator)) throw new Error('Toán tử lọc không phù hợp với kiểu cột.')
        const value = requireText(filter.value, 'Giá trị lọc', 1000)
        const end = operator === 'between' ? requireText(filter.end, 'Giá trị cuối khoảng lọc', 1000) : undefined
        return { column: filter.column, value, isString, operator, end }
      })
    }
  }

  async browse(id: unknown, schema: unknown, table: unknown, options: unknown): Promise<PostgresQueryResponse> {
    const schemaName = requireText(schema, 'Schema', 255)
    const tableName = requireText(table, 'Tên bảng', 255)
    return this.withClient(id, async (client) => {
      const grid = await this.gridMetadata(client, schemaName, tableName)
      const result = await this.read(client, postgresPreviewSql(schemaName, tableName, this.gridOptions(options, grid)), previewLimit)
      const stringColumns = Object.entries(grid.columns).filter(([, column]) => column.kind === 'string').map(([name]) => name)
      return { ...result, grid, stringColumns }
    })
  }

  async saveCell(id: unknown, schema: unknown, table: unknown, edit: unknown): Promise<void> {
    const schemaName = requireText(schema, 'Schema', 255)
    const tableName = requireText(table, 'Tên bảng', 255)
    if (!edit || typeof edit !== 'object') throw new Error('Thay đổi không hợp lệ.')
    const cell = edit as PostgresCellEdit
    const valueValid = (value: unknown): boolean => value === null || (typeof value === 'string' && value.length <= 2_000_000 && !value.includes('\0'))
    if (!valueValid(cell.value) || !valueValid(cell.original) || !cell.keys || typeof cell.keys !== 'object') throw new Error('Giá trị cập nhật không hợp lệ.')
    return this.withClient(id, async (client) => {
      if (client.getTransactionStatus() !== 'I') throw new Error('Hãy hoàn tất giao dịch SQL đang mở trước khi lưu ô.')
      await client.query('BEGIN')
      try {
        await client.query(`LOCK TABLE ${quote(schemaName)}.${quote(tableName)} IN ROW EXCLUSIVE MODE`)
        const grid = await this.gridMetadata(client, schemaName, tableName)
        if (!Object.hasOwn(grid.columns, cell.column) || !grid.columns[cell.column].editable || !grid.primaryKey.length ||
            grid.primaryKey.some((key) => !Object.hasOwn(cell.keys, key) || typeof cell.keys[key] !== 'string' || !valueValid(cell.keys[key]))) {
          throw new Error('Cột hoặc khóa chính không hỗ trợ cập nhật.')
        }
        const { statement, values } = postgresCellUpdate(schemaName, tableName, grid.primaryKey, cell)
        const result = await client.query(statement, values)
        if (result.rowCount !== 1) throw new Error('Dòng đã thay đổi hoặc bị xóa. Hãy tải lại bảng trước khi sửa.')
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    })
  }

  async exportRows(id: unknown, schema: unknown, table: unknown, options: unknown,
    write: (columns: string[], rows: (string | null)[][]) => Promise<void>): Promise<void> {
    const schemaName = requireText(schema, 'Schema', 255)
    const tableName = requireText(table, 'Tên bảng', 255)
    return this.withClient(id, async (client) => {
      if (client.getTransactionStatus() !== 'I') throw new Error('Hãy hoàn tất giao dịch SQL đang mở trước khi xuất.')
      await client.query('BEGIN READ ONLY')
      try {
        const grid = await this.gridMetadata(client, schemaName, tableName)
        const sql = postgresPreviewSql(schemaName, tableName, this.gridOptions(options, grid), false)
        await client.query(`DECLARE studio_export NO SCROLL CURSOR FOR ${sql}`)
        for (;;) {
          const batch = await client.query<(string | null)[]>({
            text: 'FETCH FORWARD 100 FROM studio_export', rowMode: 'array',
            types: { getTypeParser: () => (value: string) => value }
          })
          await write(batch.fields.map((field) => field.name), batch.rows)
          if (batch.rows.length < 100) break
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    })
  }

  async query(id: unknown, statement: unknown): Promise<PostgresQueryResponse> {
    const sql = requireText(statement, 'Câu SQL', 250_000)
    return this.withClient(id, (client) => this.read(client, sql))
  }
}
