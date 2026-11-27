export type ThemeName = 'dark' | 'light' | 'modern' | 'atelier' | 'aurora'

export type AccentName = 'indigo' | 'ocean' | 'teal' | 'violet' | 'graphite'

export interface WorkspaceRecord {
  id: string
  path: string
  name: string
  lastOpenedAt: string
}

export interface AppSettings {
  theme: ThemeName
  accent: AccentName
  defaultProvider: 'claude' | 'codex' | 'agy'
  defaultMode: 'plan' | 'edit' | 'full'
  claudeAuthMode: 'env' | 'account'
  notifications: boolean
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  cliOverrides: Partial<Record<'claude' | 'codex' | 'agy', string>>
}

export interface PtyCreateOptions {
  id?: string
  cwd: string
  title?: string
  initialCommand?: string
  args?: string[]
}

export interface PtySessionInfo {
  id: string
  title: string
  cwd: string
  backend: 'conpty' | 'pipe'
}

export interface AppVersionInfo {
  version: string
  installMode: 'packaged' | 'source'
  repoUrl: string
  releasesUrl: string
}

export interface AppUpdateInfo {
  currentVersion: string
  installMode: 'packaged' | 'source'
  repoUrl: string
  releasesUrl: string
  status: 'up-to-date' | 'update-available' | 'private-or-unreachable' | 'error'
  latestVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  commitsBehind?: number
  message: string
}

export interface FileTreeEntry {
  name: string
  relPath: string
  isDir: boolean
  size: number
}

export interface WorkspaceFileContent {
  relPath: string
  content: string
  size: number
  isBinary: boolean
  tooLarge: boolean
}
