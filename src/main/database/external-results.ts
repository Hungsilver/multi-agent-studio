import type { ExternalQueryResult } from '@shared/types/external-database'

export const maxExternalRows = 500
const maxCellLength = 16_384
const maxResultLength = 1_000_000

export function displayExternalValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (typeof value === 'object') {
    try { return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item) } catch { return String(value) }
  }
  return String(value)
}

export class ExternalResultCollector {
  readonly results: ExternalQueryResult[] = []
  private current: ExternalQueryResult | undefined
  private remaining = maxResultLength

  constructor(private readonly maxRows = maxExternalRows) {}

  start(columns: string[]): void {
    this.current = { columns, rows: [], affected: null, truncated: false }
    if (this.results.length < 12) this.results.push(this.current)
    else {
      this.results.at(-1)!.truncated = true
      this.current = undefined
    }
  }

  add(values: (string | null)[]): void {
    if (!this.current) return
    if (this.current.rows.length >= this.maxRows || this.remaining <= 0) {
      this.current.truncated = true
      return
    }
    const row = values.map((value) => {
      if (value === null || value.length <= maxCellLength) return value
      this.current!.truncated = true
      return value.slice(0, maxCellLength) + '…'
    })
    this.remaining -= row.reduce((sum, value) => sum + (value?.length ?? 0) + 8, 0)
    if (this.remaining < 0) this.current.truncated = true
    else this.current.rows.push(row)
  }

  finish(affected: number | null = null): ExternalQueryResult[] {
    if (!this.results.length) return [{ columns: [], rows: [], affected, truncated: false }]
    return this.results
  }
}
