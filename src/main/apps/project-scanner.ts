import fs from 'node:fs'
import path from 'node:path'
import type { AppsScanResult, DevAppConfig, DevAppType } from '@shared/types/apps'
import { generateAppId, readAppsConfig, writeAppsConfig } from './apps-store'

export const SCAN_SKIP_DIRS = new Set([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'coverage',
  'packages',
  'wwwroot',
  '@mf-types',
  'TestResults'
])

interface DiscoveredProject {
  group: string
  name: string
  type: DevAppType
  port: number
  url: string
  dir: string
  start: string
}

export function findProjectFiles(root: string, maxDepth = 6): string[] {
  const results: string[] = []
  if (!fs.existsSync(root)) return results

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (stack.length > 0) {
    const item = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(item.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const ent of entries) {
      if (ent.isFile()) {
        if (ent.name.endsWith('.csproj') || ent.name === 'package.json') {
          results.push(path.join(item.dir, ent.name))
        }
      } else if (ent.isDirectory() && item.depth < maxDepth) {
        if (ent.name.startsWith('.') || SCAN_SKIP_DIRS.has(ent.name)) continue
        stack.push({ dir: path.join(item.dir, ent.name), depth: item.depth + 1 })
      }
    }
  }
  return results
}

export function deriveGroupName(root: string, projectDir: string): string {
  const cleanRoot = path.resolve(root).replace(/[\\/]+$/, '')
  const cleanDir = path.resolve(projectDir)
  const rel = cleanDir.slice(cleanRoot.length).replace(/^[\\/]+/, '')
  let seg = rel.split(/[\\/]/)[0] || ''
  if (!seg || seg === rel) {
    seg = path.basename(cleanRoot) || 'PROJECT'
  }
  return seg
    .replace(/\.projects?$/i, '')
    .toUpperCase()
}

export function parseDotnetProject(csprojPath: string): Omit<DiscoveredProject, 'group'> | null {
  let content: string
  try {
    content = fs.readFileSync(csprojPath, 'utf8')
  } catch {
    return null
  }

  if (/Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest/i.test(content)) return null
  const isWeb = /Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(content)
  const isWorker = /Sdk="Microsoft\.NET\.Sdk\.Worker"/i.test(content)
  const isExe = /<OutputType>\s*Exe\s*<\/OutputType>/i.test(content)
  if (!isWeb && !isWorker && !isExe) return null

  const dir = path.dirname(csprojPath)
  const name = path.basename(csprojPath, '.csproj')

  if (isWeb || isWorker) {
    const lsPath = path.join(dir, 'Properties', 'launchSettings.json')
    let port = 0
    let profileName = ''
    let baseUrl = ''

    if (fs.existsSync(lsPath)) {
      try {
        const ls = JSON.parse(fs.readFileSync(lsPath, 'utf8').replace(/^\uFEFF/, '')) as {
          profiles?: Record<string, { commandName?: string; applicationUrl?: string }>
        }
        const entries = Object.entries(ls.profiles ?? {}).filter(
          ([, p]) => p?.commandName === 'Project' && Boolean(p.applicationUrl)
        )
        const picked = entries.find(([k]) => k === 'https') ?? entries[0]
        if (picked) {
          profileName = picked[0]
          const urls = String(picked[1].applicationUrl || '')
            .split(';')
            .map((u) => u.trim())
            .filter(Boolean)
          baseUrl = urls.find((u) => u.startsWith('https')) ?? urls[0] ?? ''
          const portMatch = baseUrl.match(/:(\d+)/)
          if (portMatch) port = parseInt(portMatch[1], 10)
        }
      } catch {
        // ignore invalid launchSettings.json
      }
    }

    if (port > 0) {
      const profileArg = /\s/.test(profileName)
        ? `"${profileName.replace(/"/g, '\\"')}"`
        : profileName
      return {
        name,
        type: /bff/i.test(name) ? 'bff' : 'backend',
        port,
        url: `${baseUrl.replace(/\/+$/, '')}/swagger`,
        dir,
        start: `dotnet run --launch-profile ${profileArg}`
      }
    }

    if (isWeb && !isExe) return null
  }

  return {
    name,
    type: 'tool',
    port: 0,
    url: '',
    dir,
    start: 'dotnet run'
  }
}

