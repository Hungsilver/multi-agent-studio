export interface PostgresConnectionInput {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
}

export type PostgresConnectionInfo = Omit<PostgresConnectionInput, 'password'> & { id: string }

export interface PostgresProfile extends Omit<PostgresConnectionInput, 'password'> {
  id: string
  allDatabases: boolean
  credential?: string
}

export interface PostgresRelation {
  schema: string
  name: string
  kind: 'table' | 'view' | 'materialized view' | 'foreign table'
}

export interface PostgresResult {
  command: string
  rowCount: number | null
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
}

export interface PostgresQueryResponse {
  results: PostgresResult[]
  elapsedMs: number
  omittedResults: number
}
