import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ExternalDatabaseInput, ExternalDatabaseResource, ExternalQueryResult } from '@shared/types/external-database'
import { externalPreviewSql } from '@shared/types/external-database'
import { displayExternalValue, ExternalResultCollector, maxExternalRows } from './external-results'

export interface ExternalDatabaseAdapter {
  database: string
  close(): Promise<void>
  list(): Promise<ExternalDatabaseResource[]>
  preview(resource: ExternalDatabaseResource): Promise<ExternalQueryResult[]>
  run(statement: string, resource?: ExternalDatabaseResource): Promise<ExternalQueryResult[]>
}

export function sqlServerAuthentication(input: Extract<ExternalDatabaseInput, { engine: 'sqlserver' }>) {
  switch (input.authMethod ?? 'sql') {
    case 'ntlm':
      return { type: 'ntlm' as const, options: { userName: input.user, password: input.password, domain: input.domain ?? '' } }
    case 'azure-password':
      return {
        type: 'azure-active-directory-password' as const,
        options: {
          userName: input.user, password: input.password,
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.tenantId ? { tenantId: input.tenantId } : {})
        }
      }
    case 'azure-msi-vm':
      return { type: 'azure-active-directory-msi-vm' as const, options: input.clientId ? { clientId: input.clientId } : {} }
    case 'azure-msi-app':
      return { type: 'azure-active-directory-msi-app-service' as const, options: input.clientId ? { clientId: input.clientId } : {} }
    case 'azure-default':
      return { type: 'azure-active-directory-default' as const, options: input.clientId ? { clientId: input.clientId } : {} }
    case 'azure-token':
      return { type: 'azure-active-directory-access-token' as const, options: { token: input.token ?? '' } }
    case 'azure-service-principal':
      return {
        type: 'azure-active-directory-service-principal-secret' as const,
        options: { clientId: input.clientId ?? '', clientSecret: input.clientSecret ?? '', tenantId: input.tenantId ?? '' }
      }
    default:
      return { type: 'default' as const, options: { userName: input.user, password: input.password } }
  }
}

const sqlServerWindowsScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$initLine = [Console]::In.ReadLine()
if (-not $initLine) { exit 1 }
$cfg = $initLine | ConvertFrom-Json
$sb = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$sb['Data Source'] = [string]$cfg.dataSource
$sb['Integrated Security'] = $true
if ($cfg.database) { $sb['Initial Catalog'] = [string]$cfg.database }
$sb['Encrypt'] = [bool]$cfg.encrypt
$sb['TrustServerCertificate'] = [bool]$cfg.trustCertificate
$sb['Connect Timeout'] = 8
$sb['Application Name'] = 'Multi-Agent Studio'
$conn = New-Object System.Data.SqlClient.SqlConnection($sb.ConnectionString)
try {
  $conn.Open()
  $idCmd = $conn.CreateCommand()
  $idCmd.CommandText = 'SELECT DB_NAME()'
  $dbName = [string]$idCmd.ExecuteScalar()
  $idCmd.Dispose()
  Write-Output (@{ ok = $true; database = $dbName } | ConvertTo-Json -Compress)
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    $req = $line | ConvertFrom-Json
    if ($req.op -eq 'close') { break }
    try {
      $cmd = $conn.CreateCommand()
      $cmd.CommandTimeout = 30
      $cmd.CommandText = [string]$req.sql
      $maxRows = [int]$req.maxRows
      $reader = $cmd.ExecuteReader()
      $sets = @()
      do {
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        $rows = @()
        $truncated = $false
        if ($reader.FieldCount -gt 0) {
          while ($reader.Read()) {
            if ($rows.Count -ge $maxRows) { $truncated = $true; break }
            $row = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
              if ($reader.IsDBNull($i)) { $row += $null }
              else {
                $v = $reader.GetValue($i)
                if ($v -is [DateTime]) { $row += $v.ToString('o') }
                elseif ($v -is [DateTimeOffset]) { $row += $v.ToString('o') }
                elseif ($v -is [byte[]]) { $row += ('0x' + [BitConverter]::ToString($v).Replace('-', '')) }
                else { $row += [string]$v }
              }
            }
            $rows += ,$row
          }
        }
        if ($cols.Count -gt 0 -or $reader.RecordsAffected -ge 0) {
          $sets += @{
            columns = $cols
            rows = $rows
            affected = $(if ($reader.RecordsAffected -ge 0) { $reader.RecordsAffected } else { $null })
            truncated = $truncated
          }
        }
      } while ($reader.NextResult())
      $reader.Close()
      $cmd.Dispose()
      Write-Output (@{ ok = $true; results = $sets } | ConvertTo-Json -Compress -Depth 6)
    } catch {
      Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
    }
  }
} catch {
  Write-Output (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
  exit 1
} finally {
  if ($conn) { $conn.Dispose() }
}
`.trim()

async function openSqlServerWindows(input: Extract<ExternalDatabaseInput, { engine: 'sqlserver' }>): Promise<ExternalDatabaseAdapter> {
  if (process.platform !== 'win32') {
    throw new Error('Windows Authentication (Integrated) chỉ hỗ trợ trên Windows. Hãy dùng SQL Server Authentication hoặc NTLM.')
  }
  const dataSource = input.instance ? `${input.host}\\${input.instance}` : `${input.host},${input.port}`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', sqlServerWindowsScript], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = createInterface({ input: child.stdout })
  const stderrChunks: string[] = []
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')))

  const nextLine = (): Promise<string> => new Promise((resolve, reject) => {
    const onLine = (line: string): void => {
      cleanup()
      resolve(line)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error(stderrChunks.join('').trim() || 'Không thể kết nối SQL Server qua Windows Authentication.'))
    }
    const cleanup = (): void => {
      lines.off('line', onLine)
      child.off('close', onClose)
    }
    lines.once('line', onLine)
    child.once('close', onClose)
  })

  try {
    child.stdin.write(JSON.stringify({
      dataSource,
      database: input.database,
      encrypt: input.encrypt,
      trustCertificate: input.trustCertificate
    }) + '\n')
    const initReply = JSON.parse(await nextLine()) as { ok: boolean; database?: string; error?: string }
    if (!initReply.ok) throw new Error(initReply.error || 'Đăng nhập Windows Authentication thất bại.')

    const query = async (sql: string, maxRows = maxExternalRows): Promise<ExternalQueryResult[]> => {
      child.stdin.write(JSON.stringify({ op: 'query', sql, maxRows }) + '\n')
      const reply = JSON.parse(await nextLine()) as { ok: boolean; results?: ExternalQueryResult[]; error?: string }
      if (!reply.ok) throw new Error(reply.error || 'Lỗi truy vấn SQL Server.')
      return reply.results ?? []
    }

    return {
      database: initReply.database || input.database,
      close: async () => {
        try { child.stdin.end(JSON.stringify({ op: 'close' }) + '\n') } catch { /* ignore */ }
        lines.close()
        child.kill()
      },
      list: async () => {
        const [result] = await query(`
          SELECT TOP (2000) s.name, o.name, CASE WHEN o.type = 'V' THEN 'view' ELSE 'table' END
          FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
          WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0
          ORDER BY s.name, o.name`, 2000)
        return (result?.rows ?? []).flatMap(([schema, name, kind]) => schema !== null && name !== null
          ? [{ schema, name, kind: kind === 'view' ? 'view' as const : 'table' as const }] : [])
      },
      preview: (resource) => query(externalPreviewSql('sqlserver', resource), 100),
      run: (statement) => query(statement)
    }
  } catch (error) {
    lines.close()
    child.kill()
    throw error
  }
}

export async function openSqlServer(input: Extract<ExternalDatabaseInput, { engine: 'sqlserver' }>): Promise<ExternalDatabaseAdapter> {
  if ((input.authMethod ?? 'sql') === 'windows') {
    return openSqlServerWindows(input)
  }
  const { Connection, Request } = await import('tedious')
  const client = new Connection({
    server: input.host,
    authentication: sqlServerAuthentication(input),
    options: {
      database: input.database || undefined,
      ...(input.instance ? { instanceName: input.instance } : { port: input.port }),
      encrypt: input.encrypt, trustServerCertificate: input.trustCertificate,
      connectTimeout: 8000, requestTimeout: 30_000, cancelTimeout: 5000,
      textsize: 64 * 1024, appName: 'Multi-Agent Studio'
    }
  })
  // Tedious also emits asynchronous transport errors after a request has completed.
  client.on('error', () => undefined)
  const query = (statement: string, maxRows?: number): Promise<ExternalQueryResult[]> => new Promise((resolve, reject) => {
    const result = new ExternalResultCollector(maxRows)
    const request = new Request(statement, (error, count) => {
      if (error) reject(error)
      else resolve(result.finish(count ?? null))
    })
    request.on('columnMetadata', (metadata) => result.start((Array.isArray(metadata) ? metadata : Object.values(metadata)).map((column) => column.colName)))
    request.on('row', (columns: { value: unknown }[] | Record<string, { value: unknown }>) =>
      result.add((Array.isArray(columns) ? columns : Object.values(columns)).map((column) => displayExternalValue(column.value))))
    client.execSqlBatch(request)
  })
  try {
    await new Promise<void>((resolve, reject) => client.connect((error) => error ? reject(error) : resolve()))
    const [identity] = await query('SELECT DB_NAME() AS database_name;')
    return {
      database: identity.rows[0]?.[0] ?? input.database,
      close: async () => { client.close() },
      list: async () => {
        const [result] = await query(`
          SELECT TOP (2000) s.name, o.name, CASE WHEN o.type = 'V' THEN 'view' ELSE 'table' END
          FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
          WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0
          ORDER BY s.name, o.name`, 2000)
        return result.rows.flatMap(([schema, name, kind]) => schema !== null && name !== null
          ? [{ schema, name, kind: kind === 'view' ? 'view' as const : 'table' as const }] : [])
      },
      preview: (resource) => query(externalPreviewSql('sqlserver', resource), 100),
      run: (statement) => query(statement)
    }
  } catch (error) {
    client.close()
    throw error
  }
}

export function oracleStatement(statement: string): string {
  const sql = statement.replace(/(?:\r?\n)\s*\/\s*$/, '').trimEnd()
  return /^(?:BEGIN\b|DECLARE\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE\s+BODY)\b)/i.test(
    sql.replace(/^(?:\s+|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/, '')
  ) ? sql : sql.replace(/;$/, '')
}

export async function openOracle(input: Extract<ExternalDatabaseInput, { engine: 'oracle' }>): Promise<ExternalDatabaseAdapter> {
  const { default: oracle } = await import('oracledb')
  const privilegeMap = {
    SYSDBA: oracle.SYSDBA, SYSOPER: oracle.SYSOPER, SYSBACKUP: oracle.SYSBACKUP,
    SYSDG: oracle.SYSDG, SYSKM: oracle.SYSKM, SYSRAC: oracle.SYSRAC, SYSASM: oracle.SYSASM
  } as const
  const authMethod = input.authMethod ?? 'password'
  const privilege = input.privilege && input.privilege !== 'normal' ? privilegeMap[input.privilege] : undefined
  const client = await oracle.getConnection({
    connectString: input.connectString,
    ...(authMethod === 'external'
      ? { externalAuth: true }
      : authMethod === 'token'
        ? { accessToken: () => (input.privateKey ? { token: input.accessToken ?? '', privateKey: input.privateKey } : (input.accessToken ?? '')) }
        : { user: input.user, password: input.password }),
    ...(privilege !== undefined ? { privilege } : {}),
    ...(input.walletLocation ? { walletLocation: input.walletLocation } : {}),
    ...(input.walletPassword ? { walletPassword: input.walletPassword } : {}),
    connectTimeout: 8, transportConnectTimeout: 8, retryCount: 0
  })
  client.callTimeout = 30_000
  const query = async (statement: string, limit = maxExternalRows): Promise<ExternalQueryResult[]> => {
    const result = await client.execute<unknown[]>(oracleStatement(statement), [], {
      resultSet: true, outFormat: oracle.OUT_FORMAT_ARRAY, fetchArraySize: 20, prefetchRows: 20,
      autoCommit: true,
      fetchTypeHandler: (column) => column.dbType === oracle.DB_TYPE_NUMBER ? { type: oracle.DB_TYPE_VARCHAR } : undefined
    })
    const collector = new ExternalResultCollector(limit)
    const rows = result.resultSet
    if (!rows) return collector.finish(result.rowsAffected ?? null)
    collector.start(rows.metaData?.map((column) => column.name) ?? [])
    try {
      let total = 0
      while (total <= limit) {
        const batch = await rows.getRows(Math.min(20, limit + 1 - total))
        if (!batch.length) break
        for (const values of batch) {
          const display: (string | null)[] = []
          for (const value of values) {
            if (value && typeof value === 'object' && 'getData' in value && typeof value.getData === 'function') {
              const lob = value as import('oracledb').Lob
              try { display.push(displayExternalValue(await lob.getData(1, 16_385))) } finally { lob.destroy() }
            } else display.push(displayExternalValue(value))
          }
          collector.add(display)
        }
        total += batch.length
      }
      return collector.finish()
    } finally {
      await rows.close()
    }
  }
  try {
    const [identity] = await query("SELECT SYS_CONTEXT('USERENV','DB_NAME') FROM DUAL")
    return {
      database: identity.rows[0]?.[0] ?? input.connectString,
      close: () => client.close(),
      list: async () => {
        const [result] = await query(`
          SELECT owner, name, kind FROM (
            SELECT owner, table_name AS name, 'table' AS kind FROM all_tables
            UNION ALL
            SELECT owner, view_name AS name, 'view' AS kind FROM all_views
          ) WHERE owner NOT IN ('SYS','SYSTEM','XDB','MDSYS','CTXSYS','ORDSYS','DBSNMP')
          ORDER BY CASE WHEN owner = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 0 ELSE 1 END, owner, name
          FETCH FIRST 2000 ROWS ONLY`, 2000)
        return result.rows.flatMap(([schema, name, kind]) => schema !== null && name !== null
          ? [{ schema, name, kind: kind === 'view' ? 'view' as const : 'table' as const }] : [])
      },
      preview: (resource) => query(externalPreviewSql('oracle', resource), 100),
      run: (statement) => query(statement)
    }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

export function mongoClientOptions(input: Extract<ExternalDatabaseInput, { engine: 'mongodb' }>) {
  const authMethod = input.authMethod ?? 'uri'
  const base = {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 35_000,
    maxPoolSize: 4, appName: 'Multi-Agent Studio'
  }
  if (authMethod === 'uri') return base
  const tlsOptions = {
    ...(input.tls ? { tls: true } : {}),
    ...(input.tlsAllowInvalidCertificates ? { tlsAllowInvalidCertificates: true } : {}),
    ...(input.tlsCertificateKeyFile ? { tlsCertificateKeyFile: input.tlsCertificateKeyFile } : {}),
    ...(input.tlsCAFile ? { tlsCAFile: input.tlsCAFile } : {})
  }
  if (authMethod === 'scram') {
    return {
      ...base, ...tlsOptions,
      auth: { username: input.user ?? '', password: input.password ?? '' },
      authSource: input.authSource || 'admin',
      authMechanism: input.authMechanism ?? 'DEFAULT'
    }
  }
  if (authMethod === 'plain') {
    return {
      ...base, ...tlsOptions,
      auth: { username: input.user ?? '', password: input.password ?? '' },
      authSource: input.authSource || '$external',
      authMechanism: 'PLAIN' as const
    }
  }
  if (authMethod === 'x509') {
    return {
      ...base, ...tlsOptions, tls: true,
      ...(input.user ? { auth: { username: input.user } } : {}),
      authSource: '$external',
      authMechanism: 'MONGODB-X509' as const
    }
  }
  if (authMethod === 'aws') {
    return {
      ...base, ...tlsOptions,
      auth: { username: input.awsAccessKeyId ?? '', password: input.awsSecretAccessKey ?? '' },
      ...(input.awsSessionToken ? { authMechanismProperties: { AWS_SESSION_TOKEN: input.awsSessionToken } } : {}),
      authSource: '$external',
      authMechanism: 'MONGODB-AWS' as const
    }
  }
  return { ...base, ...tlsOptions }
}

export async function openMongo(input: Extract<ExternalDatabaseInput, { engine: 'mongodb' }>): Promise<ExternalDatabaseAdapter> {
  const { BSON, MongoClient } = await import('mongodb')
  const client = new MongoClient(input.uri, mongoClientOptions(input))
  try {
    const database = client.db(input.database || undefined)
    await database.command({ ping: 1 })
    const query = async (name: string, statement: string, limit = maxExternalRows): Promise<ExternalQueryResult[]> => {
      const value: unknown = BSON.EJSON.parse(statement, { relaxed: false })
      const collection = database.collection(name)
      const lookup = (input: unknown): input is Record<string, unknown> => Boolean(input && typeof input === 'object' &&
        (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null))
      if (Array.isArray(value) && value.some((stage) => !lookup(stage) || Object.keys(stage).length !== 1 ||
        ['$merge', '$out', '$changeStream'].some((key) => Object.hasOwn(stage, key)))) {
        throw new Error('Pipeline phải gồm các stage đọc dữ liệu. $out, $merge và $changeStream không khả dụng ở đây.')
      }
      if (!Array.isArray(value) && !lookup(value)) throw new Error('Nhập bộ lọc dạng object JSON hoặc pipeline dạng mảng.')
      const cursor = Array.isArray(value)
        ? collection.aggregate([...value, { $limit: limit + 1 }], { maxTimeMS: 30_000, batchSize: 20 })
        : collection.find(value as Record<string, unknown>, { maxTimeMS: 30_000, batchSize: 20 }).limit(limit + 1)
      const collector = new ExternalResultCollector(limit)
      collector.start(['_id', 'Document (Extended JSON)'])
      try {
        for await (const row of cursor) {
          collector.add([row._id === undefined ? null : BSON.EJSON.stringify(row._id, { relaxed: false }),
            BSON.EJSON.stringify(row, { relaxed: false })])
        }
        return collector.finish()
      } finally {
        await cursor.close()
      }
    }
    return {
      database: database.databaseName,
      close: () => client.close(),
      list: async () => {
        const cursor = database.listCollections({}, { nameOnly: true, authorizedCollections: true, maxTimeMS: 30_000 })
        const resources: ExternalDatabaseResource[] = []
        try {
          for await (const item of cursor) {
            resources.push({ schema: database.databaseName, name: item.name, kind: item.type === 'view' ? 'view' : 'collection' })
            if (resources.length >= 2000) break
          }
        } finally {
          await cursor.close()
        }
        return resources.sort((a, b) => a.name.localeCompare(b.name))
      },
      preview: (resource) => query(resource.name, '{}', 100),
      run: (statement, resource) => {
        if (!resource) throw new Error('Hãy chọn collection hoặc view để chạy truy vấn.')
        return query(resource.name, statement)
      }
    }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}
