import { ArrowUpRight } from 'lucide-react'
import { externalDatabaseLabels } from '@shared/types/external-database'
import type { ExternalDatabaseEngine } from '@shared/types/external-database'
import postgresLogo from '../../assets/postgresql.png'
import sqlServerLogo from '../../assets/database/sqlserver.svg'
import oracleLogo from '../../assets/database/oracle.svg'
import mongoLogo from '../../assets/database/mongodb.svg'
import redisLogo from '../../assets/database/redis.svg'
import mysqlLogo from '../../assets/database/mysql.svg'
import duckLogo from '../../assets/database/duckdb.svg'
import mariaLogo from '../../assets/database/mariadb.svg'

export const externalDatabaseLogos = { sqlserver: sqlServerLogo, oracle: oracleLogo, mongodb: mongoLogo }

const available = [
  { id: 'postgres', name: 'PostgreSQL', logo: postgresLogo, detail: 'Host, port hoặc URL PostgreSQL' },
  { id: 'sqlserver', name: externalDatabaseLabels.sqlserver, logo: sqlServerLogo, detail: 'Host, port hoặc tên instance' },
  { id: 'oracle', name: externalDatabaseLabels.oracle, logo: oracleLogo, detail: 'Chuỗi kết nối và service name' },
  { id: 'mongodb', name: externalDatabaseLabels.mongodb, logo: mongoLogo, detail: 'URI MongoDB hoặc MongoDB Atlas' }
] as const

const upcoming = [
  { name: 'Redis', logo: redisLogo },
  { name: 'MySQL', logo: mysqlLogo },
  { name: 'DuckDB', logo: duckLogo },
  { name: 'MariaDB', logo: mariaLogo }
]

export function DatabaseEnginePicker({ onChoose }: {
  onChoose: (engine: 'postgres' | ExternalDatabaseEngine) => void
}): React.JSX.Element {
  return (
    <div className="@container flex min-h-full w-full flex-col justify-center px-[clamp(1rem,4vw,3.5rem)] py-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-7">
          <h2 className="text-[clamp(1.6rem,3vw,2.5rem)] leading-tight font-semibold tracking-tight">Kết nối database</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Chọn hệ quản trị để kết nối máy chủ local hoặc cloud.</p>
        </header>
        <div aria-label="Database có thể kết nối" className="grid grid-cols-1 gap-3 @min-[31rem]:grid-cols-2 @min-[62rem]:grid-cols-4">
          {available.map(({ id, name, logo, detail }) => (
            <button key={id} type="button" aria-label={name}
              className="group relative flex min-h-38 min-w-0 flex-col items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              onClick={() => onChoose(id)}>
              <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-[#f7f9fc]">
                <img src={logo} alt="" draggable={false} className="size-9 object-contain" />
              </span>
              <ArrowUpRight className="absolute top-4 right-4 size-4 text-[var(--muted)] group-hover:text-[var(--accent)]" aria-hidden="true" />
              <span>
                <span className="block text-base font-semibold">{name}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{detail}</span>
              </span>
            </button>
          ))}
        </div>
        <section aria-labelledby="database-upcoming-title" className="mt-7 border-t border-[var(--border)] pt-5">
          <h3 id="database-upcoming-title" className="mb-3 text-sm font-medium text-[var(--muted)]">Sắp hỗ trợ</h3>
          <div className="grid grid-cols-1 gap-3 @min-[25rem]:grid-cols-2 @min-[53rem]:grid-cols-4">
            {upcoming.map(({ name, logo }) => (
              <button key={name} type="button" disabled aria-label={`${name} · Sắp có`}
                className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-left text-sm text-[var(--muted)]">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-black/10 bg-[#f7f9fc]">
                  <img src={logo} alt="" draggable={false} className="size-6 object-contain" />
                </span>
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
