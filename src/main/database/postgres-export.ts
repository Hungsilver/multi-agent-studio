import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { PostgresExportFormat } from '@shared/types/database'

export type WritePostgresRows = (columns: string[], rows: (string | null)[][]) => Promise<void>
type ReadRows = (write: WritePostgresRows) => Promise<void>

async function serialize(format: PostgresExportFormat, read: ReadRows, emit: (chunk: string) => Promise<void>, includeHeaders: boolean): Promise<void> {
  let header = false
  let hasRows = false
  const csv = (row: (string | null)[]): string => row.map((value) =>
    value === null ? '' : '"' + value.replace(/"/g, '""') + '"').join(',') + '\r\n'
  await read(async (columns, rows) => {
    if (!header) {
      if (format === 'json') await emit(includeHeaders ? `{"columns":${JSON.stringify(columns)},"rows":[` : '{"rows":[')
      else if (includeHeaders) await emit(csv(columns))
      header = true
    }
    if (!rows.length) return
    if (format === 'csv') await emit(rows.map(csv).join(''))
    else await emit((hasRows ? ',' : '') + rows.map((row) => JSON.stringify(row)).join(',\n'))
    hasRows = true
  })
  if (format === 'json') await emit(']}\n')
}

export async function exportPostgresText(format: PostgresExportFormat, read: ReadRows, includeHeaders = true): Promise<string> {
  const chunks: string[] = []
  let bytes = 0
  await serialize(format, read, async (chunk) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > 16 * 1024 * 1024) throw new Error('Dữ liệu vượt giới hạn clipboard 16 MB. Hãy xuất ra file.')
    chunks.push(chunk)
  }, includeHeaders)
  return chunks.join('')
}

export async function exportPostgresFile(destination: string, format: PostgresExportFormat, read: ReadRows, includeHeaders = true): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx')
  try {
    await serialize(format, read, (chunk) => file.writeFile(chunk), includeHeaders)
    await file.close()
    await rename(temporary, destination)
  } finally {
    await file.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}
