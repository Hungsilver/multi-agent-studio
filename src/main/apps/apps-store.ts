import fs from 'node:fs'
import path from 'node:path'
import type { AppsCatalogConfig, AppsProfile, DevAppConfig, DevAppType } from '@shared/types/apps'
import { getDefaultDataDir } from '../storage/database'

export const DEFAULT_SCAN_RANGES: Array<[number, number]> = [
  [5000, 5099],
  [7000, 7199]
]

const VALID_TYPES = new Set<DevAppType>(['backend', 'bff', 'frontend', 'tool'])

export function assertValidAppId(id: string): string {
  const trimmed = id.trim()
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    throw new Error(`ID ứng dụng không hợp lệ: "${id}"`)
  }
  return trimmed
}

export function generateAppId(name: string, taken: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) base = 'app'
  let id = base
  let n = 2
  while (taken.has(id)) {
    id = `${base}-${n}`
    n++
  }
  taken.add(id)
  return id
}

export function resolveAppsDataDir(dataDir?: string): string {
  return dataDir || getDefaultDataDir()
}

export function getAppsFilePath(dataDir?: string): string {
  return path.join(resolveAppsDataDir(dataDir), 'apps.json')
}

export function getAppsLogDir(dataDir?: string): string {
  return path.join(resolveAppsDataDir(dataDir), 'app-logs')
}

function normalizeAppEntry(raw: Partial<DevAppConfig>, fallbackId = 'app'): DevAppConfig {
  const rawType = String(raw.type || 'backend').toLowerCase()
  const type: DevAppType = VALID_TYPES.has(rawType as DevAppType) ? (rawType as DevAppType) : 'backend'
  return {
    id: String(raw.id || fallbackId).trim(),
    group: String(raw.group || 'PROJECT').trim() || 'PROJECT',
    name: String(raw.name || raw.id || 'Unnamed App').trim(),
    type,
    port: Number.isFinite(Number(raw.port)) ? Math.min(65535, Math.max(0, Math.round(Number(raw.port)))) : 0,
    url: String(raw.url || '').trim(),
    dir: String(raw.dir || '').trim(),
    start: String(raw.start || '').trim(),
    ...(raw.manual ? { manual: true } : {}),
    ...(raw.iis ? { iis: String(raw.iis).trim() } : {}),
    ...(raw.autoRestart ? { autoRestart: true } : {})
  }
}

function normalizeRanges(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return DEFAULT_SCAN_RANGES.map(([a, b]) => [a, b])
  const out: Array<[number, number]> = []
  for (const r of raw) {
    if (Array.isArray(r) && r.length >= 2) {
      const lo = Number(r[0])
      const hi = Number(r[1])
      if (Number.isInteger(lo) && Number.isInteger(hi) && lo > 0 && hi >= lo && hi <= 65535) {
        out.push([lo, hi])
      }
    }
  }
  return out.length > 0 ? out : DEFAULT_SCAN_RANGES.map(([a, b]) => [a, b])
}

function normalizeProfiles(raw: unknown): AppsProfile[] {
  if (!Array.isArray(raw)) return []
  const out: AppsProfile[] = []
  for (const p of raw) {
    if (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string') {
      const name = String((p as { name: string }).name).trim()
      if (!name) continue
      const ids = Array.isArray((p as { ids?: unknown }).ids)
        ? (p as { ids: unknown[] }).ids.map((x) => String(x).trim()).filter(Boolean)
        : []
      out.push({ name, ids })
    }
  }
  return out
}

function normalizeCatalog(raw: Record<string, unknown>): AppsCatalogConfig {
  const appsRaw = Array.isArray(raw.apps) ? raw.apps : Array.isArray(raw.Apps) ? raw.Apps : []
  const removedRaw = Array.isArray(raw.removed) ? raw.removed : Array.isArray(raw.Removed) ? raw.Removed : []
  const rootsRaw = Array.isArray(raw.scanRoots) ? raw.scanRoots : []
  const scanRoots = Array.from(
    new Set(rootsRaw.map((r) => String(r || '').trim()).filter(Boolean))
  )
  const apps = appsRaw
    .filter((x): x is Partial<DevAppConfig> => Boolean(x && typeof x === 'object'))
    .map((x, idx) => normalizeAppEntry(x, `app-${idx + 1}`))
  const removed = removedRaw
    .filter((x): x is Partial<DevAppConfig> => Boolean(x && typeof x === 'object'))
    .map((x, idx) => normalizeAppEntry(x, `removed-${idx + 1}`))

  return {
    scanRanges: normalizeRanges(raw.scanRanges ?? raw.Ranges),
    scanRoots,
    apps,
    removed,
    profiles: normalizeProfiles(raw.profiles ?? raw.Profiles),
    showStats: Boolean(raw.showStats)
  }
}

