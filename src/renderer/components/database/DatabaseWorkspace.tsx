import Editor from '@monaco-editor/react'
import { ArrowLeft, ChevronDown, Database, Eye, EyeOff, Play, Plug, Plus, RefreshCw, Table2, Trash2, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { editor } from 'monaco-editor'
import type {
  PostgresConnectionInfo,
  PostgresConnectionInput,
  PostgresProfile,
  PostgresQueryResponse,
  PostgresRelation
} from '@shared/types/database'
import postgresLogo from '../../assets/postgresql.png'
import { ensureMonacoSetup } from '../../lib/monaco-setup'
import { formatIpcError } from '../../lib/os-actions'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { parsePostgresUrl } from './postgres-url'

const initialConnection: PostgresConnectionInput = {
  host: 'localhost', port: 5432, database: 'postgres', user: 'postgres', password: '', ssl: false
}
const starterSql = 'SELECT current_database(), current_user;'
const fieldClass = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]'
const buttonClass = 'btn-ghost inline-flex items-center justify-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs disabled:opacity-50'
const primaryClass = 'inline-flex items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50'

const profilesKey = 'multi-agent-studio.postgres-profiles'
const savedPasswordMask = '••••••••'

function readProfiles(): PostgresProfile[] {
  try {
    const profiles: unknown = JSON.parse(localStorage.getItem(profilesKey) ?? '[]')
    return Array.isArray(profiles) ? profiles.filter((item): item is PostgresProfile =>
      item && typeof item.id === 'string' && typeof item.host === 'string' &&
      Number.isInteger(item.port) && typeof item.database === 'string' && typeof item.user === 'string' &&
      typeof item.ssl === 'boolean' && typeof item.allDatabases === 'boolean' &&
      (item.credential === undefined || typeof item.credential === 'string')
    ) : []
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

function ConnectionForm({ busy, profile, onSubmit }: {
  busy: boolean
  profile: PostgresProfile | null
  onSubmit: (request: () => ConnectionRequest, test: boolean) => void
}): React.JSX.Element {
  const initial = profile ?? initialConnection
  const [host, setHost] = useState(initial.host)
  const [ssl, setSsl] = useState(initial.ssl)
  const [method, setMethod] = useState<'host' | 'url'>('host')
  const [save, setSave] = useState(Boolean(profile))
  const [allDatabases, setAllDatabases] = useState(profile?.allDatabases ?? false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [revealedPassword, setRevealedPassword] = useState('')
  const [revealing, setRevealing] = useState(false)
  const [passwordError, setPasswordError] = useState('')

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
      const fields = {
        host: host.trim(),
        port: Number(form.get('port') || 5432),
        database: String(form.get('database') || (allDatabases ? 'postgres' : '')),
        user: String(form.get('user') ?? ''),
        password,
        ssl
      }
      return {
        input: method === 'url' ? parsePostgresUrl(String(form.get('url')), fields) : fields,
        allDatabases, save, savePassword: form.get('savePassword') === 'on'
      }
    }, submitter?.getAttribute('data-test-connection') === 'true')
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" autoComplete="off">
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-lg bg-[var(--accent-soft)] p-2.5"><img src={postgresLogo} alt="" className="size-5 object-contain" /></div>
        <h2 className="text-base font-semibold">Kết nối PostgreSQL</h2>
      </div>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-xs">Kiểu kết nối
          <select value={method} className={fieldClass} onChange={(event) => {
            const value = event.target.value === 'url' ? 'url' : 'host'
            setMethod(value)
            if (value === 'url') setSsl(true)
          }}>
            <option value="host">Host và port</option>
            <option value="url">URL PostgreSQL</option>
          </select>
        </label>
        {method === 'url' ? (
          <label className="block text-xs">URL
            <input name="url" type="password" required className={fieldClass} placeholder="postgresql://host:5432/database" />
          </label>
        ) : <>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <label className="text-xs">Host
            <input name="host" required value={host} className={fieldClass} onChange={(event) => {
              const value = event.target.value
              setHost(value)
              setSsl(!['localhost', '127.0.0.1', '::1', ''].includes(value.trim().toLowerCase()))
            }} />
          </label>
          <label className="text-xs">Port
            <input name="port" type="number" min="1" max="65535" required defaultValue={initial.port} className={fieldClass} />
          </label>
        </div>
        <label className="block text-xs">Database
          <input name="database" required={!allDatabases} defaultValue={initial.database} className={fieldClass} placeholder="postgres" />
        </label>
        </>}
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={allDatabases} onChange={(event) => setAllDatabases(event.target.checked)} />
          Hiển thị tất cả database có quyền kết nối
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">Người dùng
            <input name="user" autoComplete="username" required={method === 'host'} defaultValue={initial.user} className={fieldClass} />
          </label>
          <div className="text-xs">
            <label htmlFor="postgres-password">Mật khẩu</label>
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
            {passwordError && <p role="alert" className="mt-1 text-[var(--err)]">{passwordError}</p>}
          </div>
        </div>
        <label className="block text-xs">SSL
          <select name="ssl" value={ssl ? 'verify' : 'disable'} onChange={(event) => setSsl(event.target.value === 'verify')} className={fieldClass}>
            <option value="verify">Xác minh chứng chỉ máy chủ</option>
            <option value="disable">Tắt SSL</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />Lưu kết nối</label>
          <label className="flex items-center gap-2"><input type="checkbox" key={String(save)} name="savePassword" disabled={!save} defaultChecked={Boolean(profile?.credential) && save} />Lưu mật khẩu</label>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] pt-3">
          <button type="submit" className={`${primaryClass} order-2`}><Plug className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Đang xử lý…' : 'Kết nối'}</button>
          <button type="submit" data-test-connection="true" className={`${buttonClass} order-1`}>Test Connection</button>
        </div>
      </fieldset>
    </form>
  )
}

