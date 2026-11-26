import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ResolvedNodeEnvironment {
  fnmRealDir: string | null
  fnmAliasDir: string | null
  registryPathEntries: string[]
  persistentBinDirs: string[]
}

function readRegistryPathValue(hiveKey: string): string {
  try {
    const out = execFileSync(
      'reg.exe',
      ['query', hiveKey, '/v', 'Path'],
      { encoding: 'utf8', timeout: 2500, windowsHide: true }
    )
    const match = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
    if (!match) return ''
    return expandWindowsEnv(match[1].trim())
  } catch {
    return ''
  }
}

function expandWindowsEnv(raw: string): string {
  return raw.replace(/%([^%]+)%/g, (full, name: string) => {
    const val = process.env[name] ?? process.env[name.toUpperCase()]
    return val !== undefined ? val : full
  })
}

export function isTransientFnmMultishell(dir: string): boolean {
  return /fnm_multishells[\\/]/i.test(dir)
}

export function normalizePathEntry(p: string): string {
  return p.trim().replace(/[\\/]+$/, '')
}

export function compareSemverDesc(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function resolveFnmInstallationDirs(env: NodeJS.ProcessEnv = process.env): {
  fnmAliasDir: string | null
  fnmRealDir: string | null
  allNodeDirs: string[]
} {
  const home = env.USERPROFILE || os.homedir()
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')

  const fnmRoots = [
    env.FNM_DIR,
    path.join(appData, 'fnm'),
    path.join(localAppData, 'fnm'),
    path.join(home, '.fnm')
  ].filter((x): x is string => Boolean(x))

  let fnmAliasDir: string | null = null
  let fnmRealDir: string | null = null
  const allNodeDirs: string[] = []

  for (const root of fnmRoots) {
    const aliasDefault = path.join(root, 'aliases', 'default')
    if (fs.existsSync(aliasDefault)) {
      if (!fnmAliasDir) fnmAliasDir = aliasDefault
      try {
        const real = fs.realpathSync(aliasDefault)
        if (!fnmRealDir && fs.existsSync(real)) {
          fnmRealDir = real
        }
        if (fs.existsSync(real) && !allNodeDirs.includes(real)) {
          allNodeDirs.push(real)
        }
      } catch {
        if (!fnmRealDir) fnmRealDir = aliasDefault
      }
    }

    const versionsDir = path.join(root, 'node-versions')
    if (fs.existsSync(versionsDir)) {
      try {
        const versions = fs
          .readdirSync(versionsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => d.name)
          .sort(compareSemverDesc)

        for (const v of versions) {
          const inst = path.join(versionsDir, v, 'installation')
          if (fs.existsSync(inst) && !allNodeDirs.includes(inst)) {
            allNodeDirs.push(inst)
            if (!fnmRealDir) fnmRealDir = inst
          }
        }
      } catch {
        // ignore unreadable dir
      }
    }
  }

  return { fnmAliasDir, fnmRealDir, allNodeDirs }
}

let cachedEnv: ResolvedNodeEnvironment | null = null

export function resolveWindowsEnvironment(forceRefresh = false): ResolvedNodeEnvironment {
  if (cachedEnv && !forceRefresh) return cachedEnv

  const home = process.env.USERPROFILE || os.homedir()
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')

  const { fnmAliasDir, fnmRealDir, allNodeDirs } = resolveFnmInstallationDirs(process.env)

  const userReg = process.platform === 'win32' ? readRegistryPathValue('HKCU\\Environment') : ''
  const machineReg =
    process.platform === 'win32'
      ? readRegistryPathValue('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
      : ''

  const rawEntries = [
    ...allNodeDirs,
    path.join(localAppData, 'agy', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(appData, 'npm'),
    ...(userReg ? userReg.split(';') : []),
    ...(machineReg ? machineReg.split(';') : []),
    ...(process.env.PATH ? process.env.PATH.split(';') : [])
  ]

  const seen = new Set<string>()
  const persistentBinDirs: string[] = []
  const registryPathEntries: string[] = []

  for (const raw of rawEntries) {
    const clean = normalizePathEntry(raw)
    if (!clean || isTransientFnmMultishell(clean)) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    persistentBinDirs.push(clean)
  }

  for (const raw of [...(userReg ? userReg.split(';') : []), ...(machineReg ? machineReg.split(';') : [])]) {
    const clean = normalizePathEntry(raw)
    if (clean) registryPathEntries.push(clean)
  }

  cachedEnv = {
    fnmRealDir,
    fnmAliasDir,
    registryPathEntries,
    persistentBinDirs
  }
  return cachedEnv
}

export function buildEnrichedPath(
  baseEnv: NodeJS.ProcessEnv = process.env,
  resolved?: ResolvedNodeEnvironment
): string {
  const info = resolved ?? resolveWindowsEnvironment()
  const merged = [
    ...info.persistentBinDirs,
    ...(baseEnv.PATH || baseEnv.Path || '')
      .split(';')
      .map(normalizePathEntry)
      .filter((p) => p && !isTransientFnmMultishell(p))
  ]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const entry of merged) {
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(entry)
  }
  return unique.join(';')
}

export function getEnrichedEnv(
  unsetVars: string[] = [],
  forceRefresh = false
): NodeJS.ProcessEnv {
  const resolved = resolveWindowsEnvironment(forceRefresh)
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of unsetVars) {
    delete env[key]
  }
  delete env.FNM_MULTISHELL_PATH
  const enrichedPath = buildEnrichedPath(env, resolved)
  env.PATH = enrichedPath
  env.Path = enrichedPath
  env.NO_COLOR = '1'
  return env
}
