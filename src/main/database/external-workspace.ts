import { randomUUID } from 'node:crypto'
import type {
  ExternalDatabaseConnection,
  ExternalDatabaseInput,
  ExternalDatabaseResource,
  ExternalQueryResult,
  MongoAuthMethod,
  OracleAuthMethod,
  OraclePrivilege,
  SqlServerAuthMethod
} from '@shared/types/external-database'
import { openMongo, openOracle, openSqlServer, type ExternalDatabaseAdapter } from './external-adapters'

function text(value: unknown, label: string, length: number, optional = false): string {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > length || value.includes('\0')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return value
}

const sqlServerAuthMethods = new Set<SqlServerAuthMethod>([
  'windows', 'sql', 'ntlm', 'azure-password', 'azure-msi-vm', 'azure-msi-app', 'azure-service-principal', 'azure-default', 'azure-token'
])
const oracleAuthMethods = new Set<OracleAuthMethod>(['password', 'external', 'token'])
const oraclePrivileges = new Set<OraclePrivilege>(['normal', 'SYSDBA', 'SYSOPER', 'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC', 'SYSASM'])
const mongoAuthMethods = new Set<MongoAuthMethod>(['uri', 'none', 'scram', 'plain', 'x509', 'aws'])

export function externalConnectionInput(input: unknown): ExternalDatabaseInput {
  if (!input || typeof input !== 'object') throw new Error('Thông tin kết nối không hợp lệ.')
  const config = input as Record<string, unknown>
  switch (config.engine) {
    case 'sqlserver': {
      const authMethod = (config.authMethod ?? 'sql') as SqlServerAuthMethod
      if (!sqlServerAuthMethods.has(authMethod)) throw new Error('Phương thức đăng nhập SQL Server không hợp lệ.')
      let host = text(config.host, 'Host SQL Server', 255).trim()
      let instance = text(config.instance ?? '', 'SQL Server instance', 128, true).trim()
      if (!instance && host.includes('\\')) {
        const slash = host.indexOf('\\')
        instance = host.slice(slash + 1).trim()
        host = host.slice(0, slash).trim() || 'localhost'
      }
      if (host === '.') host = 'localhost'
      const port = config.port
      if (!instance && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Port SQL Server không hợp lệ.')
      if (typeof config.encrypt !== 'boolean' || typeof config.trustCertificate !== 'boolean') throw new Error('Cấu hình TLS không hợp lệ.')
      const needUser = authMethod === 'sql' || authMethod === 'ntlm' || authMethod === 'azure-password'
      const user = text(config.user ?? '', 'Tài khoản', 128, !needUser)
      const password = text(config.password ?? '', 'Mật khẩu', 8192, true)
      const domain = text(config.domain ?? '', 'Domain', 128, true).trim()
      const token = text(config.token ?? '', 'Access Token', 16_384, authMethod !== 'azure-token').trim()
      const needSp = authMethod === 'azure-service-principal'
      const clientId = text(config.clientId ?? '', 'Client ID', 128, !needSp).trim()
      const clientSecret = text(config.clientSecret ?? '', 'Client Secret', 8192, !needSp)
      const tenantId = text(config.tenantId ?? '', 'Tenant ID', 128, !needSp).trim()
      return {
        engine: 'sqlserver', authMethod, host,
        port: instance ? 1433 : port as number, instance,
        database: text(config.database, 'Database', 128, true).trim(),
        user, password, domain, token, clientId, clientSecret, tenantId,
        encrypt: config.encrypt, trustCertificate: config.trustCertificate
      }
    }
    case 'oracle': {
      const authMethod = (config.authMethod ?? 'password') as OracleAuthMethod
      if (!oracleAuthMethods.has(authMethod)) throw new Error('Phương thức đăng nhập Oracle không hợp lệ.')
      const privilege = (config.privilege ?? 'normal') as OraclePrivilege
      if (!oraclePrivileges.has(privilege)) throw new Error('Quyền kết nối Oracle không hợp lệ.')
      const user = text(config.user ?? '', 'Tài khoản', 255, authMethod !== 'password')
      const password = text(config.password ?? '', 'Mật khẩu', 8192, true)
      const walletLocation = text(config.walletLocation ?? '', 'Thư mục Wallet', 1024, true).trim()
      const walletPassword = text(config.walletPassword ?? '', 'Mật khẩu Wallet', 8192, true)
      const accessToken = text(config.accessToken ?? '', 'Access Token', 16_384, authMethod !== 'token').trim()
      const privateKey = text(config.privateKey ?? '', 'Private Key', 16_384, true).trim()
      return {
        engine: 'oracle', authMethod, connectString: text(config.connectString, 'Chuỗi kết nối Oracle', 4096).trim(),
        user, password, privilege, walletLocation, walletPassword, accessToken, privateKey
      }
    }
    case 'mongodb': {
      const authMethod = (config.authMethod ?? 'uri') as MongoAuthMethod
      if (!mongoAuthMethods.has(authMethod)) throw new Error('Phương thức đăng nhập MongoDB không hợp lệ.')
      const database = text(config.database ?? '', 'Database MongoDB', 255, true).trim()
      if (authMethod === 'uri') {
        const uri = text(config.uri, 'URI MongoDB', 8192).trim()
        if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) throw new Error('URI MongoDB phải bắt đầu bằng mongodb:// hoặc mongodb+srv://.')
        return { engine: 'mongodb', authMethod, uri, database }
      }
      const host = text(config.host ?? '', 'Host MongoDB', 255).trim()
      const srv = Boolean(config.srv)
      const port = srv ? 27017 : Number(config.port ?? 27017)
      if (!srv && (!Number.isInteger(port) || port < 1 || port > 65_535)) throw new Error('Port MongoDB không hợp lệ.')
      const uri = srv ? `mongodb+srv://${host}` : `mongodb://${host}:${port}`
      const user = text(config.user ?? '', 'Tài khoản', 255, authMethod !== 'scram' && authMethod !== 'plain').trim()
      const password = text(config.password ?? '', 'Mật khẩu', 8192, authMethod !== 'plain')
      const authSource = text(config.authSource ?? '', 'Auth Database', 128, true).trim()
      const authMechanism = config.authMechanism === 'SCRAM-SHA-256' || config.authMechanism === 'SCRAM-SHA-1' ? config.authMechanism : 'DEFAULT'
      const tlsCertificateKeyFile = text(config.tlsCertificateKeyFile ?? '', 'Client Certificate Key File', 1024, authMethod !== 'x509').trim()
      const tlsCAFile = text(config.tlsCAFile ?? '', 'CA File', 1024, true).trim()
      const tls = authMethod === 'x509' || Boolean(config.tls)
      const tlsAllowInvalidCertificates = Boolean(config.tlsAllowInvalidCertificates)
      const awsAccessKeyId = text(config.awsAccessKeyId ?? '', 'AWS Access Key ID', 256, authMethod !== 'aws').trim()
      const awsSecretAccessKey = text(config.awsSecretAccessKey ?? '', 'AWS Secret Access Key', 4096, authMethod !== 'aws')
      const awsSessionToken = text(config.awsSessionToken ?? '', 'AWS Session Token', 8192, true).trim()
      return {
        engine: 'mongodb', authMethod, uri, database, host, port, srv,
        user, password, authSource, authMechanism,
        tls, tlsAllowInvalidCertificates, tlsCertificateKeyFile, tlsCAFile,
        awsAccessKeyId, awsSecretAccessKey, awsSessionToken
      }
    }
    default:
      throw new Error('Loại database chưa hỗ trợ.')
  }
}

