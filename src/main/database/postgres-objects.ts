import type { Client } from 'pg'
import { quotePostgresIdentifier as quote } from '@shared/utils/postgres-preview'
import type { PostgresObject, PostgresObjectKind } from '@shared/types/database'

const catalog = `
  SELECT idx.oid, 'index' AS kind, ns.nspname AS schema, idx.relname AS name, tbl.relname AS "table",
    pg_catalog.concat_ws(' · ', am.amname,
      CASE WHEN i.indisprimary THEN 'PRIMARY KEY' WHEN i.indisunique THEN 'UNIQUE' END,
      CASE WHEN NOT i.indisvalid THEN 'INVALID' END) AS detail
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace
  JOIN pg_catalog.pg_am am ON am.oid = idx.relam
  WHERE pg_catalog.has_any_column_privilege(tbl.oid, 'SELECT')

  UNION ALL

  SELECT p.oid, CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END,
    ns.nspname, p.proname, NULL, pg_catalog.pg_get_function_identity_arguments(p.oid)
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p', 'w') AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')

  UNION ALL

  SELECT t.oid, 'trigger', ns.nspname, t.tgname, tbl.relname,
    CASE t.tgenabled WHEN 'D' THEN 'DISABLED' WHEN 'R' THEN 'REPLICA' WHEN 'A' THEN 'ALWAYS' ELSE 'ENABLED' END
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class tbl ON tbl.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE NOT t.tgisinternal AND pg_catalog.has_any_column_privilege(tbl.oid, 'SELECT')
`

const visibleObjects = `
  SELECT oid, kind, schema, name, "table", detail FROM (${catalog}) AS objects
  WHERE schema <> 'information_schema' AND schema !~ '^pg_'
    AND pg_catalog.has_schema_privilege(schema, 'USAGE')
`

export async function listPostgresObjects(client: Client): Promise<PostgresObject[]> {
  const { rows } = await client.query<PostgresObject>(`
    SELECT oid::text, kind, schema, name, "table", detail
    FROM (${visibleObjects}) AS visible
    ORDER BY schema, kind, "table", name, detail, oid
  `)
  return rows
}

const deparse = {
  index: 'pg_catalog.pg_get_indexdef(oid)',
  function: 'pg_catalog.pg_get_functiondef(oid)',
  procedure: 'pg_catalog.pg_get_functiondef(oid)',
  trigger: 'pg_catalog.pg_get_triggerdef(oid, true)'
} satisfies Record<PostgresObjectKind, string>

function validateObject(kind: unknown, oid: unknown): asserts kind is PostgresObjectKind {
  if (typeof kind !== 'string' || !Object.hasOwn(deparse, kind) ||
      typeof oid !== 'string' || !/^\d{1,10}$/.test(oid) || Number(oid) > 4_294_967_295) {
    throw new Error('Đối tượng PostgreSQL không hợp lệ.')
  }
}

export async function readPostgresObject(client: Client, kind: unknown, oid: unknown): Promise<string> {
  validateObject(kind, oid)
  const { rows } = await client.query<{ ddl: string }>(`
    SELECT ${deparse[kind]} AS ddl
    FROM (${visibleObjects}) AS visible
    WHERE kind = $1 AND oid = $2::oid
  `, [kind, oid])
  const ddl = rows[0]?.ddl.trimEnd()
  if (!ddl) throw new Error('Không tìm thấy đối tượng. Hãy làm mới danh sách.')
  return ddl.endsWith(';') ? ddl : ddl + ';'
}

export async function dropPostgresObject(client: Client, selection: unknown): Promise<void> {
  if (!selection || typeof selection !== 'object') throw new Error('Đối tượng PostgreSQL không hợp lệ.')
  const requested = selection as Partial<PostgresObject>
  const { kind, oid } = requested
  validateObject(kind, oid)
  if (client.getTransactionStatus() !== 'I') throw new Error('Hãy hoàn tất giao dịch SQL đang mở trước khi xóa đối tượng.')
  const { rows } = await client.query<PostgresObject>(`
    SELECT oid::text, kind, schema, name, "table", detail
    FROM (${visibleObjects}) AS visible
    WHERE kind = $1 AND oid = $2::oid
  `, [kind, oid])
  const object = rows[0]
  if (!object || object.schema !== requested.schema || object.name !== requested.name ||
      object.table !== requested.table || object.detail !== requested.detail) {
    throw new Error('Đối tượng đã thay đổi hoặc bị xóa. Hãy làm mới danh sách rồi thử lại.')
  }
  const name = `${quote(object.schema)}.${quote(object.name)}`
  let target = name
  if (kind === 'trigger' && object.table) target = `${quote(object.name)} ON ${quote(object.schema)}.${quote(object.table)}`
  if (kind === 'function' || kind === 'procedure') target += `(${object.detail})`
  try {
    await client.query(`DROP ${kind.toUpperCase()} ${target} RESTRICT`)
  } catch (error) {
    const postgresError = error as { code?: string; detail?: string }
    if (postgresError.code === '2BP01') {
      throw new Error(`PostgreSQL chặn xóa vì còn đối tượng phụ thuộc.${postgresError.detail ? '\n' + postgresError.detail : ''}`)
    }
    throw error
  }
}