export function readAppsConfig(dataDir?: string): AppsCatalogConfig {
  const file = getAppsFilePath(dataDir)
  if (!fs.existsSync(file)) {
    const fresh: AppsCatalogConfig = {
      scanRanges: DEFAULT_SCAN_RANGES.map(([a, b]) => [a, b]),
      scanRoots: [],
      apps: [],
      removed: [],
      profiles: [],
      showStats: false
    }
    writeAppsConfig(fresh, dataDir)
    return fresh
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
    return normalizeCatalog(parsed)
  } catch {
    return {
      scanRanges: DEFAULT_SCAN_RANGES.map(([a, b]) => [a, b]),
      scanRoots: [],
      apps: [],
      removed: [],
      profiles: [],
      showStats: false
    }
  }
}

export function writeAppsConfig(cfg: AppsCatalogConfig, dataDir?: string): AppsCatalogConfig {
  const file = getAppsFilePath(dataDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const normalized: AppsCatalogConfig = {
    scanRanges: normalizeRanges(cfg.scanRanges),
    scanRoots: Array.from(new Set(cfg.scanRoots.map((r) => r.trim()).filter(Boolean))),
    apps: cfg.apps.map((a, idx) => normalizeAppEntry(a, `app-${idx + 1}`)),
    removed: cfg.removed.map((a, idx) => normalizeAppEntry(a, `removed-${idx + 1}`)),
    profiles: normalizeProfiles(cfg.profiles),
    showStats: Boolean(cfg.showStats)
  }
  const payload = JSON.stringify(normalized, null, 2)
  const tmpFile = `${file}.tmp`
  try {
    fs.writeFileSync(tmpFile, payload, 'utf8')
    fs.renameSync(tmpFile, file)
  } catch {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    } catch {
      // ignore temp cleanup error
    }
    fs.writeFileSync(file, payload, 'utf8')
  }
  return normalized
}

export function cleanupOldAppLogs(dataDir?: string): number {
  const logDir = getAppsLogDir(dataDir)
  if (!fs.existsSync(logDir)) return 0
  const today = new Date().toISOString().slice(0, 10)
  const marker = path.join(logDir, `.cleanup-${today}`)
  if (fs.existsSync(marker)) return 0

  const keepLines = 200
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
  let cleaned = 0

  for (const name of fs.readdirSync(logDir)) {
    if (name.startsWith('.cleanup-') && name !== `.cleanup-${today}`) {
      try {
        fs.unlinkSync(path.join(logDir, name))
      } catch {
        // ignore locked files
      }
      continue
    }
    if (!name.toLowerCase().endsWith('.log')) continue
    const full = path.join(logDir, name)
    try {
      const st = fs.statSync(full)
      if (!st.isFile() || st.mtimeMs >= cutoffMs) continue
      const raw = fs.readFileSync(full, 'utf8')
      const lines = raw.split(/\r?\n/)
      if (lines.length <= keepLines) continue
      const kept = lines.slice(lines.length - keepLines)
      const header = `==== ${today}  [Log đã được dọn tự động - giữ ${keepLines} dòng cuối] ====`
      fs.writeFileSync(full, [header, '', ...kept].join('\n'), 'utf8')
      cleaned++
    } catch {
      // ignore file held by running app
    }
  }

  try {
    fs.writeFileSync(marker, today, 'utf8')
  } catch {
    // ignore
  }
  return cleaned
}

export function addManualApp(
  input: Omit<DevAppConfig, 'id'> & { id?: string },
  dataDir?: string
): DevAppConfig {
  const cfg = readAppsConfig(dataDir)
  const taken = new Set<string>([...cfg.apps.map((a) => a.id), ...cfg.removed.map((r) => r.id)])
  const requestedId = input.id?.trim()
  const id = requestedId && !taken.has(requestedId) && /^[a-z0-9-]+$/.test(requestedId)
    ? (taken.add(requestedId), requestedId)
    : generateAppId(input.name, taken)

  const entry = normalizeAppEntry({ ...input, id, manual: true }, id)
  cfg.apps.push(entry)
  writeAppsConfig(cfg, dataDir)
  return entry
}

