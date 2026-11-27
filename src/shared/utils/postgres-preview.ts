import type { PostgresCellEdit } from '@shared/types/database'

export const previewLimit = 100

export type PostgresFilterOperator = 'contains' | '=' | '>' | '>=' | '<' | '<=' | 'between'

export interface PostgresPreviewOptions {
  sort?: { column: string; direction: 'ASC' | 'DESC' }
  filters?: { column: string; value: string; isString: boolean; operator?: PostgresFilterOperator; end?: string }[]
}

export const quotePostgresIdentifier = (name: string): string => '"' + name.replace(/"/g, '""') + '"'
export const quotePostgresValue = (value: string): string => "E'" + value.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"

export function postgresCellUpdate(schema: string, table: string, keys: string[], edit: PostgresCellEdit): {
  statement: string
  values: (string | null)[]
} {
  const quote = quotePostgresIdentifier
  const predicates = keys.map((key, index) => `${quote(key)} = $${index + 2}`)
  predicates.push(`${quote(edit.column)}::text IS NOT DISTINCT FROM $${keys.length + 2}`)
  return {
    statement: `UPDATE ${quote(schema)}.${quote(table)} SET ${quote(edit.column)} = $1 WHERE ${predicates.join(' AND ')};`,
    values: [edit.value, ...keys.map((key) => edit.keys[key]), edit.original]
  }
}

export function postgresPreviewSql(schema: string, table: string, options: PostgresPreviewOptions = {}, limit = true): string {
  const quote = quotePostgresIdentifier
  const { sort, filters = [] } = options
  const clauses = [`SELECT * FROM ${quote(schema)}.${quote(table)}`]
  const conditions = filters.map(({ column, value, isString, operator = isString ? 'contains' : '=', end }) => {
    if (operator === 'contains') {
      const pattern = /[%_]/.test(value) ? value : `%${value.replace(/\\/g, '\\\\')}%`
      return `${quote(column)} ILIKE ${quotePostgresValue(pattern)}`
    }
    if (operator === 'between') return `${quote(column)} BETWEEN ${quotePostgresValue(value)} AND ${quotePostgresValue(end ?? '')}`
    return `${quote(column)} ${operator} ${quotePostgresValue(value)}`
  })
  if (conditions.length) clauses.push(`WHERE ${conditions.join(' AND ')}`)
  if (sort) clauses.push(`ORDER BY ${quote(sort.column)} ${sort.direction} NULLS LAST`)
  // Fetch one additional row so the preview can indicate that more rows exist.
  if (limit) clauses.push(`LIMIT ${previewLimit + 1}`)
  return clauses.join(' ') + ';'
}

