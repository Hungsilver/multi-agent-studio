import Editor from '@monaco-editor/react'
import { THEMES } from '@shared/constants/themes'
import { postgresCellUpdate, postgresPreviewSql } from '@shared/utils/postgres-preview'
import type { PostgresFilterOperator, PostgresPreviewOptions } from '@shared/utils/postgres-preview'
import { ArrowLeft, ChevronDown, ChevronUp, CircleHelp, Database, Download, Eye, EyeOff, Filter, Pencil, Play, Plug, Plus, RefreshCw, Search, Table2, Trash2, Unplug, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { editor } from 'monaco-editor'
import { externalDatabaseLabels } from '@shared/types/external-database'
import type { ExternalDatabaseEngine, ExternalDatabaseProfile } from '@shared/types/external-database'
import type {
  PostgresAuthMethod,
  PostgresCellEdit,
  PostgresConnectionInfo,
  PostgresConnectionInput,
  PostgresEndpoint,
  PostgresEnvironment,
  PostgresExportDestination,
  PostgresExportFormat,
  PostgresExportPage,
  PostgresObject,
  PostgresProfile,
  PostgresQueryResponse,
  PostgresRelation,
  PostgresSslMode,
  PostgresStructureChange
} from '@shared/types/database'
import postgresLogo from '../../assets/postgresql.png'
import { ensureMonacoSetup } from '../../lib/monaco-setup'
import { formatIpcError } from '../../lib/os-actions'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { formatGridJson } from './format-json'
import { parsePostgresUrl } from './postgres-url'
import { PostgresObjects } from './PostgresObjects'
import { PostgresTableDesigner, type TableDesignerTarget } from './PostgresTableDesigner'
import { ExternalDatabaseWorkspace } from './ExternalDatabaseWorkspace'
import { DatabaseEnginePicker, externalDatabaseLogos } from './DatabaseEnginePicker'

const initialConnection: PostgresConnectionInput = {
  host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '', ssl: false
}
const starterSql = 'SELECT current_database(), current_user;'

function DismissibleNotice({ message, onDismiss, role = 'status', className }: {
  message: string
  onDismiss: () => void
  role?: 'status' | 'alert'
  className: string
}): React.JSX.Element {
  const label = role === 'alert' ? 'Đóng thông báo lỗi' : 'Đóng thông báo'
  return (
    <div className={`flex min-w-0 items-start gap-2 ${className}`}>
      <span role={role} className="min-w-0 flex-1 break-words">{message}</span>
      <button type="button" className="btn-ghost shrink-0 rounded p-1" onClick={onDismiss} aria-label={label} title={label}>
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
const sqlShortcuts = [
  ['Ctrl + Enter', 'Chạy SQL đang chọn hoặc toàn bộ nội dung'],
  ['Ctrl + F', 'Tìm trong SQL'],
  ['Ctrl + H', 'Tìm và thay thế'],
  ['Ctrl + A', 'Chọn toàn bộ SQL'],
  ['Ctrl + Z', 'Hoàn tác'],
  ['Ctrl + Y', 'Làm lại'],
  ['Ctrl + /', 'Bật hoặc tắt chú thích dòng']
] as const
const fieldClass = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]'
const buttonClass = 'btn-ghost inline-flex items-center justify-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs disabled:opacity-50'
const primaryClass = 'inline-flex items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50'

const profilesKey = 'multi-agent-studio.postgres-profiles'
const externalProfilesKey = 'multi-agent-studio.external-database-profiles'
const seededTestProfilesKey = 'multi-agent-studio.database-test-seeds.v1'
const savedPasswordMask = '••••••••'

const defaultPostgresTestProfile: PostgresProfile = {
  id: 'seed-postgres-test',
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  ssl: false,
  allDatabases: true,
  authMethod: 'password',
  sslMode: 'disable'
}

const defaultExternalTestProfiles: ExternalDatabaseProfile[] = [
  {
    id: 'seed-sqlserver-test',
    label: 'studio_test',
    engine: 'sqlserver',
    authMethod: 'windows',
    host: 'localhost',
    port: 1433,
    database: 'studio_test',
    encrypt: true,
    trustCertificate: true
  },
  {
    id: 'seed-mongodb-test',
    label: 'studio_test',
    engine: 'mongodb',
    authMethod: 'none',
    host: '127.0.0.1',
    port: 27017,
    database: 'studio_test',
    tls: false
  },
  {
    id: 'seed-oracle-test',
    label: 'FREEPDB1',
    engine: 'oracle',
    authMethod: 'password',
    host: 'localhost',
    port: 1521,
    database: 'FREEPDB1',
    connectString: 'localhost:1521/FREEPDB1',
    user: 'system',
    privilege: 'normal'
  }
]

function readProfiles(): PostgresProfile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(profilesKey) ?? '[]')
    const list = Array.isArray(raw) ? raw.filter((item): item is PostgresProfile =>
      item && typeof item.id === 'string' && typeof item.host === 'string' &&
      Number.isInteger(item.port) && typeof item.database === 'string' && typeof item.user === 'string' &&
      typeof item.ssl === 'boolean' && typeof item.allDatabases === 'boolean' &&
      (item.credential === undefined || typeof item.credential === 'string')
    ) : []
    if (!localStorage.getItem(seededTestProfilesKey)) {
      const hasDefaultPg = list.some((item) =>
        ['localhost', '127.0.0.1'].includes(item.host.toLowerCase()) && item.port === 5432
      )
      if (!hasDefaultPg) {
        const seeded = [...list, defaultPostgresTestProfile]
        localStorage.setItem(profilesKey, JSON.stringify(seeded))
        return seeded
      }
    }
    return list
  } catch {
    return []
  }
}

function readExternalProfiles(): ExternalDatabaseProfile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(externalProfilesKey) ?? '[]')
    const list = Array.isArray(raw) ? raw.filter((item): item is ExternalDatabaseProfile =>
      Boolean(item && typeof item.id === 'string' && typeof item.label === 'string' &&
        (item.engine === 'sqlserver' || item.engine === 'oracle' || item.engine === 'mongodb') &&
        typeof item.host === 'string' && Number.isInteger(item.port) && typeof item.database === 'string')
    ) : []
    if (!localStorage.getItem(seededTestProfilesKey)) {
      const missing = defaultExternalTestProfiles.filter((seed) => !list.some((item) => item.engine === seed.engine))
      const next = [...list, ...missing]
      localStorage.setItem(externalProfilesKey, JSON.stringify(next))
      localStorage.setItem(seededTestProfilesKey, '1')
      return next
    }
    return list
  } catch {
    return []
  }
}

interface ConnectionRequest {
  input: PostgresConnectionInput
  allDatabases: boolean
  save: boolean
  savePassword: boolean
}

function EnvironmentCheck({ host, port, run }: PostgresEndpoint & {
  run: (action: () => Promise<void>) => Promise<void>
}): React.JSX.Element {
  const [result, setResult] = useState<PostgresEnvironment | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const checked = await window.workspaceApi.checkPostgresEnvironment({ host, port })
          if (!cancelled) setResult(checked)
        } catch (error) {
          const message = formatIpcError(error)
          if (!cancelled) setError(typeof window.workspaceApi.checkPostgresEnvironment !== 'function' ||
              /no handler registered for ['"]postgres:check-environment/i.test(message)
            ? 'Hãy khởi động lại Multi-Agent Studio để kiểm tra môi trường PostgreSQL.'
            : message)
        }
      })()
    }, revision === 0 ? 350 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [host, port, revision])

  function refresh(): void {
    setResult(null)
    setError('')
    setRevision((value) => value + 1)
  }

  function install(): void {
    void run(async () => {
      setInstalling(true)
      try {
        await window.workspaceApi.installPostgresEnvironment({ host, port })
      } finally {
        setInstalling(false)
        refresh()
      }
    })
  }

  const warning = Boolean(error || (result && !['installed', 'responding', 'remote'].includes(result.status)))
  const color = warning ? 'text-[var(--warn)]' : result && ['installed', 'responding'].includes(result.status) ? 'text-[var(--ok)]' : 'text-[var(--muted)]'
  return (
    <div className="space-y-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Môi trường PostgreSQL</h3>
        <div className="flex flex-wrap gap-1.5">
          {(error || (result && result.status !== 'remote')) && (
            <button type="button" className={buttonClass} onClick={refresh}>
              <RefreshCw className="size-3" aria-hidden="true" />Kiểm tra lại
            </button>
          )}
          {result?.status === 'missing' && (
            <button type="button" className={buttonClass} onClick={() => void window.workspaceApi.openExternalUrl('https://www.postgresql.org/download/')}>
              Tự cài (postgresql.org)
            </button>
          )}
          {result?.canInstall && (
            <button type="button" className={buttonClass} onClick={install}>
              <Download className="size-3" aria-hidden="true" />Cài PostgreSQL qua WinGet
            </button>
          )}
        </div>
      </div>
      <p role={warning ? 'alert' : 'status'} className={`break-words ${color}`}>
        {installing ? 'Đang chạy trình cài đặt PostgreSQL…' : error || result?.message || 'Đang kiểm tra môi trường…'}
      </p>
      {result?.canInstall && <p className="text-[var(--muted)]">Bạn có thể tự cài từ postgresql.org hoặc bấm cài qua WinGet (PostgreSQL 17, giữ port 5432 và đặt mật khẩu cho postgres).</p>}
    </div>
  )
}

