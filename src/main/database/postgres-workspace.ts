import { randomUUID } from 'node:crypto'
import { Client, escapeIdentifier, Query } from 'pg'
import type { QueryArrayConfig, QueryResultBase } from 'pg'
import type {
  PostgresConnectionInfo,
  PostgresQueryResponse,
  PostgresRelation,
  PostgresResult
} from '@shared/types/database'

const maxResults = 20
const maxCellLength = 8_192
const maxResultCharacters = 1_000_000
const previewLimit = 100

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || value.includes('\0')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return value
}

export function connectionOptions(input: unknown): Omit<PostgresConnectionInfo, 'id'> & { password: string } {
  if (!input || typeof input !== 'object') throw new Error('Thông tin kết nối không hợp lệ.')
  const config = input as Record<string, unknown>
  const { port, password, ssl } = config
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Port PostgreSQL phải từ 1 đến 65535.')
  }
  if (typeof password !== 'string' || password.length > 8192 || password.includes('\0') || typeof ssl !== 'boolean') {
    throw new Error('Thông tin xác thực không hợp lệ.')
  }
  return {
    host: requireText(config.host, 'Host', 255).trim(),
    database: requireText(config.database, 'Tên database', 255),
    user: requireText(config.user, 'Người dùng', 255),
    port,
    password,
    ssl
  }
}

function runQuery(client: Client, text: string, values: unknown[] = [], maxRows = 500): Promise<PostgresQueryResponse> {
  const startedAt = performance.now()
  const byResult = new Map<QueryResultBase, Pick<PostgresResult, 'rows' | 'truncated'>>()
  let remainingCharacters = maxResultCharacters
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
        records = { rows: [], truncated: false }
        byResult.set(result, records)
      }
      if (records.rows.length >= maxRows || remainingCharacters <= 0) {
        records.truncated = true
        return
      }
      const displayRow = row.map((value) => {
        if (value === null) return null
        if (value.length <= maxCellLength) return value
        records.truncated = true
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
      resolve({
        results: results.slice(0, maxResults).map((item) => ({
          command: item.command ?? '',
          rowCount: item.rowCount,
          columns: item.fields.map((field) => field.name),
          rows: byResult.get(item)?.rows ?? [],
          truncated: byResult.get(item)?.truncated ?? false
        })),
        elapsedMs: Math.round(performance.now() - startedAt),
        omittedResults: Math.max(0, results.length - maxResults)
      })
    })
    client.query(query)
  })
}

export class PostgresWorkspace {
  private session: { id: string; client: Client; busy: boolean } | null = null
  private connecting: Client | null = null

  async connect(input: unknown, replaceId?: unknown): Promise<PostgresConnectionInfo> {
    const previous = this.session
    if (this.connecting || (previous && (previous.id !== replaceId || previous.busy))) {
      throw new Error('Hãy đợi thao tác hiện tại hoàn tất hoặc ngắt kết nối trước.')
    }
    if (replaceId && !previous) throw new Error('Kết nối PostgreSQL đã đóng.')
    if (previous && ['T', 'E'].includes(previous.client.getTransactionStatus() ?? '')) {
      throw new Error('Hãy COMMIT hoặc ROLLBACK trước khi chuyển database.')
    }
    const { password, ssl, ...options } = connectionOptions(input)
    const id = randomUUID()
    const client = new Client({
      ...options,
      password: () => password,
      ssl: ssl ? { rejectUnauthorized: true } : false,
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
    await session.client.end()
  }

  async close(): Promise<void> {
    const clients = new Set([this.session?.client, this.connecting])
    this.session = null
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

  async inspect(id: unknown, schema: unknown, relation: unknown, mode: unknown): Promise<PostgresQueryResponse> {
    const schemaName = requireText(schema, 'Schema', 255)
    const relationName = requireText(relation, 'Tên bảng', 255)
    if (mode !== 'data' && mode !== 'columns') throw new Error('Chế độ xem bảng không hợp lệ.')
    return this.withClient(id, (client) => {
      if (mode === 'data') {
        return runQuery(client,
          `SELECT * FROM ${escapeIdentifier(schemaName)}.${escapeIdentifier(relationName)} LIMIT ${previewLimit + 1}`,
          [], previewLimit
        )
      }
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

  async query(id: unknown, statement: unknown): Promise<PostgresQueryResponse> {
    const sql = requireText(statement, 'Câu SQL', 250_000)
    return this.withClient(id, (client) => runQuery(client, sql))
  }
}
