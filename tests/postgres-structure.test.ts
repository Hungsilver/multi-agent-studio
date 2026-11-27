import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyTableStructure, readTableStructure } from '../src/main/database/postgres-structure'
import { quotePostgresIdentifier as quote } from '../src/shared/utils/postgres-preview'
import { postgresStructureSql } from '../src/shared/utils/postgres-structure'

describe('PostgreSQL structure SQL', () => {
  it('quotes identifiers and defaults and rejects a type containing a second statement', () => {
    const target = { schema: 'test "schema"', table: 'table', revision: 'test' }
    expect(postgresStructureSql({ ...target, op: 'drop-column', column: 'column"2' }))
      .toEqual(['ALTER TABLE "test ""schema"""."table" DROP COLUMN "column""2" RESTRICT;'])
    expect(() => postgresStructureSql({ ...target, op: 'add-column', definition: { name: 'x', type: 'text; DROP TABLE y' } }))
      .toThrow(/Kiểu cột/)
    const [sql] = postgresStructureSql({ ...target, op: 'add-column', definition: { name: 'x', type: 'text', defaultValue: "a'b" } })
    expect(sql).toContain("DEFAULT E'a''b'")
  })
})

const connectionString = process.env.STUDIO_OBJECT_TEST_URL
describe.skipIf(!connectionString)('PostgreSQL structure changes on a live server', () => {
  const client = new Client({ connectionString })
  const schema = 'structure_' + randomUUID().replaceAll('-', '').slice(0, 12)
  const otherSchema = schema + '_moved'
  const table = 'parent'
  const qualified = (name: string, namespace = schema): string => `${quote(namespace)}.${quote(name)}`
  const snapshot = (name = table, namespace = schema) => readTableStructure(client, namespace, name)

  beforeAll(async () => {
    await client.connect()
    await client.query(`CREATE SCHEMA ${quote(schema)}; CREATE SCHEMA ${quote(otherSchema)};`)
  })

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE; DROP SCHEMA IF EXISTS ${quote(otherSchema)} CASCADE;`)
    } finally {
      await client.end()
    }
  })

  it('applies all six actions and blocks external foreign keys and views', async () => {
    await applyTableStructure(client, { op: 'create-table', schema, table, columns: [
      { name: 'id', type: 'bigint', primaryKey: true, identity: true, notNull: true },
      { name: 'label', type: 'text', unique: true, notNull: true, defaultValue: 'initial' }
    ] })
    await client.query(`CREATE TABLE ${qualified('child')}(parent_id bigint REFERENCES ${qualified(table)}(id));
      CREATE VIEW ${qualified('parent_view')} AS SELECT label FROM ${qualified(table)};`)
    let meta = await snapshot()
    expect(meta.columns.map((column) => column.name)).toEqual(['id', 'label'])
    expect(meta.dependencies.map((entry) => entry.definition ?? entry.name).join('\n')).toMatch(/FOREIGN KEY/)
    expect(meta.dependencies.some((entry) => entry.name.includes('parent_view'))).toBe(true)
    await expect(applyTableStructure(client, { op: 'drop-column', schema, table, column: 'id', revision: meta.revision })).rejects.toThrow(/phụ thuộc/)
    await expect(applyTableStructure(client, { op: 'drop-column', schema, table, column: 'label', revision: meta.revision })).rejects.toThrow(/phụ thuộc/)
    await expect(applyTableStructure(client, { op: 'drop-table', schema, table, revision: meta.revision })).rejects.toThrow(/phụ thuộc/)

    await applyTableStructure(client, { op: 'add-column', schema, table, revision: meta.revision,
      definition: { name: 'amount', type: 'integer', notNull: false, defaultValue: '2' } })
    meta = await snapshot()
    await client.query(`INSERT INTO ${qualified(table)} DEFAULT VALUES`)
    await client.query(`INSERT INTO ${qualified(table)}(label, amount) VALUES ('other', NULL)`)
    await expect(applyTableStructure(client, { op: 'edit-column', schema, table, revision: meta.revision,
      column: 'amount', name: 'total', type: 'bigint', notNull: true })).rejects.toThrow(/null/i)
    expect((await snapshot()).columns.some((column) => column.name === 'amount' && column.type === 'integer')).toBe(true)
    await client.query(`UPDATE ${qualified(table)} SET amount=0 WHERE amount IS NULL`)
    await applyTableStructure(client, { op: 'edit-column', schema, table, revision: meta.revision,
      column: 'amount', name: 'total', type: 'bigint', notNull: true, defaultValue: '3' })
    expect((await snapshot()).columns.find((column) => column.name === 'total')).toMatchObject({ type: 'bigint', notNull: true })
    await expect(applyTableStructure(client, { op: 'drop-table', schema, table, revision: meta.revision })).rejects.toThrow(/đã thay đổi/)

    meta = await snapshot()
    await applyTableStructure(client, { op: 'drop-column', schema, table, column: 'total', revision: meta.revision })
    expect((await snapshot()).columns.some((column) => column.name === 'total')).toBe(false)
    meta = await snapshot()
    await applyTableStructure(client, { op: 'edit-table', schema, table, revision: meta.revision, name: 'renamed', newSchema: otherSchema, comment: "owner's note" })
    expect((await snapshot('renamed', otherSchema)).comment).toBe("owner's note")
    expect((await client.query(`SELECT count(*)::int AS count FROM ${qualified('parent_view')}`)).rows[0].count).toBe(2)
    await client.query(`DROP VIEW ${qualified('parent_view')}; DROP TABLE ${qualified('child')};`)
    meta = await snapshot('renamed', otherSchema)
    await applyTableStructure(client, { op: 'drop-table', schema: otherSchema, table: 'renamed', revision: meta.revision })
    await expect(snapshot('renamed', otherSchema)).rejects.toThrow(/Không tìm thấy/)
  })
})