function ConnectionForm({ busy, profile, onSubmit, run }: {
  busy: boolean
  profile: PostgresProfile | null
  onSubmit: (request: () => ConnectionRequest, test: boolean) => void
  run: (action: () => Promise<void>) => Promise<void>
}): React.JSX.Element {
  const initial = profile ?? initialConnection
  const [host, setHost] = useState(initial.host)
  const [port, setPort] = useState(String(initial.port))
  const [url, setUrl] = useState('')
  const [authMethod, setAuthMethod] = useState<PostgresAuthMethod>(initial.authMethod ?? 'password')
  const [sslMode, setSslMode] = useState<PostgresSslMode>(initial.sslMode ?? (initial.ssl ? 'verify-full' : 'disable'))
  const [method, setMethod] = useState<'host' | 'url'>('host')
  const [save, setSave] = useState(Boolean(profile))
  const [allDatabases, setAllDatabases] = useState(profile?.allDatabases ?? false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [revealedPassword, setRevealedPassword] = useState('')
  const [revealing, setRevealing] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  let endpoint: PostgresEndpoint | null = null
  if (method === 'url') {
    try {
      const { host, port } = parsePostgresUrl(url, initialConnection)
      endpoint = { host, port }
    } catch {
      // Wait for a valid URL before checking its endpoint.
    }
  } else if (host.trim() && Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65_535) {
    endpoint = { host: host.trim().toLowerCase(), port: Number(port) }
  }

  async function togglePassword(): Promise<void> {
    setPasswordError('')
    if (showPassword) {
      setShowPassword(false)
      setRevealedPassword('')
      return
    }
    if (password || !profile?.credential) {
      setShowPassword(true)
      return
    }
    setRevealing(true)
    try {
      if (typeof window.workspaceApi.revealPostgresPassword !== 'function') {
        throw new Error('Hãy khởi động lại Multi-Agent Studio để hiện mật khẩu đã lưu.')
      }
      setRevealedPassword(await window.workspaceApi.revealPostgresPassword({ ...profile, password: '' }, profile.credential))
      setShowPassword(true)
    } catch (error) {
      const message = formatIpcError(error)
      setPasswordError(/no handler registered for ['"]postgres:reveal/i.test(message)
        ? 'Hãy khởi động lại Multi-Agent Studio để hiện mật khẩu đã lưu.'
        : message)
    } finally {
      setRevealing(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    onSubmit(() => {
      const effectiveSslMode: PostgresSslMode = authMethod === 'cert' && sslMode === 'disable' ? 'verify-full' : sslMode
      const fields: PostgresConnectionInput = {
        host: host.trim(),
        port: Number(form.get('port') || 5432),
        database: String(form.get('database') || (allDatabases ? 'postgres' : '')),
        user: String(form.get('user') ?? ''),
        password: authMethod === 'trust' ? '' : password,
        ssl: effectiveSslMode !== 'disable',
        authMethod,
        sslMode: effectiveSslMode,
        ...(authMethod === 'cert' ? {
          sslCert: String(form.get('sslCert') ?? '').trim(),
          sslKey: String(form.get('sslKey') ?? '').trim(),
          sslRootCert: String(form.get('sslRootCert') ?? '').trim() || undefined
        } : {})
      }
      return {
        input: method === 'url' ? parsePostgresUrl(String(form.get('url')), fields) : fields,
        allDatabases, save, savePassword: form.get('savePassword') === 'on'
      }
    }, submitter?.getAttribute('data-test-connection') === 'true')
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" autoComplete="off">
      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="rounded-lg bg-[var(--accent-soft)] p-2"><img src={postgresLogo} alt="" className="size-5 object-contain" /></div>
        <h2 className="text-base font-semibold">Kết nối PostgreSQL</h2>
      </div>
      <fieldset disabled={busy} className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-xs">Kiểu kết nối
            <select value={method} className={fieldClass} onChange={(event) => {
              const value = event.target.value === 'url' ? 'url' : 'host'
              setMethod(value)
              if (value === 'url' && sslMode === 'disable') setSslMode('require')
            }}>
              <option value="host">Host và port</option>
              <option value="url">URL PostgreSQL</option>
            </select>
          </label>
          <label className="text-xs">Phương thức đăng nhập
            <select name="authMethod" value={authMethod} className={fieldClass} onChange={(event) => {
              const next = event.target.value as PostgresAuthMethod
              setAuthMethod(next)
              if (next === 'cert' && sslMode === 'disable') setSslMode('verify-full')
            }}>
              <option value="password">Tài khoản &amp; Mật khẩu (SCRAM / MD5)</option>
              <option value="trust">Không mật khẩu (Trust / Peer)</option>
              <option value="cert">Chứng chỉ SSL (mTLS)</option>
            </select>
          </label>
        </div>
        {method === 'url' ? (
          <label className="block text-xs">URL
            <input name="url" type="password" required value={url} onChange={(event) => setUrl(event.target.value)} className={fieldClass} placeholder="postgresql://host:5432/database" />
          </label>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] gap-2.5">
            <label className="text-xs">Host
              <input name="host" required value={host} className={fieldClass} onChange={(event) => {
                const value = event.target.value
                setHost(value)
                const local = ['localhost', '127.0.0.1', '::1', ''].includes(value.trim().toLowerCase())
                setSslMode(local ? 'disable' : 'verify-full')
              }} />
            </label>
            <label className="text-xs">Port
              <input name="port" type="number" min="1" max="65535" required value={port} onChange={(event) => setPort(event.target.value)} className={fieldClass} />
            </label>
            <label className="text-xs">Database
              <input name="database" required={!allDatabases} defaultValue={initial.database} className={fieldClass} placeholder="postgres" />
            </label>
          </div>
        )}
        <div className={`grid gap-2.5 ${authMethod === 'trust' ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <label className="text-xs">Người dùng
            <input name="user" autoComplete="username" required={method === 'host'} defaultValue={initial.user} className={fieldClass} />
          </label>
          {authMethod !== 'trust' && <div className="text-xs">
            <label htmlFor="postgres-password">Mật khẩu {authMethod === 'cert' ? '(tùy chọn)' : ''}</label>
            <div className="relative">
              <input
                id="postgres-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                className={`${fieldClass} pr-9 placeholder:text-[var(--muted)] placeholder:opacity-100`}
                placeholder={profile?.credential ? savedPasswordMask : undefined}
                aria-describedby={profile?.credential ? 'postgres-saved-password' : undefined}
                value={password || (showPassword ? revealedPassword : '')}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setRevealedPassword('')
                }}
              />
              <button type="button" className="btn-ghost absolute inset-y-1 right-1 mt-1 grid w-7 place-items-center rounded text-[var(--muted)]"
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                disabled={revealing} onClick={() => void togglePassword()}>
                {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            {profile?.credential && <span id="postgres-saved-password" className="mt-1 block text-[10px] text-[var(--muted)]">Đã lưu · nhập để thay thế</span>}
            {passwordError && <DismissibleNotice message={passwordError} role="alert" className="mt-1 text-[var(--err)]"
              onDismiss={() => setPasswordError('')} />}
          </div>}
        </div>
        {authMethod === 'cert' && <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs">
          <div className="grid grid-cols-2 gap-2.5">
            <label>Client Certificate (.crt / PEM)
              <input name="sslCert" required defaultValue={initial.sslCert} placeholder="C:\certs\client.crt" className={fieldClass} />
            </label>
            <label>Client Key (.key / PEM)
              <input name="sslKey" required defaultValue={initial.sslKey} placeholder="C:\certs\client.key" className={fieldClass} />
            </label>
          </div>
          <label className="block">CA Root Certificate (tùy chọn)
            <input name="sslRootCert" defaultValue={initial.sslRootCert} placeholder="C:\certs\ca.crt" className={fieldClass} />
          </label>
        </div>}
        <div className="grid grid-cols-2 items-end gap-2.5">
          <label className="text-xs">SSL
            <select name="ssl" value={sslMode} onChange={(event) => setSslMode(event.target.value as PostgresSslMode)} className={fieldClass}>
              <option value="disable" disabled={authMethod === 'cert'}>Tắt SSL</option>
              <option value="require">Bật SSL (không xác minh CA)</option>
              <option value="verify-ca">Xác minh CA máy chủ</option>
              <option value="verify-full">Xác minh chứng chỉ máy chủ (verify-full)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs">
            <input type="checkbox" checked={allDatabases} onChange={(event) => setAllDatabases(event.target.checked)} />
            Hiển thị tất cả database
          </label>
        </div>
        {endpoint && <EnvironmentCheck key={['localhost', '127.0.0.1', '::1'].includes(endpoint.host) ? 'local' : endpoint.host} {...endpoint} run={run} />}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />Lưu kết nối</label>
          <label className="flex items-center gap-2"><input type="checkbox" key={String(save)} name="savePassword" disabled={!save} defaultChecked={Boolean(profile?.credential) && save} />Lưu mật khẩu</label>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] pt-3">
          <button type="submit" className={`${primaryClass} order-2`}><Plug className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Đang xử lý…' : 'Kết nối'}</button>
          <button type="submit" data-test-connection="true" className={`${buttonClass} order-1`}>Kiểm tra kết nối</button>
        </div>
      </fieldset>
    </form>
  )
}

interface GridCell { row: number; column: number }
interface GridDraft extends GridCell { edit: PostgresCellEdit }

const emptyPreviewOptions: PostgresPreviewOptions = {}

function ResultGrid({ response, busy, onSearch, onExport, connectionId, options, draft, onDraft, onSave }: {
  response: PostgresQueryResponse
  busy: boolean
  connectionId: string
  options: PostgresPreviewOptions
  draft?: GridDraft
  onSearch?: (options: PostgresPreviewOptions) => void
  onDraft?: (draft?: GridDraft) => void
  onSave?: () => void
  onExport: (format: PostgresExportFormat, destination: PostgresExportDestination, includeHeaders: boolean, page?: PostgresExportPage) => void
}): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [filterColumn, setFilterColumn] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [filterEnd, setFilterEnd] = useState('')
  const [filterOperator, setFilterOperator] = useState<PostgresFilterOperator>('=')
  const [selection, setSelection] = useState<{ anchor: GridCell; end: GridCell } | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set())
  const rowAnchor = useRef<number | null>(null)
  const [detail, setDetail] = useState<{ cell: GridCell; value: string | null; formatted: boolean; prettyJson?: string } | null>(null)
  const [gridMessage, setGridMessage] = useState('')
  const [exportFormat, setExportFormat] = useState<PostgresExportFormat>('csv')
  const [exportScope, setExportScope] = useState<'selected' | 'shown' | 'query'>('shown')
  const [exportDestination, setExportDestination] = useState<PostgresExportDestination>('file')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const exportDialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const detailRequest = useRef(0)
  const drag = useRef<{ x: number; width: number; column: string; pointerId: number } | null>(null)
  const item = response.results[index]
  const clipped = new Set(item?.clippedCells)
  const columnWidths = item?.columns.map((_, i) => widths[`${index}:${i}`] ?? 160) ?? []

  useEffect(() => {
    detailRequest.current++
    setSelection(null)
    setSelectedRows(new Set())
    rowAnchor.current = null
    setDetail(null)
    setGridMessage('')
  }, [response, index])

  useEffect(() => {
    function move(event: PointerEvent): void {
      const resize = drag.current
      if (!resize || resize.pointerId !== event.pointerId) return
      const width = Math.max(72, resize.width + event.clientX - resize.x)
      setWidths((current) => ({ ...current, [resize.column]: width }))
    }
    function stop(event: PointerEvent): void {
      if (drag.current?.pointerId === event.pointerId) drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  function search(next: PostgresPreviewOptions): void {
    onSearch?.(next)
  }

  function applyFilter(column: string, value: string): void {
    const filters = options.filters?.filter((filter) => filter.column !== column) ?? []
    if (value.trim()) filters.push({ column, value, isString: response.stringColumns?.includes(column) ?? false, operator: filterOperator, end: filterEnd })
    setFilterColumn(null)
    search({ ...options, filters })
  }

  async function readCell(cell: GridCell): Promise<string | null> {
    const key = `${cell.row}:${cell.column}`
    if (clipped.has(key)) return window.workspaceApi.readPostgresCell(connectionId, response.valueCacheId, `${index}:${key}`)
    return item.rows[cell.row][cell.column]
  }

  function selectCell(cell: GridCell, extend = false): void {
    if (selectedRows.size) setSelectedRows(new Set())
    setSelection((current) => ({ anchor: extend && current ? current.anchor : cell, end: cell }))
  }

  function selectRow(row: number, toggle: boolean, extend: boolean): void {
    const anchor = rowAnchor.current ?? selection?.end.row ?? row
    if (!extend) rowAnchor.current = row
    setSelection(null)
    setSelectedRows((previous) => {
      const next = toggle ? new Set(previous) : new Set<number>()
      if (toggle && !previous.size && selection && selection.end.row !== row) next.add(selection.end.row)
      if (extend) {
        for (let index = Math.min(anchor, row); index <= Math.max(anchor, row); index++) next.add(index)
      } else if (toggle && next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  const range = selection && {
    firstRow: Math.min(selection.anchor.row, selection.end.row), lastRow: Math.max(selection.anchor.row, selection.end.row),
    firstColumn: Math.min(selection.anchor.column, selection.end.column), lastColumn: Math.max(selection.anchor.column, selection.end.column)
  }

  async function copySelection(headers: boolean): Promise<void> {
    if (!item || (!range && !selectedRows.size)) return
    try {
      const firstColumn = range?.firstColumn ?? 0
      const lastColumn = range?.lastColumn ?? item.columns.length - 1
      const rowIndexes = range
        ? Array.from({ length: range.lastRow - range.firstRow + 1 }, (_, i) => range.firstRow + i)
        : [...selectedRows].sort((a, b) => a - b)
      const rows: string[][] = []
      if (headers) rows.push(item.columns.slice(firstColumn, lastColumn + 1))
      const singleCell = !headers && rowIndexes.length === 1 && firstColumn === lastColumn
      const tsv = (value: string): string => singleCell || !/[\t\n\r"]/.test(value) ? value : '"' + value.replace(/"/g, '""') + '"'
      for (const row of rowIndexes) {
        const cells: string[] = []
        for (let column = firstColumn; column <= lastColumn; column++) {
          cells.push((await readCell({ row, column })) ?? '')
        }
        rows.push(cells)
      }
      await window.workspaceApi.copyPtyText(rows.map((row) => row.map(tsv).join('\t')).join('\r\n'))
      setGridMessage('Đã copy dữ liệu.')
    } catch (error) {
      setGridMessage(formatIpcError(error))
    }
  }

  function submitExport(destination: PostgresExportDestination, withHeaders: boolean): void {
    if (!item || busy) return
    let page: PostgresExportPage | undefined
    if (exportScope !== 'query' || !onSearch) {
      const rowIndexes = exportScope === 'selected'
        ? [...selectedRows].sort((a, b) => a - b)
        : item.rows.map((_, index) => index)
      if (!rowIndexes.length && exportScope === 'selected') return
      const positions = new Map(rowIndexes.map((row, position) => [row, position]))
      const clippedCells = (item.clippedCells ?? []).flatMap((cell) => {
        const [row, column] = cell.split(':').map(Number)
        const position = positions.get(row)
        return position === undefined ? [] : [`${position}:${column}`]
      })
      page = { columns: item.columns, rows: rowIndexes.map((row) => item.rows[row]), clippedCells,
        valueCacheId: response.valueCacheId, resultIndex: index, rowIndexes }
    }
    exportDialog.current?.close()
    onExport(exportFormat, destination, withHeaders, page)
  }

  async function viewCell(cell: GridCell): Promise<void> {
    const request = ++detailRequest.current
    setGridMessage('')
    try {
      const value = await readCell(cell)
      if (request === detailRequest.current) setDetail({ cell, value, formatted: false, prettyJson: value === null ? undefined : formatGridJson(value) })
    } catch (error) {
      if (request === detailRequest.current) setGridMessage(formatIpcError(error))
    }
  }

  async function editCell(): Promise<void> {
    if (!detail || !onDraft || !response.grid) return
    const request = detailRequest.current
    try {
      const keys = await Promise.all(response.grid.primaryKey.map(async (name) => {
        const column = item.columns.indexOf(name)
        if (column < 0) throw new Error('Không đọc được khóa chính của dòng.')
        const value = await readCell({ row: detail.cell.row, column })
        if (value === null) throw new Error('Khóa chính không hợp lệ.')
        return [name, value] as const
      }))
      if (request !== detailRequest.current) return
      const column = item.columns[detail.cell.column]
      onDraft({ ...detail.cell, edit: { column, keys: Object.fromEntries(keys), original: detail.value, value: detail.value } })
      setDetail(null)
    } catch (error) {
      if (request === detailRequest.current) setGridMessage(formatIpcError(error))
    }
  }

  const detailColumn = detail ? item?.columns[detail.cell.column] : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-3 py-2 text-xs">
        {response.results.length > 1 && (
          <select aria-label="Tập kết quả" className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
            {response.results.map((result, i) => <option key={i} value={i}>{i + 1}. {result.command || 'Kết quả'}</option>)}
          </select>
        )}
        <span className="text-[var(--ok)]">{item?.command || 'Đã thực thi'}</span>
        {item && <span>{item.columns.length ? `${item.rows.length} dòng hiển thị` : item.rowCount !== null ? `${item.rowCount} dòng ảnh hưởng` : 'Đã hoàn tất'}</span>}
        <span className="text-[var(--muted)]">{response.elapsedMs.toLocaleString('vi-VN')} ms</span>
        {item?.truncated && <span className="text-[var(--warn)]">Kết quả đã rút gọn</span>}
        {response.omittedResults > 0 && <span className="text-[var(--warn)]">Còn {response.omittedResults} tập kết quả</span>}
        {item?.columns.length > 0 && <>
          <button type="button" className={buttonClass} disabled={!range && !selectedRows.size} onClick={() => void copySelection(true)}>Copy kèm tên cột</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => {
            setExportScope(selectedRows.size ? 'selected' : onSearch ? 'query' : 'shown')
            exportDialog.current?.showModal()
          }}><Download className="size-3.5" aria-hidden="true" />Xuất</button>
          {selectedRows.size > 0 && <span role="status">Đã chọn {selectedRows.size} dòng</span>}
        </>}
        {onSearch && (options.sort || Boolean(options.filters?.length)) && (
          <button type="button" className="btn-ghost rounded px-1.5 py-0.5" disabled={busy}
            onClick={() => { setFilterColumn(null); search({}) }}>Đặt lại</button>
        )}
        {busy && <span role="status" className="text-[var(--muted)]">Đang tải…</span>}
        {gridMessage && <DismissibleNotice message={gridMessage} className="text-[var(--muted)]"
          onDismiss={() => setGridMessage('')} />}
      </div>
      {item && item.columns.length > 0 && (
        <div ref={viewport} tabIndex={0} aria-label="Dữ liệu kết quả" className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if ((selection || selectedRows.size) && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
              event.preventDefault()
              void copySelection(false)
              return
            }
            if (!selection) return
            const offset = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
            if (!offset) return
            event.preventDefault()
            const row = Math.min(item.rows.length - 1, Math.max(0, selection.end.row + offset[0]))
            const column = Math.min(item.columns.length - 1, Math.max(0, selection.end.column + offset[1]))
            selectCell({ row, column }, event.shiftKey)
            viewport.current?.querySelector(`[data-cell="${row}:${column}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          }}>
          <table className="table-fixed whitespace-nowrap text-left text-xs" style={{ width: 52 + columnWidths.reduce((sum, width) => sum + width, 0) }}>
            <colgroup>
              <col style={{ width: 52 }} />
              {columnWidths.map((width, i) => <col key={i} style={{ width }} />)}
            </colgroup>
            <thead className="sticky top-0 bg-[var(--surface-elevated)]">
              <tr>
                <th scope="col" className="border-b border-[var(--border)] px-3 py-2 text-[var(--muted)]">#</th>
                {item.columns.map((name, i) => {
                  const direction = options.sort?.column === name ? options.sort.direction : undefined
                  const applied = options.filters?.find((filter) => filter.column === name)
                  const kind = response.grid?.columns[name]?.kind ?? (response.stringColumns?.includes(name) ? 'string' : 'other')
                  const ordered = kind === 'number' || kind === 'temporal'
                  return (
                    <th scope="col" key={i} aria-sort={direction === 'ASC' ? 'ascending' : direction === 'DESC' ? 'descending' : undefined}
                      className="relative border-b border-l border-[var(--border)] px-2 py-1.5 align-top font-medium">
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                        {onSearch && <>
                          <button type="button" disabled={busy} title={direction === 'DESC' ? `Bỏ sắp xếp ${name}` : `Sắp xếp ${name} ${direction === 'ASC' ? 'giảm dần' : 'tăng dần'}`}
                            aria-label={`Sắp xếp ${name}`} className="btn-ghost flex shrink-0 flex-col items-center rounded px-1 py-0.5"
                            onClick={() => {
                              const sort = direction === 'DESC' ? undefined : { column: name, direction: direction === 'ASC' ? 'DESC' : 'ASC' } as const
                              search({ ...options, sort })
                            }}>
                            <ChevronUp className={`size-2.5 ${direction === 'ASC' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`} aria-hidden="true" />
                            <ChevronDown className={`size-2.5 -mt-1 ${direction === 'DESC' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`} aria-hidden="true" />
                          </button>
                          <button type="button" disabled={busy} aria-label={`Lọc ${name}`} title={applied ? `Lọc ${name}: ${applied.value}` : `Lọc ${name}`}
                            aria-expanded={filterColumn === name} className={`btn-ghost shrink-0 rounded p-0.5 ${applied ? 'text-[var(--accent)]' : ''}`}
                            onClick={() => {
                              setFilterText(applied?.value ?? '')
                              setFilterEnd(applied?.end ?? '')
                              setFilterOperator(applied?.operator ?? (kind === 'string' ? 'contains' : '='))
                              setFilterColumn(filterColumn === name ? null : name)
                            }}>
                            <Filter className="size-3" aria-hidden="true" />
                          </button>
                        </>}
                      </div>
                      {onSearch && filterColumn === name && (
                        <form className="mt-1 space-y-1" onSubmit={(event) => { event.preventDefault(); applyFilter(name, filterText) }}
                          onKeyDown={(event) => { if (event.key === 'Escape') setFilterColumn(null) }}>
                          {(ordered || kind === 'string') && (
                            <select aria-label={`Toán tử lọc ${name}`} value={filterOperator} disabled={busy}
                              onChange={(event) => setFilterOperator(event.target.value as PostgresFilterOperator)} className="w-full rounded border border-[var(--border)] bg-[var(--bg)] py-0.5">
                              {kind === 'string' && <option value="contains">Mẫu (%…%)</option>}
                              <option value="=">=</option>
                              {ordered && <>
                                <option value=">">&gt;</option><option value=">=">≥</option>
                                <option value="<">&lt;</option><option value="<=">≤</option>
                                <option value="between">Khoảng</option>
                              </>}
                            </select>
                          )}
                          <div className="flex min-w-0 gap-1">
                            {kind === 'boolean' ? (
                              <select autoFocus value={filterText} onChange={(event) => setFilterText(event.target.value)}
                                aria-label={`Từ khóa lọc ${name}`} disabled={busy} className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)]">
                                <option value="">Tất cả</option><option value="true">true</option><option value="false">false</option>
                              </select>
                            ) : (
                              <input autoFocus maxLength={1000} value={filterText} onChange={(event) => setFilterText(event.target.value)}
                                aria-label={`Từ khóa lọc ${name}`} placeholder={filterOperator === 'contains' ? '%từ khóa%' : filterOperator === 'between' ? 'Từ' : 'Giá trị'}
                                inputMode={kind === 'number' ? 'decimal' : undefined} disabled={busy}
                                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 font-normal" />
                            )}
                            <button type="submit" className="btn-ghost shrink-0 rounded px-1" disabled={busy || (filterOperator === 'between' && Boolean(filterText.trim()) && !filterEnd.trim())}
                              aria-label={`Tìm trong ${name}`} title="Tìm kiếm"><Search className="size-3" aria-hidden="true" /></button>
                          </div>
                          {filterOperator === 'between' && (
                            <input maxLength={1000} aria-label={`Cuối khoảng lọc ${name}`} placeholder="Đến" value={filterEnd}
                              onChange={(event) => setFilterEnd(event.target.value)} disabled={busy}
                              className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 font-normal" />
                          )}
                        </form>
                      )}
                      <span aria-hidden="true" className="absolute inset-y-0 right-0 z-10 w-2 touch-none cursor-col-resize hover:bg-[var(--accent)]"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          event.preventDefault()
                          event.currentTarget.setPointerCapture(event.pointerId)
                          drag.current = { x: event.clientX, width: columnWidths[i], column: `${index}:${i}`, pointerId: event.pointerId }
                        }} />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {item.rows.map((row, i) => (
                <tr key={i} aria-selected={selectedRows.has(i)} className={selectedRows.has(i) ? 'bg-[var(--sel)]' : 'hover:bg-[var(--hover)]'}>
                  <th scope="row" className="border-b border-[var(--border)] p-0 text-right font-normal text-[var(--muted)]">
                    <button type="button" className="block w-full px-3 py-1.5 text-right" aria-label={`Chọn dòng ${i + 1}`}
                      aria-pressed={selectedRows.has(i)} title="Ctrl để chọn từng dòng · Shift để chọn một dải"
                      onClick={(event) => {
                        selectRow(i, event.ctrlKey || event.metaKey, event.shiftKey)
                        viewport.current?.focus({ preventScroll: true })
                      }}>{i + 1}</button>
                  </th>
                  {row.map((value, j) => {
                    const pending = draft?.row === i && draft.column === j
                    const display = pending ? draft.edit.value : value
                    const active = range && i >= range.firstRow && i <= range.lastRow && j >= range.firstColumn && j <= range.lastColumn
                    return (
                      <td key={j} data-cell={`${i}:${j}`} title={display ?? 'NULL'}
                        className={`max-w-96 cursor-default truncate border-b border-l border-[var(--border)] px-3 py-1.5 font-mono ${active ? 'bg-[var(--sel)]' : ''} ${pending ? 'text-[var(--warn)]' : ''}`}
                        onClick={(event) => {
                          const toggle = event.ctrlKey || event.metaKey
                          if (toggle || event.shiftKey) selectRow(i, toggle, event.shiftKey)
                          else { rowAnchor.current = i; selectCell({ row: i, column: j }) }
                          viewport.current?.focus({ preventScroll: true })
                        }}
                        onDoubleClick={() => void viewCell({ row: i, column: j })}>
                        {display ?? <span className="italic text-[var(--muted)]">NULL</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {item.rows.length === 0 && <p className="p-3 text-xs text-[var(--muted)]">Kết quả trống.</p>}
        </div>
      )}
      <dialog ref={exportDialog} aria-label="Xuất dữ liệu PostgreSQL"
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] backdrop:bg-black/50"
        onKeyDown={(event) => event.stopPropagation()}>
        <form className="grid gap-3 text-xs" onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const destination = form.get('destination')
          if (destination === 'file' || destination === 'clipboard') submitExport(destination, form.has('includeHeaders'))
        }}>
          <h3 className="text-sm font-semibold">Xuất dữ liệu PostgreSQL</h3>
          <fieldset className="grid gap-1 rounded border border-[var(--border)] px-3 pb-2">
            <legend className="px-1">Phạm vi</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={exportScope === 'selected'} disabled={!selectedRows.size} onChange={() => setExportScope('selected')} />
              Dòng đã chọn ({selectedRows.size})
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={exportScope === 'shown'} onChange={() => setExportScope('shown')} />Dòng đang hiển thị
            </label>
            {onSearch && <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={exportScope === 'query'} onChange={() => setExportScope('query')} />Toàn bộ kết quả theo lọc và sắp xếp hiện tại
            </label>}
          </fieldset>
          <fieldset className="flex gap-4 rounded border border-[var(--border)] px-3 pb-2">
            <legend className="px-1">Định dạng</legend>
            {(['csv', 'json'] as const).map((format) => <label key={format} className="flex items-center gap-2">
              <input type="radio" name="format" checked={exportFormat === format} onChange={() => setExportFormat(format)} />{format.toUpperCase()}
            </label>)}
          </fieldset>
          <fieldset className="flex gap-4 rounded border border-[var(--border)] px-3 pb-2">
            <legend className="px-1">Đích xuất</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="destination" value="file" checked={exportDestination === 'file'} onChange={() => setExportDestination('file')} />File
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="destination" value="clipboard" checked={exportDestination === 'clipboard'} onChange={() => setExportDestination('clipboard')} />Clipboard
            </label>
          </fieldset>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="includeHeaders" checked={includeHeaders} onChange={(event) => setIncludeHeaders(event.target.checked)} />
            Kèm tên cột
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => exportDialog.current?.close()}>Hủy</button>
            <button type="submit" className={primaryClass} disabled={busy}>{exportDestination === 'file' ? 'Chọn file…' : 'Copy vào clipboard'}</button>
          </div>
        </form>
      </dialog>
      {detail && (
        <section aria-label="Giá trị đầy đủ" className="flex max-h-[50%] min-h-0 shrink-0 flex-col gap-2 border-t border-[var(--border)] p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto font-medium">{detailColumn} · Dòng {detail.cell.row + 1}</h3>
            {detail.prettyJson !== undefined && <button type="button" className={buttonClass} aria-pressed={detail.formatted}
              onClick={() => setDetail({ ...detail, formatted: !detail.formatted })}>Định dạng JSON</button>}
            <button type="button" className={buttonClass} onClick={() => void window.workspaceApi.copyPtyText(detail.value ?? '')
              .catch((error) => setGridMessage(formatIpcError(error)))}>Copy giá trị</button>
            {onDraft && !draft && detailColumn !== undefined && response.grid?.primaryKey.length && response.grid.columns[detailColumn]?.editable ? (
              <button type="button" className={buttonClass} disabled={busy} onClick={() => void editCell()}>Sửa ô</button>
            ) : null}
            <button type="button" className={buttonClass} onClick={() => { detailRequest.current++; setDetail(null) }}>Đóng giá trị</button>
          </div>
          <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg)] p-2">{detail.formatted ? detail.prettyJson : detail.value ?? 'NULL'}</pre>
        </section>
      )}
      {draft && onDraft && (
        <section aria-label="Sửa dữ liệu" className="max-h-[55%] shrink-0 space-y-2 overflow-auto border-t border-[var(--border)] p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto font-medium">Sửa {draft.edit.column} · Dòng {draft.row + 1}</h3>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={draft.edit.value === null} disabled={busy}
                onChange={(event) => onDraft({ ...draft, edit: { ...draft.edit, value: event.target.checked ? null : draft.edit.original ?? '' } })} />
              Gán NULL
            </label>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => onDraft()}>Hủy sửa</button>
            <button type="button" className={primaryClass} disabled={busy || draft.edit.value === draft.edit.original} onClick={onSave}>Lưu ô</button>
          </div>
          <textarea aria-label="Giá trị mới" value={draft.edit.value ?? ''} maxLength={2_000_000} disabled={busy || draft.edit.value === null}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono"
            onChange={(event) => onDraft({ ...draft, edit: { ...draft.edit, value: event.target.value } })} />
        </section>
      )}
    </div>
  )
}

interface DatabaseTab {
  id: string
  preview: boolean
  dirty: boolean
  selected: PostgresRelation | null
  tablePreview: boolean
  sql: string
  source: string
  response: PostgresQueryResponse | null
  options?: PostgresPreviewOptions
  draft?: GridDraft
  objectLabel?: string
  objectKey?: string
}

function createDatabaseTab(preview = false): DatabaseTab {
  return {
    id: crypto.randomUUID(), preview, dirty: false, selected: null, tablePreview: false,
    sql: '', source: 'Kết quả', response: null
  }
}

export function DatabaseWorkspace({ visible }: { visible: boolean }): React.JSX.Element | null {
  const [externalEngine, setExternalEngine] = useState<ExternalDatabaseEngine | null>(null)
  const [externalConnected, setExternalConnected] = useState(false)
  const [externalProfiles, setExternalProfiles] = useState(readExternalProfiles)
  const [externalProfile, setExternalProfile] = useState<ExternalDatabaseProfile | null>(null)
  const [connection, setConnection] = useState<PostgresConnectionInfo | null>(null)
  const [profiles, setProfiles] = useState(readProfiles)
  const [profile, setProfile] = useState<PostgresProfile | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [notice, setNotice] = useState('')
  const [databases, setDatabases] = useState<string[]>([])
  const activeCredentials = useRef<{ input: PostgresConnectionInput; credential?: string } | null>(null)
  const [catalog, setCatalog] = useState<PostgresRelation[]>([])
  const [tableDesigner, setTableDesigner] = useState<TableDesignerTarget | null>(null)
  const [objects, setObjects] = useState<PostgresObject[] | null>(null)
  const [search, setSearch] = useState('')
  const [tabs, setTabs] = useState<DatabaseTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const draggedTab = useRef<string | null>(null)
  const [tabDrop, setTabDrop] = useState<{ id: string; after: boolean } | null>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const { selected = null, tablePreview = false, sql = '', response = null, source = 'Kết quả' } = activeTab ?? {}
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const sqlEditor = useRef<editor.IStandaloneCodeEditor | null>(null)
  const shortcutsDialog = useRef<HTMLDialogElement>(null)
  const theme = useSettingsStore((s) => s.settings.theme)
  const lightTheme = THEMES[theme]?.isDark === false

  function updateTab(id: string, changes: Partial<DatabaseTab>): void {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...changes } : tab))
  }

  function addSqlTab(): void {
    const tab = createDatabaseTab()
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setError('')
  }

  function endTabDrag(): void {
    draggedTab.current = null
    setTabDrop(null)
  }

  function moveTab(from: string, to: string, after: boolean): void {
    if (from === to) return
    setTabs((current) => {
      const tab = current.find((item) => item.id === from)
      const remaining = current.filter((item) => item.id !== from)
      const target = remaining.findIndex((item) => item.id === to)
      if (!tab || target < 0) return current
      remaining.splice(target + Number(after), 0, tab)
      return remaining
    })
  }

  function openObjectDraft(name: string, statement: string): void {
    const tab = { ...createDatabaseTab(), objectLabel: name, sql: statement, dirty: true }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setError('')
  }

  function openObject(object: PostgresObject): void {
    if (!connection) return
    const key = `${object.kind}:${object.oid}`
    const existing = tabs.find((tab) => tab.objectKey === key)
    if (existing?.dirty) {
      setActiveTabId(existing.id)
      setError('')
      return
    }
    void run(async () => {
      const statement = await window.workspaceApi.readPostgresObject(connection.id, object.kind, object.oid)
      if (existing) {
        updateTab(existing.id, { sql: statement, objectLabel: object.name })
        setActiveTabId(existing.id)
        return
      }
      const tab = { ...createDatabaseTab(true), objectKey: key, objectLabel: object.name, sql: statement }
      const preview = tabs.find((item) => item.preview)
      setTabs((current) => preview ? current.map((item) => item.id === preview.id ? tab : item) : [...current, tab])
      setActiveTabId(tab.id)
    })
  }

  function applyObjectCatalog(next: PostgresObject[]): void {
    setObjects(next)
    const byKey = new Map(next.map((object) => [`${object.kind}:${object.oid}`, object]))
    const fallback = createDatabaseTab()
    function reconcile(items: DatabaseTab[]): DatabaseTab[] {
      const remaining = items.flatMap((tab) => {
        if (!tab.objectKey) return [tab]
        const object = byKey.get(tab.objectKey)
        if (object) return [{ ...tab, objectLabel: object.name }]
        return tab.dirty ? [{ ...tab, objectKey: undefined, preview: false }] : []
      })
      return remaining.length ? remaining : [fallback]
    }
    const remaining = reconcile(tabs)
    setTabs(reconcile)
    if (!remaining.some((tab) => tab.id === activeTabId)) {
      const previousIndex = tabs.findIndex((tab) => tab.id === activeTabId)
      setActiveTabId(remaining[Math.max(0, Math.min(previousIndex, remaining.length - 1))].id)
    }
  }

  async function refreshObjects(id: string): Promise<void> {
    const next = await window.workspaceApi.listPostgresObjects(id)
    applyObjectCatalog(next)
    const byKey = new Map(next.map((item) => [`${item.kind}:${item.oid}`, item]))
    for (const tab of tabs) {
      const object = tab.objectKey && !tab.dirty ? byKey.get(tab.objectKey) : undefined
      if (!object) continue
      const statement = await window.workspaceApi.readPostgresObject(id, object.kind, object.oid)
      updateTab(tab.id, { sql: statement })
    }
  }

  function dropObject(object: PostgresObject): void {
    if (!connection) return
    void run(async () => {
      await window.workspaceApi.dropPostgresObject(connection.id, object)
      setNotice(`Đã xóa ${object.schema}.${object.name}.`)
      applyObjectCatalog((objects ?? []).filter((entry) => entry.kind !== object.kind || entry.oid !== object.oid))
      const next = await window.workspaceApi.listPostgresObjects(connection.id)
      setObjects(next)
    })
  }

  function closeTab(tab: DatabaseTab): void {
    if ((tab.dirty || tab.draft) && !window.confirm('Đóng tab và bỏ thay đổi chưa lưu?')) return
    const index = tabs.indexOf(tab)
    const remaining = tabs.filter((item) => item.id !== tab.id)
    if (!remaining.length) remaining.push(createDatabaseTab())
    setTabs(remaining)
    if (activeTabId === tab.id) {
      setActiveTabId(remaining[Math.min(index, remaining.length - 1)].id)
      setError('')
    }
  }

  useEffect(() => {
    if (visible) ensureMonacoSetup()
    else sqlEditor.current = null
  }, [visible])

  async function run(action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (err) {
      const message = formatIpcError(err)
      setError(/no handler registered for ['"]postgres:/i.test(message)
        ? 'Phiên Electron đang dùng bản cũ. Hãy khởi động lại Multi-Agent Studio để dùng kết nối PostgreSQL mới.'
        : message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function loadCatalog(id: string): Promise<void> {
    const next = await window.workspaceApi.listPostgresRelations(id)
    setCatalog(next)
  }

  async function applyStructure(change: PostgresStructureChange): Promise<void> {
    if (!connection || busyRef.current) throw new Error('Hãy đợi thao tác hiện tại hoàn tất.')
    const affected = tabs.filter((tab) => tab.selected?.schema === change.schema && tab.selected.name === change.table)
    if (affected.some((tab) => tab.draft)) throw new Error('Hãy lưu hoặc hủy thay đổi dữ liệu của bảng trước khi sửa cấu trúc.')
    let failure: unknown
    await run(async () => {
      try {
        await window.workspaceApi.applyPostgresStructure(connection.id, change)
      } catch (cause) {
        failure = cause
        return
      }
      setNotice(change.op === 'create-table' ? 'Đã tạo bảng PostgreSQL.' : 'Đã cập nhật cấu trúc PostgreSQL.')
      const next = await window.workspaceApi.listPostgresRelations(connection.id)
      setCatalog(next)
      if (change.op === 'drop-table' && affected.length) {
        const removed = new Set(affected.filter((tab) => !tab.dirty).map((tab) => tab.id))
        const remaining = tabs.filter((tab) => !removed.has(tab.id))
        if (!remaining.length) remaining.push(createDatabaseTab())
        setTabs(remaining)
        if (removed.has(activeTabId)) setActiveTabId(remaining[0].id)
      }
      const relation = change.op === 'drop-table' ? null : next.find((item) =>
        item.schema === (change.op === 'edit-table' ? change.newSchema : change.schema) &&
        item.name === (change.op === 'edit-table' ? change.name : change.table)) ?? null
      for (const tab of affected) {
        updateTab(tab.id, {
          selected: relation, response: null, options: undefined, tablePreview: Boolean(relation && !tab.dirty),
          source: relation ? `${relation.schema}.${relation.name} · Dữ liệu` : 'Bảng đã xóa',
          ...(relation && !tab.dirty ? { sql: postgresPreviewSql(relation.schema, relation.name) } : {})
        })
        if (relation && !tab.dirty) {
          const result = await window.workspaceApi.inspectPostgresRelation(connection.id, relation.schema, relation.name, 'data')
          updateTab(tab.id, { response: result })
        }
      }
      if (objects !== null) await refreshObjects(connection.id)
    })
    if (failure !== undefined) throw failure
  }

  async function columnsForObject(table: PostgresRelation): Promise<string[]> {
    if (!connection) return []
    let columns: string[] = []
    await run(async () => {
      const result = await window.workspaceApi.inspectPostgresRelation(connection.id, table.schema, table.name, 'columns')
      columns = (result.results[0]?.rows ?? []).flatMap(([name]) => name === null ? [] : [name])
    })
    return columns
  }

  function storeProfiles(next: PostgresProfile[]): void {
    localStorage.setItem(profilesKey, JSON.stringify(next))
    setProfiles(next)
  }

  function submitConnection(request: () => ConnectionRequest, test: boolean): void {
    void run(async () => {
      if (typeof window.workspaceApi.testPostgres !== 'function') {
        throw new Error('Phiên Electron đang dùng bản cũ. Hãy khởi động lại Multi-Agent Studio để dùng kết nối PostgreSQL mới.')
      }
      const { input, allDatabases, save, savePassword } = request()
      const credential = profile?.credential
      if (test) {
        await window.workspaceApi.testPostgres(input, credential)
        setNotice('Kết nối PostgreSQL thành công.')
        return
      }
      const sealed = save && savePassword ? await window.workspaceApi.sealPostgresPassword(input, credential) : undefined
      const active = await window.workspaceApi.connectPostgres(input, credential)
      activeCredentials.current = { input, credential }
      setConnection(active)
      await runStarterSql(active.id)
      await loadCatalog(active.id)
      if (allDatabases) setDatabases(await window.workspaceApi.listPostgresDatabases(active.id))
      if (save) {
        const { password: _password, ...settings } = input
        const saved = { ...settings, id: profile?.id ?? crypto.randomUUID(), allDatabases, credential: sealed }
        storeProfiles([...profiles.filter(({ id }) => id !== saved.id), saved])
        setProfile(saved)
      }
    })
  }

  function openRelation(relation: PostgresRelation): void {
    if (!connection || busyRef.current) return
    const existing = tabs.find((tab) => tab.selected?.schema === relation.schema && tab.selected.name === relation.name)
    if (existing) {
      setActiveTabId(existing.id)
      setError('')
      return
    }
    const preview = { ...createDatabaseTab(true), selected: relation }
    const replace = tabs.find((tab) => tab.preview)
    setTabs((current) => replace ? current.map((tab) => tab.id === replace.id ? preview : tab) : [...current, preview])
    setActiveTabId(preview.id)
    inspect(relation, 'data', preview.id)
  }

  function inspect(relation: PostgresRelation, mode: 'data' | 'columns', tabId = activeTabId): void {
    if (!connection || !tabId) return
    void run(async () => {
      const changes: Partial<DatabaseTab> = {
        tablePreview: mode === 'data',
        options: undefined,
        source: `${relation.schema}.${relation.name} · ${mode === 'data' ? 'Dữ liệu' : 'Cột'}`,
        response: null
      }
      if (mode === 'data' && (!activeTab?.dirty || tabId !== activeTab.id)) {
        changes.sql = postgresPreviewSql(relation.schema, relation.name)
      }
      updateTab(tabId, changes)
      const result = await window.workspaceApi.inspectPostgresRelation(connection.id, relation.schema, relation.name, mode)
      if (mode === 'data' && result.stringColumns === undefined) {
        // An older Electron main process can still provide types through the column inspection API.
        const metadata = await window.workspaceApi.inspectPostgresRelation(connection.id, relation.schema, relation.name, 'columns')
        const columns = metadata.results[0]
        if (!columns?.rows.length && result.results[0]?.columns.length) {
          throw new Error('Không đọc được kiểu cột PostgreSQL. Hãy tải lại dữ liệu bảng.')
        }
        result.stringColumns = (columns?.rows ?? []).flatMap(([name, type]) => {
          const isString = /^(?:text|name|"char"|character(?: varying)?(?:\(\d+\))?)$/.test(type ?? '')
          return name !== null && isString ? [name] : []
        })
      }
      updateTab(tabId, { response: result })
    })
  }

  async function executeSql(id: string, statement: string, tabId = activeTabId): Promise<void> {
    updateTab(tabId, { tablePreview: false, source: 'Kết quả SQL', response: null })
    const result = await window.workspaceApi.queryPostgres(id, statement)
    updateTab(tabId, { response: result })
    if (result.results.some(({ command }) => /^(CREATE|ALTER|DROP|REINDEX|COMMIT|ROLLBACK)$/.test(command))) {
      await loadCatalog(id)
      if (objects !== null || activeTab?.objectLabel) await refreshObjects(id)
    }
  }

  function searchTable(options: PostgresPreviewOptions): void {
    if (!connection || !selected || !tablePreview || activeTab?.draft) return
    void run(async () => {
      const statement = postgresPreviewSql(selected.schema, selected.name, options)
      updateTab(activeTabId, { sql: statement })
      const result = await window.workspaceApi.browsePostgres(connection.id, selected.schema, selected.name, options)
      updateTab(activeTabId, { response: result, options })
    })
  }

  function saveEdit(): void {
    const draft = activeTab?.draft
    if (!connection || !selected || !draft || draft.edit.value === draft.edit.original) return
    void run(async () => {
      await window.workspaceApi.savePostgresCell(connection.id, selected.schema, selected.name, draft.edit)
      updateTab(activeTabId, { draft: undefined, response: null })
      setNotice('Đã lưu ô vào PostgreSQL.')
      const result = await window.workspaceApi.browsePostgres(connection.id, selected.schema, selected.name, activeTab.options ?? {})
      updateTab(activeTabId, { response: result })
    })
  }

  function exportResult(format: PostgresExportFormat, destination: PostgresExportDestination, includeHeaders: boolean, page?: PostgresExportPage): void {
    if (!connection || (!page && !selected)) return
    void run(async () => {
      const source = { ...(page ?? { schema: selected!.schema, table: selected!.name, options: activeTab?.options ?? {} }), includeHeaders }
      if (destination === 'clipboard') {
        if (typeof window.workspaceApi.copyPostgresExport !== 'function') {
          throw new Error('Hãy khởi động lại Multi-Agent Studio để dùng chức năng xuất vào clipboard.')
        }
        await window.workspaceApi.copyPostgresExport(connection.id, format, source)
        setNotice('Đã copy dữ liệu vào clipboard.')
      } else if (await window.workspaceApi.exportPostgres(connection.id, format, source)) {
        setNotice('Đã xuất dữ liệu PostgreSQL.')
      }
    })
  }

  async function runStarterSql(id: string): Promise<void> {
    const tab = { ...createDatabaseTab(true), sql: starterSql }
    setTabs([tab])
    setActiveTabId(tab.id)
    await executeSql(id, starterSql, tab.id)
  }

  function runSql(): void {
    if (!connection || activeTab?.draft) return
    const instance = sqlEditor.current
    const selection = instance?.getSelection()
    const statement = (selection && instance?.getModel()?.getValueInRange(selection).trim()) || sql.trim()
    if (!statement) return
    void run(() => executeSql(connection.id, statement))
  }

  function storeExternalProfiles(next: ExternalDatabaseProfile[]): void {
    setExternalProfiles(next)
    localStorage.setItem(externalProfilesKey, JSON.stringify(next))
  }

  function saveExternalProfile(next: ExternalDatabaseProfile): void {
    const idx = externalProfiles.findIndex((item) => item.id === next.id)
    const updated = idx >= 0
      ? externalProfiles.map((item, i) => (i === idx ? next : item))
      : [...externalProfiles, next]
    storeExternalProfiles(updated)
    setExternalProfile(next)
  }

  if (externalEngine && externalConnected) {
    return (
      <ExternalDatabaseWorkspace
        key={`${externalEngine}:${externalProfile?.id ?? 'new'}`}
        engine={externalEngine}
        visible={visible}
        profile={externalProfile}
        onBack={() => { setExternalEngine(null); setExternalConnected(false); setExternalProfile(null) }}
        onConnectedChange={setExternalConnected}
        onSaveProfile={saveExternalProfile}
      />
    )
  }
  if (!visible) return null
  const draftSql = activeTab?.draft && selected && response?.grid
    ? postgresCellUpdate(selected.schema, selected.name, response.grid.primaryKey, activeTab.draft.edit).statement
    : null

  const groups = new Map<string, PostgresRelation[]>()
  const filter = search.trim().toLowerCase()
  for (const relation of catalog) {
    if (!`${relation.schema}.${relation.name}`.toLowerCase().includes(filter)) continue
    const group = groups.get(relation.schema)
    if (group) group.push(relation)
    else groups.set(relation.schema, [relation])
  }

  return (
    <section aria-label="Database" style={{ colorScheme: lightTheme ? 'light' : 'dark' }} className="flex min-h-0 min-w-0 flex-1 flex-col" data-database-workspace>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--header)] px-4 py-2.5">
        {connection
          ? <img src={postgresLogo} alt="PostgreSQL" className="size-4 object-contain" />
          : <Database className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />}
        <h1 className="text-sm font-semibold">Database</h1>
        {connection && <>
          <span className="max-w-full truncate text-xs text-[var(--ok)]" title={`${connection.user}@${connection.host}:${connection.port}`}>
            {connection.database} · {connection.host}:{connection.port}
          </span>
          <button type="button" className={`${buttonClass} ml-auto`} title="Phím tắt SQL" aria-label="Phím tắt SQL" aria-haspopup="dialog"
            onClick={() => shortcutsDialog.current?.showModal()}><CircleHelp className="size-3.5" aria-hidden="true" /></button>
          <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => {
            if (tabs.some((tab) => tab.draft) && !window.confirm('Ngắt kết nối và bỏ các ô chưa lưu?')) return
            await window.workspaceApi.disconnectPostgres(connection.id)
            activeCredentials.current = null
            setConnection(null)
            setDatabases([])
            setTabs([])
            setActiveTabId('')
            setCatalog([])
            setObjects(null)
            setSearch('')
          })}><Unplug className="h-3.5 w-3.5" aria-hidden="true" />Ngắt kết nối</button>
        </>}
      </header>
      {connection && (
        <dialog ref={shortcutsDialog} aria-labelledby="database-shortcuts-title"
          className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] shadow-xl backdrop:bg-black/50"
          onKeyDown={(event) => event.stopPropagation()}>
          <form method="dialog">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="database-shortcuts-title" className="text-sm font-semibold">Phím tắt trình soạn SQL</h2>
              <button type="submit" className={buttonClass}>Đóng</button>
            </div>
            <dl className="divide-y divide-[var(--border)] text-xs">
              {sqlShortcuts.map(([keys, action]) => (
                <div key={keys} className="flex items-center justify-between gap-4 py-2">
                  <dt>{action}</dt>
                  <dd><kbd className="whitespace-nowrap rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5">{keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </form>
        </dialog>
      )}
      {error && <DismissibleNotice message={error} role="alert" onDismiss={() => setError('')}
        className="shrink-0 border-b border-[var(--border)] bg-[var(--err-bg)] px-4 py-2 text-xs text-[var(--err)]" />}
      {notice && <DismissibleNotice message={notice} onDismiss={() => setNotice('')}
        className="shrink-0 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--ok)]" />}
      {connection && tableDesigner && (
        <PostgresTableDesigner connectionId={connection.id} target={tableDesigner}
          schemas={[...new Set(['public', ...catalog.map((relation) => relation.schema)])]}
          onClose={() => setTableDesigner(null)} onApply={applyStructure} />
      )}
      {!connection ? (
        <div className="flex min-h-0 flex-1">
          {(profiles.length > 0 || externalProfiles.length > 0) && <aside aria-label="Nguồn dữ liệu" className="w-52 shrink-0 overflow-auto border-r border-[var(--border)] bg-[var(--surface)] p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold">Nguồn dữ liệu</h2>
              <button type="button" title="Thêm nguồn dữ liệu" aria-label="Thêm nguồn dữ liệu" className="btn-ghost rounded p-1.5" disabled={busy}
                onClick={() => { setExternalEngine(null); setExternalConnected(false); setExternalProfile(null); setShowSetup(false); setProfile(null); setError(''); setNotice('') }}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {profiles.map((saved) => (
              <div key={saved.id} className="flex items-center gap-0.5">
                <button type="button" disabled={busy} aria-pressed={!externalEngine && saved.id === profile?.id && showSetup}
                  className="btn-ghost flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs aria-pressed:bg-[var(--sel)]"
                  title={`${saved.user}@${saved.host}:${saved.port}/${saved.database}`}
                  onClick={() => { setExternalEngine(null); setExternalConnected(false); setExternalProfile(null); setProfile(saved); setShowSetup(true); setError(''); setNotice('') }}>
                  <img src={postgresLogo} alt="PostgreSQL" className="size-4 shrink-0 object-contain" />
                  <span className="truncate">{saved.database} · {saved.host}:{saved.port}</span>
                </button>
                <button type="button" disabled={busy} className="btn-ghost rounded p-1.5" title="Xóa kết nối đã lưu" aria-label={`Xóa kết nối ${saved.database}`}
                  onClick={() => void run(async () => {
                    storeProfiles(profiles.filter(({ id }) => id !== saved.id))
                    if (profile?.id === saved.id) setProfile(null)
                  })}><Trash2 className="h-3.5 w-3.5 text-[var(--muted)]" aria-hidden="true" /></button>
              </div>
            ))}
            {externalProfiles.map((saved) => (
              <div key={saved.id} className="flex items-center gap-0.5">
                <button type="button" disabled={busy} aria-pressed={externalEngine === saved.engine && externalProfile?.id === saved.id}
                  className="btn-ghost flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs aria-pressed:bg-[var(--sel)]"
                  title={`${externalDatabaseLabels[saved.engine]} · ${saved.connectString || `${saved.host}:${saved.port}`}${saved.database ? `/${saved.database}` : ''}`}
                  onClick={() => { setExternalConnected(false); setExternalEngine(saved.engine); setExternalProfile(saved); setShowSetup(false); setProfile(null); setError(''); setNotice('') }}>
                  <img src={externalDatabaseLogos[saved.engine]} alt={externalDatabaseLabels[saved.engine]} className="size-4 shrink-0 object-contain" />
                  <span className="truncate">{saved.label || saved.database || saved.host} · {saved.host}</span>
                </button>
                <button type="button" disabled={busy} className="btn-ghost rounded p-1.5" title="Xóa kết nối đã lưu" aria-label={`Xóa kết nối ${saved.label || saved.database}`}
                  onClick={() => void run(async () => {
                    storeExternalProfiles(externalProfiles.filter(({ id }) => id !== saved.id))
                    if (externalProfile?.id === saved.id) setExternalProfile(null)
                  })}><Trash2 className="h-3.5 w-3.5 text-[var(--muted)]" aria-hidden="true" /></button>
              </div>
            ))}
          </aside>}
          <div className="min-w-0 flex-1 overflow-auto">
            {externalEngine ? (
              <ExternalDatabaseWorkspace
                key={`${externalEngine}:${externalProfile?.id ?? 'new'}`}
                engine={externalEngine}
                visible={visible}
                embedded
                profile={externalProfile}
                onBack={() => { setExternalEngine(null); setExternalConnected(false); setExternalProfile(null) }}
                onConnectedChange={setExternalConnected}
                onSaveProfile={saveExternalProfile}
              />
            ) : showSetup ? (
              <div className="mx-auto w-full max-w-xl px-4 py-4">
                <button type="button" disabled={busy} className="btn-ghost mb-2.5 inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                  onClick={() => { setShowSetup(false); setProfile(null); setError(''); setNotice('') }}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Chọn loại database
                </button>
                <ConnectionForm key={profile?.id ?? 'new'} busy={busy} profile={profile} onSubmit={submitConnection} run={run} />
              </div>
            ) : (
              <DatabaseEnginePicker onChoose={(engine) => {
                if (engine === 'postgres') { setProfile(null); setShowSetup(true) }
                else { setExternalConnected(false); setExternalProfile(null); setExternalEngine(engine) }
              }} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Schema và bảng" className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] max-lg:w-48">
            <div className="flex items-center justify-between px-3 pt-2">
              <h2 className="text-xs font-semibold">Schema và bảng</h2>
              <button type="button" className="btn-ghost ml-auto rounded p-1.5 disabled:opacity-50" aria-label="Tạo bảng" title="Tạo bảng" disabled={busy}
                onClick={() => setTableDesigner({ operation: 'create', schema: selected?.schema ?? 'public' })}><Plus className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="btn-ghost rounded p-1.5 disabled:opacity-50" aria-label="Làm mới danh sách bảng" title="Làm mới danh sách bảng" disabled={busy}
                onClick={() => void run(() => loadCatalog(connection.id))}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div>
            <div className="px-3 pb-2">
              {databases.length > 0 && (
                <select aria-label="Database đang dùng" className={fieldClass} disabled={busy} value={connection.database}
                  onChange={(event) => {
                    const database = event.target.value
                    const credentials = activeCredentials.current
                    if (!credentials || database === connection.database) return
                    if (tabs.some((tab) => tab.draft) && !window.confirm('Chuyển database và bỏ các ô chưa lưu?')) return
                    void run(async () => {
                      const input = { ...credentials.input, database }
                      const active = await window.workspaceApi.connectPostgres(input, credentials.credential, connection.id)
                      activeCredentials.current = { ...credentials, input }
                      setConnection(active)
                      setCatalog([])
                      setObjects(null)
                      await runStarterSql(active.id)
                      await loadCatalog(active.id)
                    })
                  }}>
                  {databases.map((name) => <option key={name}>{name}</option>)}
                </select>
              )}
              <input aria-label="Tìm bảng" placeholder="Tìm bảng…" className={`${fieldClass} !py-1.5 !text-xs`} value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              {groups.size === 0 && <p className="px-1 py-2 text-xs text-[var(--muted)]">{busy ? 'Đang đọc danh sách…' : 'Không tìm thấy bảng hoặc view.'}</p>}
              {[...groups].map(([schema, relations]) => (
                <details key={schema} open>
                  <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-xs font-medium">
                    <ChevronDown className="h-3.5 w-3.5 text-[var(--muted)]" aria-hidden="true" />{schema}
                  </summary>
                  {relations.map((relation) => {
                    const active = selected?.schema === relation.schema && selected.name === relation.name
                    const Icon = relation.kind === 'table' ? Table2 : Eye
                    return (
                      <div key={relation.name} className="flex items-center gap-0.5">
                        <button type="button" title={`${relation.name} · ${relation.kind}`} aria-pressed={active} disabled={busy}
                          onClick={() => openRelation(relation)} className="btn-ghost flex min-w-0 flex-1 items-center gap-2 rounded py-1.5 pl-5 pr-1 text-left text-xs aria-pressed:bg-[var(--sel)] disabled:opacity-70">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                          <span className="truncate">{relation.name}</span>
                        </button>
                        {relation.kind === 'table' && <button type="button" className="btn-ghost shrink-0 rounded p-1 text-[var(--muted)]"
                          disabled={busy} aria-label={`Quản lý cấu trúc ${relation.schema}.${relation.name}`} title="Quản lý cấu trúc"
                          onClick={() => setTableDesigner({ operation: 'manage', relation })}><Pencil className="size-3" aria-hidden="true" /></button>}
                      </div>
                    )
                  })}
                </details>
              ))}
              <PostgresObjects key={connection.id} objects={objects} relations={catalog} selected={selected} busy={busy}
                onLoad={() => void run(() => refreshObjects(connection.id))}
                onOpen={openObject} onDraft={openObjectDraft} onColumns={columnsForObject} onDrop={dropObject} />
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div role="group" aria-label="Tab database" className="flex shrink-0 items-stretch overflow-x-auto border-b border-[var(--border)] bg-[var(--header)]">
              {tabs.map((tab) => {
                const name = tab.selected?.name ?? tab.objectLabel ?? 'SQL'
                const hasObject = Boolean(tab.selected || tab.objectLabel)
                const kept = hasObject && !tab.preview
                const marker = tab.draft ? 'Dữ liệu chưa lưu' : tab.dirty ? 'SQL chưa lưu' : kept ? 'Đã giữ tab' : ''
                return (
                  <div key={tab.id} className={`relative flex shrink-0 items-center border-r border-[var(--border)] ${tab.id === activeTabId ? 'bg-[var(--sel)]' : ''}`}
                    onDragOver={(event) => {
                      if (!draggedTab.current || busy) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      if (draggedTab.current === tab.id) {
                        setTabDrop(null)
                        return
                      }
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const after = event.clientX >= bounds.left + bounds.width / 2
                      setTabDrop((current) => current?.id === tab.id && current.after === after ? current : { id: tab.id, after })
                    }}
                    onDragLeave={(event) => {
                      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                        setTabDrop((current) => current?.id === tab.id ? null : current)
                      }
                    }}
                    onDrop={(event) => {
                      const from = draggedTab.current
                      if (!from) return
                      event.preventDefault()
                      const bounds = event.currentTarget.getBoundingClientRect()
                      if (!busy) moveTab(from, tab.id, event.clientX >= bounds.left + bounds.width / 2)
                      endTabDrag()
                    }}>
                    {tabDrop?.id === tab.id && <span aria-hidden="true"
                      className={`pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-[var(--accent)] ${tabDrop.after ? 'right-0' : 'left-0'}`} />}
                    <button type="button" disabled={busy} aria-pressed={tab.id === activeTabId} draggable={!busy}
                      onDragStart={(event) => {
                        draggedTab.current = tab.id
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-database-tab', tab.id)
                      }}
                      onDragEnd={endTabDrag}
                      title={tab.selected ? `${tab.selected.schema}.${name}` : name}
                      className={`flex max-w-52 items-center gap-2 px-3 py-2 text-xs ${tab.preview && hasObject ? 'italic' : ''}`}
                      onClick={() => { setActiveTabId(tab.id); setError('') }}
                      onDoubleClick={() => updateTab(tab.id, { preview: false })}>
                      <span className="truncate">{name}</span>
                      {marker && <span className="size-2 shrink-0 rounded-full bg-[var(--accent)]" role="img" aria-label={marker} title={marker} />}
                    </button>
                    <button type="button" disabled={busy} className="btn-ghost mr-1 rounded p-1"
                      aria-label={`Đóng tab ${name}`} onClick={() => closeTab(tab)}><X className="size-3" aria-hidden="true" /></button>
                  </div>
                )
              })}
              <button type="button" title="Tab SQL mới" aria-label="Tab SQL mới" disabled={busy}
                className="btn-ghost shrink-0 px-2" onClick={addSqlTab}><Plus className="size-4" aria-hidden="true" /></button>
            </div>
            <section aria-label="Trình soạn SQL" className="flex h-1/3 min-h-28 shrink-0 flex-col border-b border-[var(--border)]"
              onKeyDownCapture={(event) => {
                if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
                event.preventDefault()
                event.stopPropagation()
                runSql()
              }}>
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
                <h2 className="text-xs font-semibold">{draftSql ? 'SQL cập nhật đang chờ lưu' : 'SQL'}</h2>
                <button type="button" title="Chạy vùng chọn hoặc toàn bộ SQL (Ctrl+Enter)" className={primaryClass} disabled={busy || Boolean(activeTab?.draft) || !sql.trim()} onClick={runSql}>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />Chạy SQL
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <Editor key={`${activeTabId}:${draftSql ? 'draft' : 'query'}`} height="100%" language="sql" theme={lightTheme ? 'light' : 'vs-dark'} value={draftSql ?? sql}
                  onMount={(instance) => { sqlEditor.current = instance }}
                  onChange={(value) => {
                    if (draftSql) return
                    const nextSql = value ?? ''
                    setTabs((current) => current.map((tab) =>
                      tab.id === activeTabId && tab.sql !== nextSql
                        ? { ...tab, sql: nextSql, preview: false, dirty: true }
                        : tab))
                  }}
                  options={{ ariaLabel: 'Câu lệnh SQL', minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', readOnly: busy || Boolean(draftSql) }} />
              </div>
            </section>
            <section aria-label="Kết quả PostgreSQL" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5">
                <h2 className="mr-auto truncate text-xs font-semibold">{source}</h2>
                {selected && <>
                  {selected.kind === 'table' && <button type="button" disabled={busy} className={buttonClass}
                    onClick={() => setTableDesigner({ operation: 'manage', relation: selected })}>Quản lý cấu trúc</button>}
                  <button type="button" disabled={busy || Boolean(activeTab?.draft)} className={buttonClass} onClick={() => inspect(selected, 'data')}>Dữ liệu</button>
                  <button type="button" disabled={busy || Boolean(activeTab?.draft)} className={buttonClass} onClick={() => inspect(selected, 'columns')}>Cấu trúc cột</button>
                </>}
              </div>
              {busy && !response && <p role="status" className="p-3 text-xs text-[var(--muted)]">Đang xử lý…</p>}
              {!busy && !response && !error && <p className="p-3 text-xs text-[var(--muted)]">Chọn bảng để xem dữ liệu hoặc chạy câu lệnh SQL.</p>}
              {tabs.map((tab) => tab.response && (
                <div key={`${tab.id}:${tab.source}`} hidden={tab.id !== activeTabId}
                  className={tab.id === activeTabId ? 'flex min-h-0 flex-1 flex-col' : undefined}>
                  <ResultGrid response={tab.response} busy={busy} connectionId={connection.id} options={tab.options ?? emptyPreviewOptions}
                    draft={tab.draft} onSave={saveEdit} onExport={exportResult}
                    onDraft={tab.id === activeTabId && tablePreview && selected && !tab.dirty ? (draft) => updateTab(tab.id, { draft, preview: false }) : undefined}
                    onSearch={tab.id === activeTabId && tablePreview && selected && !tab.dirty && !tab.draft ? searchTable : undefined} />
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </section>
  )
}
