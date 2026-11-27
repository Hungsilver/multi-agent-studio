export type DevAppType = 'backend' | 'bff' | 'frontend' | 'tool'

export interface DevAppConfig {
  id: string
  group: string
  name: string
  type: DevAppType
  port: number
  url: string
  dir: string
  start: string
  manual?: boolean
  iis?: string
  autoRestart?: boolean
}

export interface DevAppRuntime extends DevAppConfig {
  known: boolean
  running: boolean
  busy: boolean
  busyPid: number
  pid: number
  processName: string
  pool?: string
  executablePath?: string
  cpuPct?: number | null
  ramMb?: number | null
  healthMs?: number | null
  healthCode?: number | null
  healthOk?: boolean | null
  tunnelUrl?: string | null
  tunnelPending?: boolean
}

export interface AppsProfile {
  name: string
  ids: string[]
}

export interface AppsCatalogConfig {
  scanRanges: Array<[number, number]>
  scanRoots: string[]
  apps: DevAppConfig[]
  removed: DevAppConfig[]
  profiles: AppsProfile[]
  showStats: boolean
}

export interface IisSiteBinding {
  protocol: 'http' | 'https'
  port: number
  host: string
}

export interface IisSiteInfo {
  name: string
  id: number
  pool: string
  physicalPath: string
  bindings: IisSiteBinding[]
  port: number
  url: string
}

export type AppsBatchAction = 'start' | 'startseq' | 'stop' | 'restart'

export interface AppsBatchResult {
  ok: boolean
  messages: string[]
  errors: string[]
}

export interface AppShareInfo {
  group: string
  appName: string
  lanIp: string
  tailscaleIp: string | null
  lanUrl: string
  tailscaleUrl: string | null
  messageTemplate: string
}

export interface AppsAlertPush {
  kind: 'crash' | 'auto-restart' | 'tunnel' | 'info'
  title: string
  message: string
  appId?: string
  url?: string
}

export interface AppsScanResult {
  scannedCount: number
  totalCount: number
  config: AppsCatalogConfig
}
