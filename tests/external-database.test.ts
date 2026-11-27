import { describe, expect, it } from 'vitest'
import { externalConnectionInput } from '../src/main/database/external-workspace'
import { mongoClientOptions, oracleStatement, sqlServerAuthentication } from '../src/main/database/external-adapters'
import { connectionOptions } from '../src/main/database/postgres-workspace'
import { ExternalResultCollector } from '../src/main/database/external-results'
import { externalPreviewSql } from '../src/shared/types/external-database'

describe('external database connections', () => {
  it('accepts MongoDB SRV URIs and rejects unrelated URI schemes', () => {
    expect(externalConnectionInput({ engine: 'mongodb', uri: 'mongodb+srv://cluster.example/test', database: '' }).engine).toBe('mongodb')
    expect(() => externalConnectionInput({ engine: 'mongodb', uri: 'https://example.com', database: '' })).toThrow(/mongodb:\/\//)
  })

  it('honors SQL Server named instances without requiring a port', () => {
    const input = { engine: 'sqlserver', host: 'localhost', instance: 'SQLEXPRESS', port: 0, database: '', user: 'test',
      password: '', encrypt: true, trustCertificate: false }
    expect(externalConnectionInput(input)).toMatchObject({ instance: 'SQLEXPRESS', encrypt: true, trustCertificate: false })
    expect(() => externalConnectionInput({ ...input, instance: '' })).toThrow(/Port/)
  })

  it('quotes preview identifiers with the syntax of each SQL dialect', () => {
    const table = { schema: 'one] "two', name: 'table', kind: 'table' } as const
    expect(externalPreviewSql('sqlserver', table)).toBe('SELECT TOP (101) * FROM [one]] "two].[table];')
    expect(externalPreviewSql('oracle', table)).toBe('SELECT * FROM "one] ""two"."table" WHERE ROWNUM <= 101')
  })

  it('strips Oracle command terminators while preserving PL/SQL blocks', () => {
    expect(oracleStatement('SELECT 1 FROM dual;\n')).toBe('SELECT 1 FROM dual')
    expect(oracleStatement('-- comment\nBEGIN NULL; END;\n/\n')).toBe('-- comment\nBEGIN NULL; END;')
    expect(oracleStatement('CREATE OR REPLACE NONEDITIONABLE PROCEDURE p AS BEGIN NULL; END;')).toContain('END;')
  })

  it('keeps row and column metadata for each result and marks truncation', () => {
    const output = new ExternalResultCollector(1)
    output.start(['num'])
    output.add(['1'])
    output.add(['2'])
    output.start(['text'])
    output.add([null])
    expect(output.finish()).toEqual([
      { columns: ['num'], rows: [['1']], affected: null, truncated: true },
      { columns: ['text'], rows: [[null]], affected: null, truncated: false }
    ])
  })

  it('validates and maps SQL Server Windows, NTLM, and Entra ID auth methods', () => {
    const win = externalConnectionInput({
      engine: 'sqlserver', authMethod: 'windows', host: 'DESKTOP-AKUJIN\\SQLSERVER', port: 1433, instance: '',
      database: 'master', user: '', password: '', encrypt: true, trustCertificate: true
    })
    expect(win).toMatchObject({ engine: 'sqlserver', authMethod: 'windows', host: 'DESKTOP-AKUJIN', instance: 'SQLSERVER' })

    const entraDefault = externalConnectionInput({
      engine: 'sqlserver', authMethod: 'azure-default', host: 'az.database.windows.net', port: 1433, instance: '',
      database: 'app', user: '', password: '', encrypt: true, trustCertificate: false
    })
    expect(entraDefault.engine === 'sqlserver' && sqlServerAuthentication(entraDefault)).toEqual({
      type: 'azure-active-directory-default', options: {}
    })

    const ntlm = externalConnectionInput({
      engine: 'sqlserver', authMethod: 'ntlm', host: 'db.corp', port: 1433, instance: '',
      database: 'app', user: 'alice', password: 'secret', domain: 'CORP', encrypt: true, trustCertificate: false
    })
    expect(ntlm.engine === 'sqlserver' && sqlServerAuthentication(ntlm)).toEqual({
      type: 'ntlm', options: { userName: 'alice', password: 'secret', domain: 'CORP' }
    })

    const token = externalConnectionInput({
      engine: 'sqlserver', authMethod: 'azure-token', host: 'az.database.windows.net', port: 1433, instance: '',
      database: 'app', user: '', password: '', token: 'eyJ0eXAi', encrypt: true, trustCertificate: false
    })
    expect(token.engine === 'sqlserver' && sqlServerAuthentication(token)).toEqual({
      type: 'azure-active-directory-access-token', options: { token: 'eyJ0eXAi' }
    })
    expect(() => externalConnectionInput({
      engine: 'sqlserver', authMethod: 'azure-token', host: 'az.database.windows.net', port: 1433, instance: '',
      database: '', user: '', password: '', token: '', encrypt: true, trustCertificate: false
    })).toThrow(/Access Token/)
  })

  it('validates Oracle external/token auth and SYSDBA privilege', () => {
    const ext = externalConnectionInput({
      engine: 'oracle', authMethod: 'external', connectString: 'localhost:1521/FREEPDB1',
      user: '', password: '', privilege: 'SYSDBA'
    })
    expect(ext).toMatchObject({ engine: 'oracle', authMethod: 'external', privilege: 'SYSDBA' })
    expect(() => externalConnectionInput({
      engine: 'oracle', authMethod: 'token', connectString: 'localhost:1521/FREEPDB1',
      user: '', password: '', accessToken: ''
    })).toThrow(/Access Token/)
  })

  it('validates and builds MongoDB SCRAM, X.509, and AWS IAM options', () => {
    const scram = externalConnectionInput({
      engine: 'mongodb', authMethod: 'scram', host: 'mongo.internal', port: 27017, srv: false,
      database: 'app', user: 'admin', password: 'pw', authSource: 'admin', authMechanism: 'SCRAM-SHA-256'
    })
    expect(scram.engine === 'mongodb' && mongoClientOptions(scram)).toMatchObject({
      auth: { username: 'admin', password: 'pw' }, authSource: 'admin', authMechanism: 'SCRAM-SHA-256'
    })

    const x509 = externalConnectionInput({
      engine: 'mongodb', authMethod: 'x509', host: 'mongo.internal', port: 27017, srv: true,
      database: 'app', tlsCertificateKeyFile: '/certs/client.pem'
    })
    expect(x509.engine === 'mongodb' && x509.uri).toBe('mongodb+srv://mongo.internal')
    expect(x509.engine === 'mongodb' && mongoClientOptions(x509)).toMatchObject({
      tls: true, authSource: '$external', authMechanism: 'MONGODB-X509', tlsCertificateKeyFile: '/certs/client.pem'
    })
  })

  it('validates PostgreSQL trust and SSL certificate auth methods', () => {
    const trust = connectionOptions({
      host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: 'ignored', ssl: false, authMethod: 'trust'
    })
    expect(trust).toMatchObject({ authMethod: 'trust', password: '', sslMode: 'disable', ssl: false })

    expect(() => connectionOptions({
      host: 'db.example.com', port: 5432, database: 'postgres', user: 'postgres', password: '', ssl: true, authMethod: 'cert'
    })).toThrow(/Client Certificate/)
  })
})