export function updateAppConfig(
  id: string,
  patch: Partial<Omit<DevAppConfig, 'id'>>,
  dataDir?: string
): DevAppConfig {
  const validId = assertValidAppId(id)
  const cfg = readAppsConfig(dataDir)
  const idx = cfg.apps.findIndex((a) => a.id === validId)
  if (idx < 0) throw new Error(`Không tìm thấy ứng dụng "${validId}"`)

  const updated = normalizeAppEntry({ ...cfg.apps[idx], ...patch, id: validId }, validId)
  cfg.apps[idx] = updated
  writeAppsConfig(cfg, dataDir)
  return updated
}

export function removeAppsFromCatalog(ids: string[], dataDir?: string): { removed: DevAppConfig[]; config: AppsCatalogConfig } {
  const cfg = readAppsConfig(dataDir)
  const idSet = new Set(ids.map((x) => x.trim()).filter(Boolean))
  const out = cfg.apps.filter((a) => idSet.has(a.id))
  if (out.length === 0) {
    throw new Error('Không có app nào trong danh mục để gỡ.')
  }

  const logDir = getAppsLogDir(dataDir)
  for (const a of out) {
    const pidPath = path.join(logDir, `${a.id}.pid`)
    try {
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath)
    } catch {
      // ignore
    }
  }

  const existingRemovedIds = new Set(cfg.removed.map((r) => r.id))
  cfg.apps = cfg.apps.filter((a) => !idSet.has(a.id))
  cfg.removed = [...cfg.removed, ...out.filter((a) => !existingRemovedIds.has(a.id))]
  const saved = writeAppsConfig(cfg, dataDir)
  return { removed: out, config: saved }
}

export function restoreAppsFromRemoved(
  ids: string[],
  dataDir?: string
): { restoredCount: number; conflicts: Array<{ id: string; name: string }>; config: AppsCatalogConfig } {
  const cfg = readAppsConfig(dataDir)
  const idSet = new Set(ids.map((x) => x.trim()).filter(Boolean))
  const taken = new Set(cfg.apps.map((a) => a.id))
  const matching = cfg.removed.filter((a) => idSet.has(a.id))
  const toRestore = matching.filter((a) => !taken.has(a.id))
  const conflicts = matching.filter((a) => taken.has(a.id)).map((a) => ({ id: a.id, name: a.name }))
  const restoredIdSet = new Set(toRestore.map((a) => a.id))

  cfg.apps = [...cfg.apps, ...toRestore]
  cfg.removed = cfg.removed.filter((a) => !restoredIdSet.has(a.id))
  const saved = writeAppsConfig(cfg, dataDir)
  return { restoredCount: toRestore.length, conflicts, config: saved }
}

export function setAppsAutoRestart(ids: string[], on: boolean, dataDir?: string): AppsCatalogConfig {
  const cfg = readAppsConfig(dataDir)
  const idSet = new Set(ids)
  cfg.apps = cfg.apps.map((a) => {
    if (!idSet.has(a.id)) return a
    const next = { ...a }
    if (on) next.autoRestart = true
    else delete next.autoRestart
    return next
  })
  return writeAppsConfig(cfg, dataDir)
}

export function saveAppsProfile(name: string, ids: string[], dataDir?: string): AppsCatalogConfig {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Tên bộ app không được để trống.')
  const cfg = readAppsConfig(dataDir)
  const cleanIds = Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean)))
  cfg.profiles = [...cfg.profiles.filter((p) => p.name !== trimmed), { name: trimmed, ids: cleanIds }]
  return writeAppsConfig(cfg, dataDir)
}

export function removeAppsProfile(name: string, dataDir?: string): AppsCatalogConfig {
  const cfg = readAppsConfig(dataDir)
  cfg.profiles = cfg.profiles.filter((p) => p.name !== name)
  return writeAppsConfig(cfg, dataDir)
}