function resourceInput(input: unknown): ExternalDatabaseResource {
  if (!input || typeof input !== 'object') throw new Error('Hãy chọn bảng hoặc collection hợp lệ.')
  const value = input as Partial<ExternalDatabaseResource>
  const { kind } = value
  if (kind !== 'table' && kind !== 'view' && kind !== 'collection') throw new Error('Đối tượng database không hợp lệ.')
  return { kind, schema: text(value.schema, 'Schema', 255), name: text(value.name, 'Tên đối tượng', 255) }
}

async function open(input: ExternalDatabaseInput): Promise<ExternalDatabaseAdapter> {
  try {
    switch (input.engine) {
      case 'sqlserver': return await openSqlServer(input)
      case 'oracle': return await openOracle(input)
      case 'mongodb': return await openMongo(input)
    }
  } catch (cause) {
    let message = cause instanceof Error ? cause.message : String(cause)
    if (input.engine === 'mongodb') {
      message = message.replaceAll(input.uri, '[URI MongoDB]').replace(/(mongodb(?:\+srv)?:\/\/)[^\s/]*@/gi, '$1[ẩn]@')
      for (const secret of [input.password, input.awsSecretAccessKey, input.awsSessionToken]) {
        if (secret) message = message.replaceAll(secret, '[ẩn]')
      }
    } else if (input.engine === 'sqlserver') {
      for (const secret of [input.password, input.token, input.clientSecret]) {
        if (secret) message = message.replaceAll(secret, '[ẩn]')
      }
    } else {
      for (const secret of [input.password, input.walletPassword, input.accessToken, input.privateKey]) {
        if (secret) message = message.replaceAll(secret, '[ẩn]')
      }
    }
    throw new Error(message)
  }
}

export class ExternalDatabaseWorkspace {
  private session: { id: string; adapter: ExternalDatabaseAdapter; busy: boolean } | null = null
  private opening = false
  private generation = 0

  async connect(input: unknown): Promise<ExternalDatabaseConnection> {
    if (this.session || this.opening) throw new Error('Hãy ngắt kết nối database hiện tại trước.')
    const config = externalConnectionInput(input)
    const generation = this.generation
    this.opening = true
    try {
      const adapter = await open(config)
      if (this.generation !== generation) {
        await adapter.close().catch(() => undefined)
        throw new Error('Kết nối đã được hủy.')
      }
      const id = randomUUID()
      this.session = { id, adapter, busy: false }
      return { id, engine: config.engine, database: adapter.database }
    } finally {
      this.opening = false
    }
  }

  async test(input: unknown): Promise<void> {
    const adapter = await open(externalConnectionInput(input))
    await adapter.close()
  }

  async close(): Promise<void> {
    this.generation++
    const session = this.session
    this.session = null
    await session?.adapter.close().catch(() => undefined)
  }

  async disconnect(id: unknown): Promise<void> {
    if (this.session?.id === id) await this.close()
  }

  private async use<T>(id: unknown, fn: (adapter: ExternalDatabaseAdapter) => Promise<T>): Promise<T> {
    const session = this.session
    if (!session || session.id !== id) throw new Error('Database đã ngắt kết nối.')
    if (session.busy) throw new Error('Database đang xử lý yêu cầu khác.')
    session.busy = true
    try { return await fn(session.adapter) } finally { session.busy = false }
  }

  list(id: unknown): Promise<ExternalDatabaseResource[]> {
    return this.use(id, (adapter) => adapter.list())
  }

  preview(id: unknown, resource: unknown): Promise<ExternalQueryResult[]> {
    return this.use(id, (adapter) => adapter.preview(resourceInput(resource)))
  }

  query(id: unknown, sql: unknown, resource?: unknown): Promise<ExternalQueryResult[]> {
    return this.use(id, (adapter) => adapter.run(text(sql, 'Câu truy vấn', 250_000), resource === undefined ? undefined : resourceInput(resource)))
  }
}
