export type PostgresAuthMethod = 'password' | 'trust' | 'cert'
export type PostgresSslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full'

export interface PostgresConnectionInput {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
  authMethod?: PostgresAuthMethod
  sslMode?: PostgresSslMode
  sslCert?: string
  sslKey?: string
  sslRootCert?: string
}

export type PostgresEndpoint = Pick<PostgresConnectionInput, 'host' | 'port'>

export interface PostgresEnvironment {
  status: 'remote' | 'responding' | 'unverified' | 'unreachable' | 'installed' | 'missing'
  message: string
  canInstall: boolean
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

export interface PostgresColumnDefinition {
  name: string
  type: string
  notNull: boolean
  defaultValue?: string
  primaryKey?: boolean
  unique?: boolean
  identity?: boolean
}

export interface PostgresTableStructure {
  revision: string
  columns: (PostgresColumnDefinition & { number: number; defaultSql: string | null; generated: boolean })[]
  comment: string | null
  dependencies: { name: string; definition: string | null; columns: number[] }[]
}

type TableTarget = { schema: string; table: string }
type ExistingTableTarget = TableTarget & { revision: string }

export type PostgresStructureChange =
  | (TableTarget & { op: 'create-table'; columns: PostgresColumnDefinition[] })
  | (ExistingTableTarget & { op: 'edit-table'; name: string; newSchema: string; comment?: string })
  | (ExistingTableTarget & { op: 'drop-table' })
  | (ExistingTableTarget & { op: 'add-column'; definition: PostgresColumnDefinition })
  | (ExistingTableTarget & { op: 'edit-column'; column: string; name: string; type?: string; notNull?: boolean; defaultValue?: string | null })
  | (ExistingTableTarget & { op: 'drop-column'; column: string })

export type PostgresObjectKind = 'index' | 'function' | 'procedure' | 'trigger'

export interface PostgresObject {
  oid: string
  kind: PostgresObjectKind
  schema: string
  name: string
  table: string | null
  detail: string
}

export interface PostgresResult {
  command: string
  rowCount: number | null
  columns: string[]
  rows: (string | null)[][]
  truncated: boolean
  clippedCells?: string[]
}

export interface PostgresQueryResponse {
  stringColumns?: string[]
  valueCacheId?: string
  grid?: PostgresGridMetadata
  results: PostgresResult[]
  elapsedMs: number
  omittedResults: number
}

export interface PostgresGridMetadata {
  columns: Record<string, { kind: 'string' | 'number' | 'temporal' | 'boolean' | 'other'; editable: boolean }>
  primaryKey: string[]
}

export interface PostgresCellEdit {
  column: string
  keys: Record<string, string>
  original: string | null
  value: string | null
}

export type PostgresExportFormat = 'csv' | 'json'
export type PostgresExportDestination = 'file' | 'clipboard'

export interface PostgresExportPage {
  columns: string[]
  rows: (string | null)[][]
  clippedCells?: string[]
  valueCacheId?: string
  resultIndex: number
  rowIndexes?: number[]
}
