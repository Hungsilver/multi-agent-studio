import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dropPostgresObject, listPostgresObjects, readPostgresObject } from '../src/main/database/postgres-objects'
import { quotePostgresIdentifier as quote } from '../src/shared/utils/postgres-preview'
import type { PostgresObject, PostgresObjectKind } from '../src/shared/types/database'

const connectionString = process.env.STUDIO_OBJECT_TEST_URL

describe.skipIf(!connectionString)('PostgreSQL object deletion on a live server', () => {
  const client = new Client({ connectionString })
  const schema = `ddl test "${randomUUID().slice(0, 8)}`
  const qualified = (name: string): string => `${quote(schema)}.${quote(name)}`
  let created = false

  beforeAll(async () => {
    await client.connect()
    await client.query(`CREATE SCHEMA ${quote(schema)}`)
    created = true
    await client.query(`
      CREATE TABLE ${qualified('items one')} (id integer PRIMARY KEY, name text);
      CREATE TABLE ${qualified('items two')} (id integer PRIMARY KEY);
      CREATE INDEX ${quote('search "name"')} ON ${qualified('items one')}(name);
      CREATE INDEX stale_name ON ${qualified('items one')}(id);
      CREATE FUNCTION ${qualified('compute')}(value integer) RETURNS integer LANGUAGE sql AS $$ SELECT value $$;
      CREATE FUNCTION ${qualified('compute')}(value text) RETURNS text LANGUAGE sql AS $$ SELECT value $$;
      CREATE PROCEDURE ${qualified('process')}(IN value integer, OUT output integer)
        LANGUAGE plpgsql AS $$ BEGIN output := value; END; $$;
      CREATE PROCEDURE ${qualified('process')}(value text) LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
      CREATE FUNCTION ${qualified('handle_row')}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
      CREATE TRIGGER same_name BEFORE INSERT ON ${qualified('items one')} FOR EACH ROW EXECUTE FUNCTION ${qualified('handle_row')}();
      CREATE TRIGGER same_name BEFORE INSERT ON ${qualified('items two')} FOR EACH ROW EXECUTE FUNCTION ${qualified('handle_row')}();
    `)
  })

  afterAll(async () => {
    try {
      if (created) await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`)
    } finally {
      await client.end()
    }
  })

  async function objects(): Promise<PostgresObject[]> {
    return (await listPostgresObjects(client)).filter((object) => object.schema === schema)
  }

  async function find(kind: PostgresObjectKind, name: string, matches?: (object: PostgresObject) => boolean): Promise<PostgresObject> {
    const item = (await objects()).find((object) => object.kind === kind && object.name === name && (!matches || matches(object)))
    if (!item) throw new Error(`Fixture object missing: ${kind} ${name}`)
    return item
  }

  it('removes a quoted index while keeping the table and its primary key', async () => {
    const index = await find('index', 'search "name"')
    expect(await readPostgresObject(client, index.kind, index.oid)).toMatch(/CREATE INDEX/)
    await dropPostgresObject(client, index)
    expect((await objects()).some((object) => object.oid === index.oid)).toBe(false)
    const primary = (await objects()).find((object) => object.table === 'items one' && object.detail.includes('PRIMARY KEY'))
    expect(primary).toBeDefined()
    await expect(dropPostgresObject(client, primary)).rejects.toThrow(/phụ thuộc/)
    expect((await client.query(`SELECT id FROM ${qualified('items one')}`)).rows).toEqual([])
  })

  it('drops only the selected overload and handles procedure OUT arguments', async () => {
    for (const [kind, name] of [['function', 'compute'], ['procedure', 'process']] as const) {
      const selected = await find(kind, name, (object) => object.detail.includes('integer'))
      const retained = await find(kind, name, (object) => object.detail.includes('text'))
      await dropPostgresObject(client, selected)
      const remaining = await objects()
      expect(remaining.some((object) => object.oid === selected.oid)).toBe(false)
      expect(remaining.some((object) => object.oid === retained.oid)).toBe(true)
    }
  })

  it('blocks dependent function deletion and drops a trigger only on its own table', async () => {
    const handler = await find('function', 'handle_row')
    const first = await find('trigger', 'same_name', (object) => object.table === 'items one')
    const second = await find('trigger', 'same_name', (object) => object.table === 'items two')
    await expect(dropPostgresObject(client, handler)).rejects.toThrow(/phụ thuộc/)
    await dropPostgresObject(client, first)
    const remaining = await objects()
    expect(remaining.some((object) => object.oid === first.oid)).toBe(false)
    expect(remaining.some((object) => object.oid === second.oid)).toBe(true)
    expect(remaining.some((object) => object.oid === handler.oid)).toBe(true)
  })

  it('rejects stale identities and preserves an existing user transaction', async () => {
    const stale = await find('index', 'stale_name')
    await client.query(`ALTER INDEX ${qualified('stale_name')} RENAME TO kept_name`)
    await expect(dropPostgresObject(client, stale)).rejects.toThrow(/đã thay đổi/)
    const renamed = await find('index', 'kept_name')
    await client.query('BEGIN')
    try {
      await expect(dropPostgresObject(client, renamed)).rejects.toThrow(/giao dịch/)
      expect(client.getTransactionStatus()).toBe('T')
    } finally {
      await client.query('ROLLBACK')
    }
    expect(await find('index', 'kept_name')).toEqual(renamed)
  })

  it('reads object changes committed by another connection', async () => {
    const writer = new Client({ connectionString })
    await writer.connect()
    try {
      await writer.query('BEGIN')
      await writer.query(`
        CREATE INDEX external_idx ON ${qualified('items one')}(name) WHERE name IS NOT NULL;
        CREATE FUNCTION ${qualified('external_handler')}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
        CREATE PROCEDURE ${qualified('external_procedure')}() LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
        CREATE TRIGGER external_trigger BEFORE INSERT ON ${qualified('items one')}
          FOR EACH ROW EXECUTE FUNCTION ${qualified('external_handler')}();
      `)
      expect((await objects()).some((object) => object.name.startsWith('external_'))).toBe(false)
      await writer.query('COMMIT')
      const index = await find('index', 'external_idx')
      expect(await readPostgresObject(client, index.kind, index.oid)).toMatch(/WHERE.+IS NOT NULL/)
      for (const [kind, name] of [['function', 'external_handler'], ['procedure', 'external_procedure'], ['trigger', 'external_trigger']] as const) {
        const object = await find(kind, name)
        expect(await readPostgresObject(client, object.kind, object.oid)).toContain(name)
      }
      await writer.query(`ALTER INDEX ${qualified('external_idx')} RENAME TO renamed_external_idx`)
      expect((await find('index', 'renamed_external_idx')).oid).toBe(index.oid)
      expect(await readPostgresObject(client, index.kind, index.oid)).toContain('renamed_external_idx')
      await writer.query(`DROP INDEX ${qualified('renamed_external_idx')}`)
      expect((await objects()).some((object) => object.oid === index.oid && object.kind === 'index')).toBe(false)
      await writer.query(`
        DROP TRIGGER external_trigger ON ${qualified('items one')};
        DROP FUNCTION ${qualified('external_handler')}();
        DROP PROCEDURE ${qualified('external_procedure')}();
      `)
      expect((await objects()).some((object) => object.name.startsWith('external_'))).toBe(false)
    } finally {
      await writer.end()
    }
  })
})
