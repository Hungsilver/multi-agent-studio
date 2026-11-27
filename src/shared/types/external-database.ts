export const externalDatabaseLabels = {
  sqlserver: 'SQL Server', oracle: 'Oracle', mongodb: 'MongoDB'
} as const

export type ExternalDatabaseEngine = keyof typeof externalDatabaseLabels

export type SqlServerAuthMethod =
  | 'windows'
  | 'sql'
  | 'ntlm'
  | 'azure-password'
  | 'azure-msi-vm'
  | 'azure-msi-app'
  | 'azure-service-principal'
  | 'azure-default'
  | 'azure-token'
export type OracleAuthMethod = 'password' | 'external' | 'token'
export type OraclePrivilege = 'normal' | 'SYSDBA' | 'SYSOPER' | 'SYSBACKUP' | 'SYSDG' | 'SYSKM' | 'SYSRAC' | 'SYSASM'
export type MongoAuthMethod = 'uri' | 'none' | 'scram' | 'plain' | 'x509' | 'aws'

export type ExternalDatabaseInput =
  | {
    engine: 'sqlserver'
    authMethod?: SqlServerAuthMethod
    host: string
    port: number
    instance: string
    database: string
    user: string
    password: string
    domain?: string
    token?: string
    clientId?: string
    clientSecret?: string
    tenantId?: string
    encrypt: boolean
    trustCertificate: boolean
  }
  | {
    engine: 'oracle'
    authMethod?: OracleAuthMethod
    connectString: string
    user: string
    password: string
    privilege?: OraclePrivilege
    walletLocation?: string
    walletPassword?: string
    accessToken?: string
    privateKey?: string
  }
  | {
    engine: 'mongodb'
    authMethod?: MongoAuthMethod
    uri: string
    database: string
    host?: string
    port?: number
    srv?: boolean
    user?: string
    password?: string
    authSource?: string
    authMechanism?: 'DEFAULT' | 'SCRAM-SHA-256' | 'SCRAM-SHA-1'
    tls?: boolean
    tlsAllowInvalidCertificates?: boolean
    tlsCertificateKeyFile?: string
    tlsCAFile?: string
    awsAccessKeyId?: string
    awsSecretAccessKey?: string
    awsSessionToken?: string
  }

export interface ExternalDatabaseConnection {
  id: string
  engine: ExternalDatabaseEngine
  database: string
}

export interface ExternalDatabaseEndpoint {
  engine: ExternalDatabaseEngine
  host: string
}

export interface ExternalDatabaseEnvironment {
  status: 'remote' | 'installed' | 'unverified' | 'missing'
  message: string
  canInstall: boolean
  downloadUrl?: string
  wingetId?: string
}

export interface ExternalDatabaseProfile {
  id: string
  label: string
  engine: ExternalDatabaseEngine
  authMethod: SqlServerAuthMethod | OracleAuthMethod | MongoAuthMethod
  host: string
  port: number
  instance?: string
  database: string
  user?: string
  domain?: string
  clientId?: string
  tenantId?: string
  encrypt?: boolean
  trustCertificate?: boolean
  connectString?: string
  privilege?: OraclePrivilege
  walletLocation?: string
  uri?: string
  srv?: boolean
  authSource?: string
  authMechanism?: 'DEFAULT' | 'SCRAM-SHA-256' | 'SCRAM-SHA-1'
  tls?: boolean
  tlsAllowInvalidCertificates?: boolean
  tlsCertificateKeyFile?: string
  tlsCAFile?: string
}

export interface ExternalDatabaseResource {
  schema: string
  name: string
  kind: 'table' | 'view' | 'collection'
}

export interface ExternalQueryResult {
  columns: string[]
  rows: (string | null)[][]
  affected: number | null
  truncated: boolean
}

export const externalDatabaseStarterSql = {
  sqlserver: 'SELECT DB_NAME() AS database_name, SUSER_SNAME() AS current_login;',
  oracle: "SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS database_name, USER AS current_user FROM DUAL",
  mongodb: '{}'
} satisfies Record<ExternalDatabaseEngine, string>

export function externalPreviewSql(engine: ExternalDatabaseEngine, resource: ExternalDatabaseResource): string {
  if (engine === 'mongodb') return '{}'
  if (engine === 'sqlserver') {
    const quote = (name: string): string => '[' + name.replace(/\]/g, ']]') + ']'
    return `SELECT TOP (101) * FROM ${quote(resource.schema)}.${quote(resource.name)};`
  }
  const quote = (name: string): string => '"' + name.replace(/"/g, '""') + '"'
  return `SELECT * FROM ${quote(resource.schema)}.${quote(resource.name)} WHERE ROWNUM <= 101`
}
