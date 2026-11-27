import Editor from '@monaco-editor/react'
import { ArrowLeft, Download, Eye, EyeOff, Play, Plug, RefreshCw, Table2, Unplug, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { editor } from 'monaco-editor'
import { THEMES } from '@shared/constants/themes'
import { externalDatabaseLabels, externalDatabaseStarterSql, externalPreviewSql } from '@shared/types/external-database'
import type {
  ExternalDatabaseConnection,
  ExternalDatabaseEngine,
  ExternalDatabaseEnvironment,
  ExternalDatabaseInput,
  ExternalDatabaseProfile,
  ExternalDatabaseResource,
  ExternalQueryResult,
  MongoAuthMethod,
  OracleAuthMethod,
  OraclePrivilege,
  SqlServerAuthMethod
} from '@shared/types/external-database'
import { ensureMonacoSetup } from '../../lib/monaco-setup'
import { formatIpcError } from '../../lib/os-actions'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { externalDatabaseLogos } from './DatabaseEnginePicker'

const field = 'mt-1 w-full min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]'
const button = 'btn-ghost inline-flex items-center justify-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs disabled:opacity-50'
const primary = 'inline-flex items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50'

function ExternalEnvironmentCheck({ engine, host, run }: {
  engine: ExternalDatabaseEngine
  host: string
  run: (action: () => Promise<void>) => Promise<void>
}): React.JSX.Element {
  const name = externalDatabaseLabels[engine]
  const [result, setResult] = useState<ExternalDatabaseEnvironment | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (typeof window.workspaceApi.checkExternalDatabaseEnvironment !== 'function') {
            throw new Error('Hãy khởi động lại Multi-Agent Studio để kiểm tra môi trường database.')
          }
          const checked = await window.workspaceApi.checkExternalDatabaseEnvironment({ engine, host })
          if (!cancelled) setResult(checked)
        } catch (cause) {
          const message = formatIpcError(cause)
          if (!cancelled) setError(/no handler registered for ['"]database:check-environment/i.test(message)
            ? 'Hãy khởi động lại Multi-Agent Studio để kiểm tra môi trường database.'
            : message)
        }
      })()
    }, revision === 0 ? 350 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [engine, host, revision])

  function refresh(): void {
    setResult(null)
    setError('')
    setRevision((value) => value + 1)
  }

  function install(): void {
    void run(async () => {
      setInstalling(true)
      try {
        await window.workspaceApi.installExternalDatabaseEnvironment({ engine, host })
      } finally {
        setInstalling(false)
        refresh()
      }
    })
  }

  const warning = Boolean(error || (result && !['installed', 'remote'].includes(result.status)))
  const color = warning ? 'text-[var(--warn)]' : result?.status === 'installed' ? 'text-[var(--ok)]' : 'text-[var(--muted)]'
  return (
    <div className="space-y-1.5 rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Môi trường {name}</h3>
        <div className="flex flex-wrap gap-1.5">
          {(error || (result && result.status !== 'remote')) && (
            <button type="button" className={button} onClick={refresh}>
              <RefreshCw className="size-3" aria-hidden="true" />Kiểm tra lại
            </button>
          )}
          {result?.status === 'missing' && result.downloadUrl && (
            <button type="button" className={button} onClick={() => void window.workspaceApi.openExternalUrl(result.downloadUrl!)}>
              Tự cài
            </button>
          )}
          {result?.canInstall && (
            <button type="button" className={button} onClick={install}>
              <Download className="size-3" aria-hidden="true" />Cài {name} qua WinGet
            </button>
          )}
        </div>
      </div>
      <p role={warning ? 'alert' : 'status'} className={`break-words ${color}`}>
        {installing ? `Đang chạy trình cài đặt ${name}…` : error || result?.message || 'Đang kiểm tra môi trường…'}
      </p>
      {result?.canInstall && (
        <p className="text-[var(--muted)]">Bạn có thể bấm “Tự cài” để tải bản cài chính thức hoặc cài tự động qua WinGet ({result.wingetId}).</p>
      )}
    </div>
  )
}

function SecretField({ label, name, required, defaultValue, value, onChange, placeholder, autoComplete = 'off' }: {
  label: string
  name: string
  required?: boolean
  defaultValue?: string
  value?: string
  onChange?: (next: string) => void
  placeholder?: string
  autoComplete?: string
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block text-xs">{label}
      <div className="relative">
        <input
          name={name}
          type={visible ? 'text' : 'password'}
          required={required}
          defaultValue={value === undefined ? defaultValue : undefined}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`${field} pr-9`}
        />
        <button
          type="button"
          className="btn-ghost absolute inset-y-1 right-1 mt-1 grid w-7 place-items-center rounded text-[var(--muted)]"
          title={visible ? 'Ẩn' : 'Hiện'}
          aria-label={visible ? `Ẩn ${label}` : `Hiện ${label}`}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </label>
  )
}