export function resolveImportedDir(dir: string, oldRoots: string[], newRoots: string[]): string {
  if (!dir || fs.existsSync(dir)) return dir
  const normalizedDir = dir.replace(/\/+$/, '')

  for (const oldRoot of oldRoots) {
    const cleanOld = oldRoot.replace(/[\\/]+$/, '')
    if (normalizedDir.toLowerCase().startsWith(`${cleanOld.toLowerCase()}\\`) || normalizedDir.toLowerCase().startsWith(`${cleanOld.toLowerCase()}/`)) {
      const tail = normalizedDir.slice(cleanOld.length)
      for (const nr of newRoots) {
        const candidate = nr.replace(/[\\/]+$/, '') + tail
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }

  const segs = normalizedDir.replace(/[\\/]+$/, '').split(/[\\/]/)
  const maxSegs = Math.min(6, segs.length - 1)
  for (let k = maxSegs; k >= 2; k--) {
    const tail = segs.slice(segs.length - k).join(path.sep)
    for (const nr of newRoots) {
      const candidate = path.join(nr, tail)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return dir
}

export function exportAppsCatalogToFile(targetPath: string, dataDir?: string): { appCount: number; profileCount: number } {
  const cfg = readAppsConfig(dataDir)
  const payload = {
    format: 'multi-agent-studio-apps',
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    scanRoots: cfg.scanRoots,
    scanRanges: cfg.scanRanges,
    apps: cfg.apps.map(({ autoRestart: _omit, ...rest }) => rest),
    profiles: cfg.profiles
  }
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8')
  return { appCount: cfg.apps.length, profileCount: cfg.profiles.length }
}

export function importAppsCatalogFromFile(
  sourcePath: string,
  dataDir?: string
): { addedApps: number; addedProfiles: number; duplicates: number; missingDirs: number; config: AppsCatalogConfig } {
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '')) as {
    scanRoots?: unknown
    apps?: Array<Partial<DevAppConfig>>
    profiles?: AppsProfile[]
  }
  if (!parsed || !Array.isArray(parsed.apps)) {
    throw new Error('File không đúng định dạng danh mục app.')
  }

  const cfg = readAppsConfig(dataDir)
  const newRoots = cfg.scanRoots.filter((r) => fs.existsSync(r))
  const oldRoots = Array.isArray(parsed.scanRoots) ? parsed.scanRoots.map((x) => String(x || '').trim()).filter(Boolean) : []

  const haveDir = new Map<string, string>()
  const taken = new Set<string>(cfg.removed.map((r) => r.id))
  for (const a of cfg.apps) {
    taken.add(a.id)
    if (a.dir) haveDir.set(a.dir.replace(/[\\/]+$/, '').toLowerCase(), a.id)
  }

  const idMap = new Map<string, string>()
  let addedApps = 0
  let duplicates = 0
  let missingDirs = 0

  for (const rawApp of parsed.apps) {
    const rawId = String(rawApp.id || '').trim()
    const resolvedDir = resolveImportedDir(String(rawApp.dir || ''), oldRoots, newRoots)
    const dirKey = resolvedDir.replace(/[\\/]+$/, '').toLowerCase()
    if (dirKey && haveDir.has(dirKey)) {
      if (rawId) idMap.set(rawId, haveDir.get(dirKey)!)
      duplicates++
      continue
    }

    const nextId = rawId && !taken.has(rawId) && /^[a-z0-9-]+$/.test(rawId)
      ? (taken.add(rawId), rawId)
      : generateAppId(String(rawApp.name || 'app'), taken)
    if (rawId) idMap.set(rawId, nextId)
    if (resolvedDir && !fs.existsSync(resolvedDir)) missingDirs++

    cfg.apps.push(normalizeAppEntry({ ...rawApp, id: nextId, dir: resolvedDir, manual: true }, nextId))
    if (dirKey) haveDir.set(dirKey, nextId)
    addedApps++
  }

  const profNames = new Set(cfg.profiles.map((p) => p.name))
  let addedProfiles = 0
  for (const p of parsed.profiles ?? []) {
    if (!p?.name || profNames.has(p.name)) continue
    cfg.profiles.push({
      name: p.name,
      ids: (p.ids ?? []).map((oldId) => idMap.get(oldId) ?? oldId).filter((id) => taken.has(id))
    })
    addedProfiles++
  }

  const saved = writeAppsConfig(cfg, dataDir)
  return { addedApps, addedProfiles, duplicates, missingDirs, config: saved }
}
