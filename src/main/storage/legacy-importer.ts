import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProviderId } from '@shared/types/ai'
import type { AccentName, LegacyImportResult, ThemeName } from '@shared/types/workspace'
import type { WorkspaceRepository } from './repositories'

interface LegacyConfigJson {
  theme?: string
  colorScheme?: string
  aiTool?: string
  aiClaudeAuth?: string
  aiDirs?: string[]
  scanRoots?: string[]
  aiSessions?: Array<{
    Tool?: string
    Id?: string
    Dir?: string
    Title?: string
    Updated?: string
  }>
}

interface LegacyAppsJson {
  Apps?: Array<{ dir?: string }>
  apps?: Array<{ dir?: string }>
}

const VALID_THEMES = new Set<ThemeName>(['dark', 'light', 'modern', 'atelier', 'aurora'])
const VALID_ACCENTS = new Set<AccentName>(['indigo', 'ocean', 'teal', 'violet', 'graphite'])
const VALID_PROVIDERS = new Set<ProviderId>(['claude', 'codex', 'agy', 'gemini'])

export function getLegacyDataDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return process.env.DEVOPS_PANEL_DATA || path.join(appData, 'PegasusPanel')
}

export function importLegacyPegasusData(
  repo: WorkspaceRepository,
  legacyDir = getLegacyDataDir()
): LegacyImportResult {
  const cfgPath = path.join(legacyDir, 'config.json')
  const appsPath = path.join(legacyDir, 'apps.json')

  if (!fs.existsSync(cfgPath) && !fs.existsSync(appsPath)) {
    return { found: false, importedWorkspaces: 0, importedSessions: 0 }
  }

  let cfg: LegacyConfigJson = {}
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')
      cfg = JSON.parse(raw) as LegacyConfigJson
    } catch {
      cfg = {}
    }
  }

  let appsCfg: LegacyAppsJson = {}
  if (fs.existsSync(appsPath)) {
    try {
      const raw = fs.readFileSync(appsPath, 'utf8').replace(/^\uFEFF/, '')
      appsCfg = JSON.parse(raw) as LegacyAppsJson
    } catch {
      appsCfg = {}
    }
  }

  // Import theme / accent / claudeAuthMode safely
  const theme = VALID_THEMES.has(cfg.theme as ThemeName) ? (cfg.theme as ThemeName) : undefined
  const accent = VALID_ACCENTS.has(cfg.colorScheme as AccentName) ? (cfg.colorScheme as AccentName) : undefined
  const claudeAuthMode = cfg.aiClaudeAuth === 'account' ? 'account' : 'env'

  if (theme || accent || cfg.aiClaudeAuth) {
    repo.updateSettings({
      ...(theme ? { theme } : {}),
      ...(accent ? { accent } : {}),
      claudeAuthMode
    })
  }

  // Collect candidate directories
  const dirSet = new Set<string>()
  for (const d of cfg.aiDirs ?? []) {
    if (d && fs.existsSync(d)) dirSet.add(path.resolve(d))
  }
  for (const s of cfg.aiSessions ?? []) {
    if (s.Dir && fs.existsSync(s.Dir)) dirSet.add(path.resolve(s.Dir))
  }
  for (const a of appsCfg.Apps ?? appsCfg.apps ?? []) {
    if (a.dir && fs.existsSync(a.dir)) dirSet.add(path.resolve(a.dir))
  }

  const existingWorkspaces = new Set(repo.listWorkspaces().map((w) => w.path.toLowerCase()))
  const workspaceByPath = new Map<string, string>()
  for (const w of repo.listWorkspaces()) {
    workspaceByPath.set(w.path.toLowerCase(), w.id)
  }

  let importedWorkspaces = 0
  for (const d of dirSet) {
    const rec = repo.upsertWorkspace(d)
    workspaceByPath.set(rec.path.toLowerCase(), rec.id)
    if (!existingWorkspaces.has(rec.path.toLowerCase())) {
      importedWorkspaces++
    }
  }

  const existingSessions = repo.listSessions()
  const existingProviderSessionKeys = new Set(
    existingSessions
      .filter((s) => s.providerSessionId)
      .map((s) => `${s.provider}|${s.workspacePath.toLowerCase()}|${s.providerSessionId}`)
  )

  let importedSessions = 0
  for (const s of cfg.aiSessions ?? []) {
    const provider = (s.Tool ?? '').toLowerCase() as ProviderId
    if (!VALID_PROVIDERS.has(provider) || !s.Id || !s.Dir || !fs.existsSync(s.Dir)) continue
    const resolvedDir = path.resolve(s.Dir)
    const key = `${provider}|${resolvedDir.toLowerCase()}|${s.Id}`
    if (existingProviderSessionKeys.has(key)) continue

    const wsId = workspaceByPath.get(resolvedDir.toLowerCase()) ?? repo.upsertWorkspace(resolvedDir).id
    repo.createSession({
      workspaceId: wsId,
      workspacePath: resolvedDir,
      provider,
      providerSessionId: s.Id,
      title: s.Title || 'Phiên nhập từ V1'
    })
    existingProviderSessionKeys.add(key)
    importedSessions++
  }

  return {
    found: true,
    importedWorkspaces,
    importedSessions,
    theme,
    accent,
    claudeAuthMode
  }
}