function ConnectionFields({ engine, profile, run }: {
  engine: ExternalDatabaseEngine
  profile: ExternalDatabaseProfile | null
  run: (action: () => Promise<void>) => Promise<void>
}): React.JSX.Element {
  const [instance, setInstance] = useState(profile?.instance ?? '')
  const [sqlAuth, setSqlAuth] = useState<SqlServerAuthMethod>(
    engine === 'sqlserver' && profile ? (profile.authMethod as SqlServerAuthMethod) : 'windows'
  )
  const [sqlHost, setSqlHost] = useState(profile?.host || '127.0.0.1')
  const [oracleMode, setOracleMode] = useState<'basic' | 'connectString'>('connectString')
  const [oracleAuth, setOracleAuth] = useState<OracleAuthMethod>(
    engine === 'oracle' && profile ? (profile.authMethod as OracleAuthMethod) : 'password'
  )
  const [oracleConnectString, setOracleConnectString] = useState(profile?.connectString ?? 'localhost:1521/FREEPDB1')
  const [oracleHost, setOracleHost] = useState(profile?.host || 'localhost')
  const [mongoAuth, setMongoAuth] = useState<MongoAuthMethod>(
    engine === 'mongodb' && profile ? (profile.authMethod as MongoAuthMethod) : 'uri'
  )
  const [mongoSrv, setMongoSrv] = useState(Boolean(profile?.srv))
  const [mongoUri, setMongoUri] = useState(profile?.uri || 'mongodb://127.0.0.1:27017')
  const [mongoHost, setMongoHost] = useState(profile?.host || '127.0.0.1')

  if (engine === 'mongodb') return (
    <>
      <label className="block">Phương thức đăng nhập
        <select name="authMethod" value={mongoAuth} onChange={(e) => setMongoAuth(e.target.value as MongoAuthMethod)} className={field}>
          <option value="uri">URI MongoDB (mongodb:// / mongodb+srv://)</option>
          <option value="scram">Username / Password (SCRAM)</option>
          <option value="none">Không xác thực (No Auth)</option>
          <option value="plain">LDAP (PLAIN)</option>
          <option value="x509">Chứng chỉ X.509 (TLS)</option>
          <option value="aws">AWS IAM (MONGODB-AWS)</option>
        </select>
      </label>
      {mongoAuth === 'uri' ? (
        <>
          <SecretField label="URI MongoDB" name="uri" required value={mongoUri} onChange={setMongoUri} />
          <label className="block text-xs">Database
            <input name="database" defaultValue={profile?.database ?? ''} placeholder="Theo URI hoặc test" className={field} />
          </label>
          <p className="text-xs text-[var(--muted)]">Hỗ trợ mongodb:// và mongodb+srv://.</p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] gap-2.5">
            <label className="text-xs">Host<input name="host" required value={mongoHost} onChange={(e) => setMongoHost(e.target.value)} className={field} /></label>
            <label className="text-xs">Port<input name="port" type="number" min="1" max="65535" required={!mongoSrv} disabled={mongoSrv} defaultValue={String(profile?.port ?? 27017)} className={field} /></label>
            <label className="text-xs">Database<input name="database" defaultValue={profile?.database ?? ''} placeholder="test" className={field} /></label>
          </div>
          <label className="flex items-center gap-1.5 text-xs"><input name="srv" type="checkbox" checked={mongoSrv} onChange={(e) => setMongoSrv(e.target.checked)} />Dùng SRV (mongodb+srv://)</label>
          {(mongoAuth === 'scram' || mongoAuth === 'plain') && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">Tài khoản<input name="user" required defaultValue={profile?.user ?? ''} autoComplete="username" className={field} /></label>
                <SecretField label="Mật khẩu" name="password" required={mongoAuth === 'plain'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>Auth Database<input name="authSource" defaultValue={profile?.authSource || (mongoAuth === 'plain' ? '$external' : 'admin')} className={field} /></label>
                {mongoAuth === 'scram' && (
                  <label>Cơ chế SCRAM
                    <select name="authMechanism" defaultValue={profile?.authMechanism ?? 'DEFAULT'} className={field}>
                      <option value="DEFAULT">Mặc định (Auto)</option>
                      <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                      <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
                    </select>
                  </label>
                )}
              </div>
            </>
          )}
          {mongoAuth === 'x509' && (
            <>
              <label className="block">Client Certificate Key File (.pem)
                <input name="tlsCertificateKeyFile" required defaultValue={profile?.tlsCertificateKeyFile ?? ''} placeholder="C:\certs\client.pem" className={field} />
              </label>
              <label className="block">Subject / Username (tùy chọn)
                <input name="user" defaultValue={profile?.user ?? ''} placeholder="Tự lấy từ chứng chỉ nếu để trống" className={field} />
              </label>
            </>
          )}
          {mongoAuth === 'aws' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">AWS Access Key ID<input name="awsAccessKeyId" required className={field} /></label>
                <SecretField label="AWS Secret Access Key" name="awsSecretAccessKey" required />
              </div>
              <SecretField label="AWS Session Token (tùy chọn)" name="awsSessionToken" />
            </>
          )}
          <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg)] p-2.5">
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1"><input name="tls" type="checkbox" defaultChecked={profile?.tls ?? (mongoAuth === 'x509' || mongoSrv)} disabled={mongoAuth === 'x509'} />Bật TLS / SSL</label>
              <label className="flex items-center gap-1"><input name="tlsAllowInvalidCertificates" type="checkbox" defaultChecked={Boolean(profile?.tlsAllowInvalidCertificates)} />Cho phép chứng chỉ tự ký</label>
            </div>
            <label className="block">CA Certificate File (tùy chọn)
              <input name="tlsCAFile" defaultValue={profile?.tlsCAFile ?? ''} placeholder="C:\certs\ca.pem" className={field} />
            </label>
          </div>
        </>
      )}
      <ExternalEnvironmentCheck
        engine="mongodb"
        host={mongoAuth === 'uri' ? mongoUri : (mongoSrv ? `mongodb+srv://${mongoHost}` : mongoHost)}
        run={run}
      />
    </>
  )

  if (engine === 'oracle') return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label>Kiểu kết nối
          <select name="oracleMode" value={oracleMode} onChange={(e) => setOracleMode(e.target.value as 'basic' | 'connectString')} className={field}>
            <option value="connectString">Connect String / TNS</option>
            <option value="basic">Basic (Host / Port / Service)</option>
          </select>
        </label>
        <label>Phương thức đăng nhập
          <select name="authMethod" value={oracleAuth} onChange={(e) => setOracleAuth(e.target.value as OracleAuthMethod)} className={field}>
            <option value="password">Tài khoản &amp; Mật khẩu</option>
            <option value="external">External / OS / Wallet</option>
            <option value="token">OAuth2 / IAM Access Token</option>
          </select>
        </label>
      </div>
      {oracleMode === 'connectString' ? (
        <label className="block">Chuỗi kết nối Oracle
          <input name="connectString" required value={oracleConnectString} onChange={(e) => setOracleConnectString(e.target.value)} className={field} placeholder="localhost:1521/FREEPDB1" />
        </label>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <label>Host<input name="oracleHost" required value={oracleHost} onChange={(e) => setOracleHost(e.target.value)} className={field} /></label>
            <label>Port<input name="oraclePort" type="number" min="1" max="65535" required defaultValue="1521" className={field} /></label>
          </div>
          <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
            <label>Loại định danh
              <select name="oracleTargetType" defaultValue="service" className={field}>
                <option value="service">Service Name</option>
                <option value="sid">SID</option>
              </select>
            </label>
            <label>Service Name / SID<input name="oracleTarget" required defaultValue="FREEPDB1" className={field} /></label>
          </div>
        </>
      )}
      {oracleAuth === 'password' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">Tài khoản<input name="user" required defaultValue={profile?.user ?? ''} autoComplete="username" className={field} /></label>
          <SecretField label="Mật khẩu" name="password" />
        </div>
      )}
      {oracleAuth === 'token' && (
        <>
          <SecretField label="Access Token (Azure AD / OCI IAM)" name="accessToken" required />
          <SecretField label="Private Key PEM (tùy chọn, cho OCI IAM)" name="privateKey" />
        </>
      )}
      <div className="grid grid-cols-3 gap-2.5">
        <label className="text-xs">Vai trò (Role)
          <select name="privilege" defaultValue={profile?.privilege ?? 'normal'} className={field}>
            <option value="normal">Normal</option>
            <option value="SYSDBA">SYSDBA</option>
            <option value="SYSOPER">SYSOPER</option>
            <option value="SYSBACKUP">SYSBACKUP</option>
            <option value="SYSDG">SYSDG</option>
            <option value="SYSKM">SYSKM</option>
            <option value="SYSRAC">SYSRAC</option>
            <option value="SYSASM">SYSASM</option>
          </select>
        </label>
        <label className="text-xs">Thư mục Wallet (mTLS)
          <input name="walletLocation" defaultValue={profile?.walletLocation ?? ''} placeholder="Tùy chọn" className={field} />
        </label>
        <SecretField label="Mật khẩu Wallet" name="walletPassword" placeholder="Nếu có" />
      </div>
      <ExternalEnvironmentCheck
        engine="oracle"
        host={oracleMode === 'basic' ? oracleHost : (oracleConnectString || 'localhost')}
        run={run}
      />
    </>
  )

  return (
    <>
      <label className="block text-xs">Phương thức đăng nhập
        <select name="authMethod" value={sqlAuth} onChange={(e) => setSqlAuth(e.target.value as SqlServerAuthMethod)} className={field}>
          <option value="windows">Windows Authentication (Local · không mật khẩu)</option>
          <option value="sql">SQL Server Authentication (Tài khoản &amp; Mật khẩu)</option>
          <option value="ntlm">Windows Authentication (NTLM · nhập Domain/User)</option>
          <option value="azure-password">Microsoft Entra Password</option>
          <option value="azure-default">Microsoft Entra Default</option>
          <option value="azure-msi-vm">Microsoft Entra Managed Identity (VM)</option>
          <option value="azure-msi-app">Microsoft Entra Managed Identity (App Service)</option>
          <option value="azure-service-principal">Microsoft Entra Service Principal</option>
          <option value="azure-token">Microsoft Entra Access Token / MFA</option>
        </select>
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] gap-2.5">
        <label className="text-xs">Host<input name="host" required value={sqlHost} onChange={(e) => setSqlHost(e.target.value)} placeholder="127.0.0.1 hoặc DESKTOP\\SQLSERVER" className={field} /></label>
        <label className="text-xs">Port<input name="port" type="number" min="1" max="65535" required={!instance.trim()} disabled={Boolean(instance.trim())} defaultValue={String(profile?.port ?? 1433)} className={field} /></label>
        <label className="text-xs">Tên instance
          <input name="instance" value={instance} onChange={(event) => setInstance(event.target.value)} placeholder="SQLEXPRESS" className={field} />
        </label>
      </div>
      <label className="block text-xs">Database
        <input name="database" defaultValue={profile?.database ?? ''} placeholder="Database mặc định của tài khoản" className={field} />
      </label>
      {sqlAuth === 'windows' && (
        <p className="rounded border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs text-[var(--muted)]">
          Đăng nhập bằng tài khoản Windows hiện tại (Integrated Security), không cần nhập mật khẩu.
        </p>
      )}
      {(sqlAuth === 'sql' || sqlAuth === 'ntlm' || sqlAuth === 'azure-password') && (
        <div className={`grid gap-2.5 ${sqlAuth === 'ntlm' ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {sqlAuth === 'ntlm' && <label className="text-xs">Domain<input name="domain" defaultValue={profile?.domain ?? ''} placeholder="CORP" className={field} /></label>}
          <label className="text-xs">{sqlAuth === 'sql' ? 'SQL Login' : 'Tài khoản'}<input name="user" required defaultValue={profile?.user ?? ''} autoComplete="username" className={field} /></label>
          <SecretField label="Mật khẩu" name="password" />
        </div>
      )}
      {(sqlAuth === 'azure-password' || sqlAuth === 'azure-default' || sqlAuth === 'azure-msi-vm' || sqlAuth === 'azure-msi-app') && (
        <div className={`grid gap-2.5 ${sqlAuth === 'azure-password' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <label className="text-xs">Client ID (tùy chọn)<input name="clientId" defaultValue={profile?.clientId ?? ''} className={field} /></label>
          {sqlAuth === 'azure-password' && <label className="text-xs">Tenant ID (tùy chọn)<input name="tenantId" defaultValue={profile?.tenantId ?? ''} className={field} /></label>}
        </div>
      )}
      {sqlAuth === 'azure-token' && (
        <SecretField label="Access Token" name="token" required placeholder="eyJ0eXAiOiJKV1Qi..." />
      )}
      {sqlAuth === 'azure-service-principal' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Tenant ID<input name="tenantId" required defaultValue={profile?.tenantId ?? ''} className={field} /></label>
            <label className="text-xs">Client ID<input name="clientId" required defaultValue={profile?.clientId ?? ''} className={field} /></label>
          </div>
          <SecretField label="Client Secret" name="clientSecret" required />
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1"><input name="encrypt" type="checkbox" defaultChecked={profile?.encrypt ?? true} />Mã hóa TLS</label>
        <label className="flex items-center gap-1"><input name="trust" type="checkbox" defaultChecked={profile?.trustCertificate ?? false} />Tin cậy chứng chỉ máy chủ</label>
      </div>
      <ExternalEnvironmentCheck engine="sqlserver" host={sqlHost} run={run} />
    </>
  )
}

export function ExternalDatabaseWorkspace({ engine, visible, embedded = false, profile = null, onBack, onConnectedChange, onSaveProfile }: {
  engine: ExternalDatabaseEngine
  visible: boolean
  embedded?: boolean
  profile?: ExternalDatabaseProfile | null
  onBack: () => void
  onConnectedChange?: (connected: boolean) => void
  onSaveProfile?: (profile: ExternalDatabaseProfile) => void
}): React.JSX.Element | null {
  const name = externalDatabaseLabels[engine]
  const mongo = engine === 'mongodb'
  const [save, setSave] = useState(Boolean(profile))
  const [connection, setConnection] = useState<ExternalDatabaseConnection | null>(null)
  const [resources, setResources] = useState<ExternalDatabaseResource[]>([])
  const [selected, setSelected] = useState<ExternalDatabaseResource>()
  const [search, setSearch] = useState('')
  const [sql, setSql] = useState(externalDatabaseStarterSql[engine])
  const [results, setResults] = useState<ExternalQueryResult[]>([])
  const [resultIndex, setResultIndex] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const valueDialog = useRef<HTMLDialogElement>(null)
  const [cell, setCell] = useState('')
  const light = THEMES[useSettingsStore((state) => state.settings.theme)]?.isDark === false

  useEffect(() => {
    if (visible) ensureMonacoSetup()
    else editorRef.current = null
  }, [visible])

  async function run(operation: () => Promise<void>): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try { await operation() } catch (cause) {
      const message = formatIpcError(cause)
      setError(/no handler registered for ['"]database:/i.test(message)
        ? 'Hãy khởi động lại Multi-Agent Studio để dùng kết nối database mới.'
        : message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function showResults(next: ExternalQueryResult[]): void {
    setResultIndex(0)
    setResults(next)
  }

  async function refreshResources(id: string): Promise<void> {
    const next = await window.workspaceApi.listExternalDatabaseResources(id)
    setResources(next)
    setSelected((current) => current && next.find((resource) => resource.schema === current.schema && resource.name === current.name))
  }

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const read = (key: string): string => String(form.get(key) ?? '')
    let input: ExternalDatabaseInput
    if (engine === 'mongodb') {
      const authMethod = (read('authMethod') || 'uri') as MongoAuthMethod
      input = authMethod === 'uri'
        ? { engine, authMethod, uri: read('uri'), database: read('database') }
        : {
            engine, authMethod, uri: '', database: read('database'),
            host: read('host'), port: Number(read('port') || '27017'), srv: form.has('srv'),
            user: read('user'), password: read('password'), authSource: read('authSource'),
            authMechanism: (read('authMechanism') || 'DEFAULT') as 'DEFAULT' | 'SCRAM-SHA-256' | 'SCRAM-SHA-1',
            tls: form.has('tls'), tlsAllowInvalidCertificates: form.has('tlsAllowInvalidCertificates'),
            tlsCertificateKeyFile: read('tlsCertificateKeyFile'), tlsCAFile: read('tlsCAFile'),
            awsAccessKeyId: read('awsAccessKeyId'), awsSecretAccessKey: read('awsSecretAccessKey'),
            awsSessionToken: read('awsSessionToken')
          }
    } else if (engine === 'oracle') {
      const oracleMode = read('oracleMode') || 'connectString'
      const target = read('oracleTarget').trim()
      const connectString = oracleMode === 'basic'
        ? (read('oracleTargetType') === 'sid'
            ? `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${read('oracleHost').trim()})(PORT=${Number(read('oraclePort') || '1521')}))(CONNECT_DATA=(SID=${target})))`
            : `${read('oracleHost').trim()}:${Number(read('oraclePort') || '1521')}/${target}`)
        : read('connectString')
      input = {
        engine, authMethod: (read('authMethod') || 'password') as OracleAuthMethod,
        connectString, user: read('user'), password: read('password'),
        privilege: (read('privilege') || 'normal') as OraclePrivilege,
        walletLocation: read('walletLocation'), walletPassword: read('walletPassword'),
        accessToken: read('accessToken'), privateKey: read('privateKey')
      }
    } else {
      input = {
        engine, authMethod: (read('authMethod') || 'sql') as SqlServerAuthMethod,
        host: read('host'), port: Number(read('port') || '1433'), instance: read('instance'),
        database: read('database'), user: read('user'), password: read('password'),
        domain: read('domain'), token: read('token'),
        clientId: read('clientId'), clientSecret: read('clientSecret'), tenantId: read('tenantId'),
        encrypt: form.has('encrypt'), trustCertificate: form.has('trust')
      }
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    void run(async () => {
      if (typeof window.workspaceApi.connectExternalDatabase !== 'function') throw new Error('Hãy khởi động lại Multi-Agent Studio để dùng kết nối database mới.')
      if (submitter?.hasAttribute('data-test-connection')) {
        await window.workspaceApi.testExternalDatabase(input)
        setNotice(`Kết nối ${name} thành công.`)
        return
      }
      const next = await window.workspaceApi.connectExternalDatabase(input)
      if (save && onSaveProfile) {
        const hostValue = input.engine === 'mongodb'
          ? (input.host || (input.uri ? input.uri.replace(/^mongodb(?:\+srv)?:\/\/([^/@]+@)?([^/?:]+).*$/i, '$2') : '127.0.0.1'))
          : input.engine === 'oracle'
            ? input.connectString
            : input.host
        const safeUri = input.engine === 'mongodb' && input.uri
          ? input.uri.replace(/^(mongodb(?:\+srv)?:\/\/)[^/@]+@/i, '$1')
          : undefined
        onSaveProfile({
          id: profile?.id ?? crypto.randomUUID(),
          label: next.database || (input.engine === 'oracle' ? input.connectString : hostValue),
          engine,
          authMethod: (input.authMethod ?? (engine === 'mongodb' ? 'uri' : engine === 'oracle' ? 'password' : 'sql')),
          host: hostValue,
          port: input.engine === 'sqlserver' ? input.port : input.engine === 'mongodb' ? (input.port ?? 27017) : 1521,
          instance: input.engine === 'sqlserver' ? input.instance : undefined,
          database: next.database || (input.engine === 'oracle' ? '' : input.database),
          user: input.engine === 'mongodb' ? input.user : input.user,
          domain: input.engine === 'sqlserver' ? input.domain : undefined,
          clientId: input.engine === 'sqlserver' ? input.clientId : undefined,
          tenantId: input.engine === 'sqlserver' ? input.tenantId : undefined,
          encrypt: input.engine === 'sqlserver' ? input.encrypt : undefined,
          trustCertificate: input.engine === 'sqlserver' ? input.trustCertificate : undefined,
          connectString: input.engine === 'oracle' ? input.connectString : undefined,
          privilege: input.engine === 'oracle' ? input.privilege : undefined,
          walletLocation: input.engine === 'oracle' ? input.walletLocation : undefined,
          uri: safeUri,
          srv: input.engine === 'mongodb' ? input.srv : undefined,
          authSource: input.engine === 'mongodb' ? input.authSource : undefined,
          authMechanism: input.engine === 'mongodb' ? input.authMechanism : undefined,
          tls: input.engine === 'mongodb' ? input.tls : undefined,
          tlsAllowInvalidCertificates: input.engine === 'mongodb' ? input.tlsAllowInvalidCertificates : undefined,
          tlsCertificateKeyFile: input.engine === 'mongodb' ? input.tlsCertificateKeyFile : undefined,
          tlsCAFile: input.engine === 'mongodb' ? input.tlsCAFile : undefined
        })
      }
      const starter = externalDatabaseStarterSql[engine]
      setConnection(next)
      onConnectedChange?.(true)
      setSql(starter)
      showResults([])
      await refreshResources(next.id)
      if (!mongo) showResults(await window.workspaceApi.queryExternalDatabase(next.id, starter))
    })
  }

  function preview(resource: ExternalDatabaseResource): void {
    if (!connection) return
    void run(async () => {
      setSelected(resource)
      setSql(externalPreviewSql(engine, resource))
      showResults([])
      showResults(await window.workspaceApi.previewExternalDatabaseResource(connection.id, resource))
    })
  }

  function execute(): void {
    if (!connection || (mongo && !selected)) return
    const instance = editorRef.current
    const selection = instance?.getSelection()
    const statement = (selection && instance?.getModel()?.getValueInRange(selection).trim()) || sql.trim()
    if (!statement) return
    void run(async () => {
      showResults([])
      showResults(await window.workspaceApi.queryExternalDatabase(connection.id, statement, selected))
      if (!mongo && /^(CREATE|ALTER|DROP|RENAME)\b/i.test(statement)) await refreshResources(connection.id)
    })
  }

  if (!visible) return null
  const result = results[resultIndex]
  const filtered = resources.filter((resource) => `${resource.schema}.${resource.name}`.toLowerCase().includes(search.trim().toLowerCase()))

  const loginForm = (
    <div className="mx-auto w-full max-w-xl px-4 py-4">
      <button type="button" disabled={busy} className="btn-ghost mb-2.5 inline-flex items-center gap-1 rounded px-2 py-1 text-xs" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Chọn loại database
      </button>
      <form onSubmit={connect} autoComplete="off" className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3.5 flex items-center gap-2.5">
          <div className="rounded-lg bg-[var(--accent-soft)] p-2"><img src={externalDatabaseLogos[engine]} alt="" className="size-5 object-contain" /></div>
          <h2 className="text-base font-semibold">Kết nối {name}</h2>
        </div>
        <fieldset disabled={busy} className="space-y-2.5 text-xs">
          <ConnectionFields key={profile?.id ?? engine} engine={engine} profile={profile} run={run} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />
            Lưu kết nối
          </label>
          <div className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] pt-3">
            <button type="submit" className={`${primary} order-2`}><Plug className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Đang xử lý…' : 'Kết nối'}</button>
            <button type="submit" data-test-connection="true" className={`${button} order-1`}>Kiểm tra kết nối</button>
          </div>
        </fieldset>
      </form>
    </div>
  )

  const notices = (error || notice) && (
    <div className={`flex shrink-0 items-start gap-2 border-b border-[var(--border)] px-4 py-2 text-xs ${error ? 'bg-[var(--err-bg)] text-[var(--err)]' : 'text-[var(--ok)]'}`}>
      <span role={error ? 'alert' : 'status'} className="min-w-0 flex-1 break-words">{error || notice}</span>
      <button type="button" className="btn-ghost rounded p-0.5" aria-label="Đóng thông báo" onClick={() => { setError(''); setNotice('') }}><X className="size-3.5" /></button>
    </div>
  )

  if (embedded && !connection) {
    return (
      <>
        {notices}
        {loginForm}
      </>
    )
  }

  return (
    <section aria-label={`Database ${name}`} data-database-workspace style={{ colorScheme: light ? 'light' : 'dark' }}
      className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--header)] px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded border border-black/10 bg-[#f7f9fc]">
          <img src={externalDatabaseLogos[engine]} alt="" className="size-4 object-contain" />
        </span>
        <h1 className="text-sm font-semibold">{name}</h1>
        {connection && <>
          <span className="min-w-0 truncate text-xs text-[var(--ok)]">{connection.database}</span>
          <button type="button" className={`${button} ml-auto`} disabled={busy} onClick={() => void run(async () => {
            await window.workspaceApi.disconnectExternalDatabase(connection.id)
            setConnection(null)
            onConnectedChange?.(false)
            setSelected(undefined)
            setResources([])
            setSearch('')
            showResults([])
          })}><Unplug className="size-3.5" />Ngắt kết nối</button>
        </>}
      </header>
      {notices}
      {!connection ? (
        <div className="min-h-0 flex-1 overflow-auto">{loginForm}</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside aria-label={mongo ? 'Collection và view' : 'Schema và bảng'} className="flex w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] max-lg:w-44">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <h2 className="text-xs font-semibold">{mongo ? 'Collection và view' : 'Schema và bảng'}</h2>
              <button type="button" className={button} disabled={busy} aria-label="Làm mới danh sách"
                onClick={() => void run(() => refreshResources(connection.id))}><RefreshCw className="size-3.5" /></button>
            </div>
            <div className="px-2 pb-2"><input className={field} aria-label="Tìm đối tượng" placeholder={mongo ? 'Tìm collection…' : 'Tìm bảng…'}
              value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="min-h-0 flex-1 overflow-auto px-2">
              {!filtered.length && <p className="px-1 py-2 text-xs text-[var(--muted)]">{busy ? 'Đang tải…' : 'Không tìm thấy đối tượng.'}</p>}
              {filtered.map((resource) => (
                <button type="button" key={JSON.stringify([resource.schema, resource.name])} className="btn-ghost flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs aria-pressed:bg-[var(--sel)]"
                  title={`${resource.schema}.${resource.name} · ${resource.kind}`} disabled={busy}
                  aria-pressed={selected?.schema === resource.schema && selected.name === resource.name} onClick={() => preview(resource)}>
                  <Table2 className="size-3.5 shrink-0 text-[var(--muted)]" />
                  <span className="truncate">{mongo ? resource.name : `${resource.schema}.${resource.name}`}</span>
                </button>
              ))}
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <section aria-label={mongo ? 'Truy vấn MongoDB' : 'Trình soạn SQL'} className="flex h-1/3 min-h-36 shrink-0 flex-col border-b border-[var(--border)]"
              onKeyDownCapture={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); execute() }
              }}>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-1.5">
                <h2 className="text-xs font-semibold">{mongo ? 'Extended JSON' : 'SQL'}</h2>
                {mongo && <span className="text-xs text-[var(--muted)]">Nhập bộ lọc JSON hoặc mảng aggregation pipeline.</span>}
                <button type="button" className={primary} disabled={busy || !sql.trim() || (mongo && !selected)} onClick={execute} title="Chạy truy vấn (Ctrl+Enter)">
                  <Play className="size-3.5" />Chạy truy vấn
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <Editor height="100%" language={mongo ? 'json' : 'sql'} theme={light ? 'light' : 'vs-dark'} value={sql}
                  onMount={(instance) => { editorRef.current = instance }} onChange={(value) => setSql(value ?? '')}
                  options={{ ariaLabel: 'Câu truy vấn', minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, readOnly: busy }} />
              </div>
            </section>
            <section aria-label="Kết quả truy vấn" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs">
                <h2 className="font-semibold">{selected ? `${selected.schema}.${selected.name}` : 'Kết quả truy vấn'}</h2>
                {results.length > 1 && <select aria-label="Tập kết quả" value={resultIndex} onChange={(event) => setResultIndex(Number(event.target.value))}>
                  {results.map((_, index) => <option key={index} value={index}>Kết quả {index + 1}</option>)}
                </select>}
                {result && <span>{result.columns.length ? `${result.rows.length} dòng` : result.affected === null ? 'Đã thực thi' : `${result.affected} dòng ảnh hưởng`}</span>}
                {result?.truncated && <span className="text-[var(--warn)]">Kết quả đã rút gọn</span>}
              </div>
              {busy && <p role="status" className="p-3 text-xs text-[var(--muted)]">Đang xử lý…</p>}
              {!busy && !result && !error && <p className="p-3 text-xs text-[var(--muted)]">{mongo ? 'Chọn collection để xem dữ liệu.' : 'Chọn bảng hoặc chạy SQL.'}</p>}
              {result && result.columns.length > 0 && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-max min-w-full whitespace-nowrap text-left text-xs">
                    <thead className="sticky top-0 bg-[var(--surface-elevated)]"><tr>
                      <th scope="col" className="px-3 py-2">#</th>
                      {result.columns.map((column, index) => <th scope="col" key={index} className="border-l border-[var(--border)] px-3 py-2">{column}</th>)}
                    </tr></thead>
                    <tbody>{result.rows.map((row, index) => (
                      <tr key={index} className="border-t border-[var(--border)] hover:bg-[var(--hover)]">
                        <th scope="row" className="px-3 py-1.5 text-right font-normal text-[var(--muted)]">{index + 1}</th>
                        {row.map((value, column) => <td key={column} className="max-w-96 truncate border-l border-[var(--border)] px-3 py-1.5 font-mono"
                          onDoubleClick={() => { setCell(value ?? 'NULL'); valueDialog.current?.showModal() }}>
                          {value ?? <span className="italic text-[var(--muted)]">NULL</span>}
                        </td>)}
                      </tr>
                    ))}</tbody>
                  </table>
                  {!result.rows.length && <p className="p-3 text-xs text-[var(--muted)]">Kết quả trống.</p>}
                </div>
              )}
              <dialog ref={valueDialog} aria-label="Giá trị ô" className="m-auto max-h-[70vh] w-[min(38rem,calc(100%-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] backdrop:bg-black/50">
                <form method="dialog" className="mb-2 flex justify-between"><h3 className="text-sm font-semibold">Giá trị ô</h3><button className={button}>Đóng</button></form>
                <pre className="whitespace-pre-wrap break-all text-xs">{cell}</pre>
              </dialog>
            </section>
          </div>
        </div>
      )}
    </section>
  )
}