export function parseViteProject(packageJsonPath: string): Omit<DiscoveredProject, 'group'> | null {
  const dir = path.dirname(packageJsonPath)
  let viteFile = ''
  try {
    const files = fs.readdirSync(dir)
    viteFile = files.find((f) => /^vite\.config\./i.test(f)) ?? ''
  } catch {
    return null
  }
  if (!viteFile) return null

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8').replace(/^\uFEFF/, '')) as {
      scripts?: Record<string, string>
    }
    if (!pkg.scripts?.dev) return null
  } catch {
    return null
  }

  let viteText = ''
  try {
    viteText = fs.readFileSync(path.join(dir, viteFile), 'utf8')
  } catch {
    return null
  }

  const stripped = viteText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  const serverBlockMatch = stripped.match(/\bserver\s*:\s*\{([\s\S]*?)\}/)
  const serverPortMatch = serverBlockMatch ? serverBlockMatch[1].match(/\bport\s*:\s*(\d+)/) : null
  let port = 5173
  if (serverPortMatch) {
    port = parseInt(serverPortMatch[1], 10)
  } else {
    const withoutPreview = stripped.replace(/\bpreview\s*:\s*\{[\s\S]*?\}/g, '')
    const fallbackMatch = withoutPreview.match(/\bport\s*:\s*(\d+)/)
    if (fallbackMatch) port = parseInt(fallbackMatch[1], 10)
  }

  const scheme = /mkcert|https\s*:\s*(true|\{)/.test(stripped) ? 'https' : 'http'
  return {
    name: path.basename(dir),
    type: 'frontend',
    port,
    url: `${scheme}://localhost:${port}`,
    dir,
    start: 'npm run dev'
  }
}

export function scanAndUpdateAppsCatalog(roots: string[], dataDir?: string): AppsScanResult {
  const validRoots = roots
    .map((r) => r.trim())
    .filter((r) => r && fs.existsSync(r))
    .map((r) => path.resolve(r).replace(/[\\/]+$/, ''))

  const cfg = readAppsConfig(dataDir)
  const existingByDir = new Map<string, DevAppConfig>()
  for (const a of cfg.apps) {
    if (a.dir) existingByDir.set(a.dir.replace(/[\\/]+$/, '').toLowerCase(), a)
  }

  const removedDirs = new Set(
    cfg.removed.filter((r) => r.dir).map((r) => r.dir.replace(/[\\/]+$/, '').toLowerCase())
  )
  const isInsideRoots = (dir: string): boolean => {
    const low = dir.replace(/[\\/]+$/, '').toLowerCase()
    return validRoots.some((r) => low.startsWith(`${r.toLowerCase()}\\`) || low.startsWith(`${r.toLowerCase()}/`) || low === r.toLowerCase())
  }

  const keep = cfg.apps.filter((a) => a.manual || Boolean(a.iis) || !a.dir || !isInsideRoots(a.dir))
  for (const a of cfg.apps) {
    if (a.iis && a.dir) {
      removedDirs.add(a.dir.replace(/[\\/]+$/, '').toLowerCase())
    }
  }

  const taken = new Set<string>([...keep.map((a) => a.id), ...cfg.removed.map((r) => r.id)])
  const found: DiscoveredProject[] = []

  for (const root of validRoots) {
    for (const file of findProjectFiles(root)) {
      const parsed = file.endsWith('.csproj') ? parseDotnetProject(file) : parseViteProject(file)
      if (parsed) {
        found.push({ ...parsed, group: deriveGroupName(root, parsed.dir) })
      }
    }
  }

  found.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group)
    if (a.type !== b.type) return a.type.localeCompare(b.type)
    return a.name.localeCompare(b.name)
  })

  const seenDirs = new Set<string>(
    keep.filter((a) => a.dir).map((a) => a.dir.replace(/[\\/]+$/, '').toLowerCase())
  )
  const scanned: DevAppConfig[] = []
  for (const p of found) {
    const dirKey = p.dir.replace(/[\\/]+$/, '').toLowerCase()
    if (removedDirs.has(dirKey) || seenDirs.has(dirKey)) continue
    seenDirs.add(dirKey)
    const old = existingByDir.get(dirKey)
    if (old && !taken.has(old.id)) {
      taken.add(old.id)
      scanned.push({ ...old, port: p.port, type: p.type, url: p.url, start: p.start })
    } else {
      const id = generateAppId(p.name, taken)
      scanned.push({
        id,
        group: p.group,
        name: p.name,
        type: p.type,
        port: p.port,
        url: p.url,
        dir: p.dir,
        start: p.start
      })
    }
  }

  cfg.scanRoots = validRoots.length > 0 ? validRoots : cfg.scanRoots
  cfg.apps = [...keep, ...scanned]
  const saved = writeAppsConfig(cfg, dataDir)
  return {
    scannedCount: scanned.length,
    totalCount: saved.apps.length,
    config: saved
  }
}
