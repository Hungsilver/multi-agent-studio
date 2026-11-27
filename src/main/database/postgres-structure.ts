import { createHash } from 'node:crypto'
import type { Client } from 'pg'
import type { PostgresStructureChange, PostgresTableStructure } from '@shared/types/database'
import { quotePostgresIdentifier as quote } from '@shared/utils/postgres-preview'
import { postgresStructureSql } from '@shared/utils/postgres-structure'

export async function readTableStructure(client: Client, schema: string, table: string): Promise<PostgresTableStructure> {
  const identity = await client.query<{ oid: string; comment: string | null }>(`
    SELECT c.oid::text, pg_catalog.obj_description(c.oid, 'pg_class') AS comment
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p')
      AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  `, [schema, table])
  const relation = identity.rows[0]
  if (!relation) throw new Error('Không tìm thấy bảng PostgreSQL. Hãy làm mới danh sách.')
  const columns = await client.query<PostgresTableStructure['columns'][number]>(`
    SELECT a.attname AS name, a.attnum AS number, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS "notNull", pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS "defaultSql",
      a.attgenerated <> '' AS generated, a.attidentity <> '' AS identity
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [relation.oid])
  const dependencies = await client.query<PostgresTableStructure['dependencies'][number]>(`
    WITH constraints AS (
      SELECT pg_catalog.format('%I.%I · %I', n.nspname, c.relname, x.conname) AS name,
        pg_catalog.pg_get_constraintdef(x.oid) AS definition,
        COALESCE(CASE WHEN x.conrelid = $1::oid THEN x.conkey END, '{}'::smallint[]) ||
        COALESCE(CASE WHEN x.contype = 'f' AND x.confrelid = $1::oid THEN x.confkey END, '{}'::smallint[]) AS columns
      FROM pg_catalog.pg_constraint x
      JOIN pg_catalog.pg_class c ON c.oid = x.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE x.conrelid = $1::oid OR (x.contype = 'f' AND x.confrelid = $1::oid)
    ), related AS (
      SELECT pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid) AS name,
        NULL::text AS definition, array_agg(DISTINCT d.refobjsubid::smallint ORDER BY d.refobjsubid::smallint) AS columns
      FROM pg_catalog.pg_depend d
      LEFT JOIN pg_catalog.pg_class c ON d.classid = 'pg_catalog.pg_class'::regclass AND c.oid = d.objid
      LEFT JOIN pg_catalog.pg_attrdef a ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND a.oid = d.objid
      WHERE d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = $1::oid
        AND (c.relkind IN ('i', 'I', 'S', 'r', 'p', 'm', 'v', 'f')
          OR d.classid IN ('pg_catalog.pg_trigger'::regclass, 'pg_catalog.pg_rewrite'::regclass, 'pg_catalog.pg_statistic_ext'::regclass)
          OR (a.adnum <> d.refobjsubid AND d.refobjsubid > 0))
      GROUP BY d.classid, d.objid, d.objsubid
    )
    SELECT * FROM constraints UNION ALL SELECT * FROM related ORDER BY name, definition, columns
  `, [relation.oid])
  const structure = { columns: columns.rows, comment: relation.comment, dependencies: dependencies.rows }
  const revision = createHash('sha256').update(JSON.stringify([relation.oid, structure])).digest('hex')
  return { ...structure, revision }
}

export async function applyTableStructure(client: Client, input: unknown): Promise<void> {
  const statements = postgresStructureSql(input)
  if (!statements.length) throw new Error('Chưa có thay đổi cấu trúc.')
  const change = input as PostgresStructureChange
  if (client.getTransactionStatus() !== 'I') throw new Error('Hãy hoàn tất giao dịch SQL đang mở trước khi sửa cấu trúc.')
  if (change.op !== 'create-table' && !/^[a-f0-9]{64}$/.test(change.revision ?? '')) throw new Error('Hãy tải lại cấu trúc bảng.')
  await client.query('BEGIN')
  try {
    if (change.op !== 'create-table') {
      const target = `${quote(change.schema)}.${quote(change.table)}`
      await client.query(`LOCK TABLE ${target} IN ACCESS EXCLUSIVE MODE`)
      const current = await readTableStructure(client, change.schema, change.table)
      if (current.revision !== change.revision) throw new Error('Cấu trúc hoặc ràng buộc đã thay đổi. Hãy tải lại bảng để kiểm tra trước khi áp dụng.')
      if (change.op === 'edit-column' && (change.type !== undefined || change.defaultValue !== undefined)) {
        const column = current.columns.find((item) => item.name === change.column)
        if (column?.generated || column?.identity) throw new Error('Cột generated/identity cần được chỉnh kiểu hoặc mặc định bằng SQL riêng.')
      }
    }
    for (const statement of statements) await client.query(statement)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    const pg = error as { code?: string; message?: string; detail?: string }
    if (pg.code && pg.message) {
      const message = pg.code === '2BP01' ? 'PostgreSQL chặn thay đổi vì còn đối tượng phụ thuộc. ' + pg.message : pg.message
      throw new Error(pg.detail ? message + '\n' + pg.detail : message)
    }
    throw error
  }
}