function ResultGrid({ response }: { response: PostgresQueryResponse }): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const item = response.results[index]
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
      </div>
      {item && item.columns.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-max min-w-full whitespace-nowrap text-left text-xs">
            <thead className="sticky top-0 bg-[var(--surface-elevated)]">
              <tr>
                <th scope="col" className="border-b border-[var(--border)] px-3 py-2 text-[var(--muted)]">#</th>
                {item.columns.map((name, i) => <th scope="col" key={i} className="border-b border-l border-[var(--border)] px-3 py-2 font-medium">{name}</th>)}
              </tr>
            </thead>
            <tbody>
              {item.rows.map((row, i) => (
                <tr key={i} className="hover:bg-[var(--hover)]">
                  <th scope="row" className="border-b border-[var(--border)] px-3 py-1.5 text-right font-normal text-[var(--muted)]">{i + 1}</th>
                  {row.map((value, j) => (
                    <td key={j} title={value ?? 'NULL'} className="max-w-96 truncate border-b border-l border-[var(--border)] px-3 py-1.5 font-mono">
                      {value ?? <span className="italic text-[var(--muted)]">NULL</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {item.rows.length === 0 && <p className="p-3 text-xs text-[var(--muted)]">Kết quả trống.</p>}
        </div>
      )}
    </div>
  )
}

export function DatabaseWorkspace({ visible }: { visible: boolean }): React.JSX.Element | null {
  const [connection, setConnection] = useState<PostgresConnectionInfo | null>(null)
  const [profiles, setProfiles] = useState(readProfiles)
  const [profile, setProfile] = useState<PostgresProfile | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [notice, setNotice] = useState('')
  const [databases, setDatabases] = useState<string[]>([])
  const activeCredentials = useRef<{ input: PostgresConnectionInput; credential?: string } | null>(null)
  const [catalog, setCatalog] = useState<PostgresRelation[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<PostgresRelation | null>(null)
  const [sql, setSql] = useState(starterSql)
  const [response, setResponse] = useState<PostgresQueryResponse | null>(null)
  const [source, setSource] = useState('Kết quả')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const sqlEditor = useRef<editor.IStandaloneCodeEditor | null>(null)
  const theme = useSettingsStore((s) => s.settings.theme)

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
    setSelected((current) => current ? next.find((item) => item.schema === current.schema && item.name === current.name) ?? null : null)
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

  function inspect(relation: PostgresRelation, mode: 'data' | 'columns'): void {
    if (!connection) return
    void run(async () => {
      setSelected(relation)
      setSource(`${relation.schema}.${relation.name} · ${mode === 'data' ? 'Dữ liệu' : 'Cột'}`)
      setResponse(null)
      setResponse(await window.workspaceApi.inspectPostgresRelation(connection.id, relation.schema, relation.name, mode))
    })
  }

  function runSql(): void {
    if (!connection) return
    const instance = sqlEditor.current
    const selection = instance?.getSelection()
    const statement = (selection && instance?.getModel()?.getValueInRange(selection).trim()) || sql.trim()
    if (!statement) return
    void run(async () => {
      setSource('Kết quả SQL')
      setResponse(null)
      setResponse(await window.workspaceApi.queryPostgres(connection.id, statement))
    })
  }

  if (!visible) return null

  const groups = new Map<string, PostgresRelation[]>()
  const filter = search.trim().toLowerCase()
  for (const relation of catalog) {
    if (!`${relation.schema}.${relation.name}`.toLowerCase().includes(filter)) continue
    const group = groups.get(relation.schema)
    if (group) group.push(relation)
    else groups.set(relation.schema, [relation])
  }

  return (
    <section aria-label="Database" className="flex min-h-0 min-w-0 flex-1 flex-col" data-database-workspace>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--header)] px-4 py-2.5">
        {connection
          ? <img src={postgresLogo} alt="PostgreSQL" className="size-4 object-contain" />
          : <Database className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />}
        <h1 className="text-sm font-semibold">Database</h1>
        {connection && <>
          <span className="max-w-full truncate text-xs text-[var(--ok)]" title={`${connection.user}@${connection.host}:${connection.port}`}>
            {connection.database} · {connection.host}:{connection.port}
          </span>
          <button type="button" disabled={busy} className={`${buttonClass} ml-auto`} onClick={() => void run(async () => {
            await window.workspaceApi.disconnectPostgres(connection.id)
            activeCredentials.current = null
            setConnection(null)
            setDatabases([])
            setSelected(null)
            setCatalog([])
            setSearch('')
            setResponse(null)
            setSource('Kết quả')
          })}><Unplug className="h-3.5 w-3.5" aria-hidden="true" />Ngắt kết nối</button>
        </>}
      </header>
      {error && <p role="alert" className="shrink-0 break-words border-b border-[var(--border)] bg-[var(--err-bg)] px-4 py-2 text-xs text-[var(--err)]">{error}</p>}
      {notice && <p role="status" className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--ok)]">{notice}</p>}
      {!connection ? (
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Nguồn dữ liệu" className="w-52 shrink-0 overflow-auto border-r border-[var(--border)] bg-[var(--surface)] p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold">Nguồn dữ liệu</h2>
              <button type="button" title="Thêm nguồn dữ liệu" aria-label="Thêm nguồn dữ liệu" className="btn-ghost rounded p-1.5" disabled={busy}
                onClick={() => { setShowSetup(false); setProfile(null); setError(''); setNotice('') }}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {profiles.map((saved) => (
              <div key={saved.id} className="flex items-center gap-0.5">
                <button type="button" disabled={busy} aria-pressed={saved.id === profile?.id && showSetup}
                  className="btn-ghost flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs aria-pressed:bg-[var(--sel)]"
                  title={`${saved.user}@${saved.host}:${saved.port}/${saved.database}`}
                  onClick={() => { setProfile(saved); setShowSetup(true); setError(''); setNotice('') }}>
                  <img src={postgresLogo} alt="PostgreSQL" className="size-4 shrink-0 object-contain" />
                  <span className="truncate">{saved.database} · {saved.host}</span>
                </button>
                <button type="button" disabled={busy} className="btn-ghost rounded p-1.5" title="Xóa kết nối đã lưu" aria-label={`Xóa kết nối ${saved.database}`}
                  onClick={() => void run(async () => {
                    storeProfiles(profiles.filter(({ id }) => id !== saved.id))
                    if (profile?.id === saved.id) setProfile(null)
                  })}><Trash2 className="h-3.5 w-3.5 text-[var(--muted)]" aria-hidden="true" /></button>
              </div>
            ))}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col items-start overflow-auto px-5 py-6">
            {showSetup ? (
              <>
                <button type="button" disabled={busy} className="btn-ghost mb-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                  onClick={() => { setShowSetup(false); setProfile(null); setError(''); setNotice('') }}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Chọn loại database
                </button>
                <ConnectionForm key={profile?.id ?? 'new'} busy={busy} profile={profile} onSubmit={submitConnection} />
              </>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-semibold">Chọn loại database</h2>
                <button type="button" className="btn-ghost inline-flex min-w-44 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
                  onClick={() => { setProfile(null); setShowSetup(true) }}>
                  <img src={postgresLogo} alt="" className="size-6 object-contain" />PostgreSQL
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Schema và bảng" className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] max-lg:w-48">
            <div className="flex items-center justify-between px-3 pt-2">
              <h2 className="text-xs font-semibold">Schema và bảng</h2>
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
                    void run(async () => {
                      const input = { ...credentials.input, database }
                      const active = await window.workspaceApi.connectPostgres(input, credentials.credential, connection.id)
                      activeCredentials.current = { ...credentials, input }
                      setConnection(active)
                      setSelected(null)
                      setCatalog([])
                      setResponse(null)
                      setSource('Kết quả')
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
                      <button key={relation.name} type="button" title={`${relation.name} · ${relation.kind}`} aria-pressed={active} disabled={busy}
                        onClick={() => inspect(relation, 'data')} className="btn-ghost flex w-full items-center gap-2 rounded py-1.5 pl-5 pr-1 text-left text-xs aria-pressed:bg-[var(--sel)] disabled:opacity-70">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                        <span className="truncate">{relation.name}</span>
                      </button>
                    )
                  })}
                </details>
              ))}
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <section aria-label="Trình soạn SQL" className="flex h-1/3 min-h-28 shrink-0 flex-col border-b border-[var(--border)]"
              onKeyDownCapture={(event) => {
                if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return
                event.preventDefault()
                event.stopPropagation()
                runSql()
              }}>
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
                <h2 className="text-xs font-semibold">SQL</h2>
                <button type="button" title="Chạy vùng chọn hoặc toàn bộ SQL (Ctrl+Enter)" className={primaryClass} disabled={busy || !sql.trim()} onClick={runSql}>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />Chạy SQL
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <Editor height="100%" language="sql" theme={theme === 'light' ? 'light' : 'vs-dark'} value={sql}
                  onMount={(instance) => { sqlEditor.current = instance }}
                  onChange={(value) => setSql(value ?? '')}
                  options={{ ariaLabel: 'Câu lệnh SQL', minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on' }} />
              </div>
            </section>
            <section aria-label="Kết quả PostgreSQL" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5">
                <h2 className="mr-auto truncate text-xs font-semibold">{source}</h2>
                {selected && <>
                  <button type="button" disabled={busy} className={buttonClass} onClick={() => inspect(selected, 'data')}>Dữ liệu</button>
                  <button type="button" disabled={busy} className={buttonClass} onClick={() => inspect(selected, 'columns')}>Cấu trúc cột</button>
                </>}
              </div>
              {busy && !response && <p role="status" className="p-3 text-xs text-[var(--muted)]">Đang xử lý…</p>}
              {!busy && !response && !error && <p className="p-3 text-xs text-[var(--muted)]">Chọn bảng để xem dữ liệu hoặc chạy câu lệnh SQL.</p>}
              {response && <ResultGrid key={source} response={response} />}
            </section>
          </div>
        </div>
      )}
    </section>
  )
}
