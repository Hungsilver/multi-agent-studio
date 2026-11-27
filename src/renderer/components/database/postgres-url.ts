import type { PostgresConnectionInput } from '@shared/types/database'

export function parsePostgresUrl(raw: string, fallback: PostgresConnectionInput): PostgresConnectionInput {
  try {
    const url = new URL(raw.trim().replace(/^jdbc:/i, ''))
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error()
    const sslMode = url.searchParams.get('sslmode')
    if ([...url.searchParams.keys()].some((key) => !['sslmode', 'user', 'password'].includes(key)) ||
        (sslMode && !['disable', 'require', 'verify-ca', 'verify-full'].includes(sslMode))) {
      throw new Error('options')
    }
    return {
      host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
      port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.slice(1)) || fallback.database,
      user: decodeURIComponent(url.username) || url.searchParams.get('user') || fallback.user,
      password: decodeURIComponent(url.password) || url.searchParams.get('password') || fallback.password,
      ssl: sslMode ? sslMode !== 'disable' : fallback.ssl
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'options') throw new Error('URL có tuỳ chọn chưa hỗ trợ. Hãy dùng form hoặc URL chỉ có user, password và sslmode.')
    throw new Error('URL PostgreSQL không hợp lệ.')
  }
}
