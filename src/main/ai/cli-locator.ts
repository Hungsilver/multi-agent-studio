import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PROVIDERS } from '@shared/constants/providers'
import type { CliStatus, ProviderId } from '@shared/types/ai'
import {
  getEnrichedEnv,
  isTransientFnmMultishell,
  resolveFnmInstallationDirs,
  resolveWindowsEnvironment
} from '../system/env-resolver'

export interface ResolvedCliCommand {
  file: string
  argsPrefix: string[]
  resolvedVia: CliStatus['resolvedVia']
  executablePath: string
  entryScriptPath?: string
}

function execCapture(
  file: string,
  args: string[],
  timeoutMs = 6000,
  env: NodeJS.ProcessEnv = getEnrichedEnv()
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', env },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
          return
        }
        const anyErr = err as NodeJS.ErrnoException & { code?: number | string }
        resolve({
          code: typeof anyErr.code === 'number' ? anyErr.code : 1,
          stdout: stdout ?? '',
          stderr: stderr || err.message
        })
      }
    )
  })
}

export function readCodexConfigDefaultModel(
  codexHome = path.join(os.homedir(), '.codex')
): string | null {
  const cfgPath = path.join(codexHome, 'config.toml')
  if (!fs.existsSync(cfgPath)) return null
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8')
    const m = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

export function readCodexCachedModels(
  codexHome = path.join(os.homedir(), '.codex')
): string[] {
  const cachePath = path.join(codexHome, 'models_cache.json')
  if (!fs.existsSync(cachePath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      models?: Array<{ slug?: string; id?: string; visibility?: string; priority?: number }>
    }
    const rawModels = parsed.models ?? []
    const listed = rawModels
      .filter((m) => m.visibility === 'list')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    const pool =
      listed.length > 0
        ? listed
        : rawModels.filter((m) => m.visibility !== 'hide' && m.visibility !== 'hidden')
    const slugs = pool.map((m) => m.slug || m.id || '').filter(Boolean)
    return Array.from(new Set(slugs)).slice(0, 20)
  } catch {
    return []
  }
}

export function resolveEffectiveCodexModel(
  selectedModel: string,
  codexHome = path.join(os.homedir(), '.codex')
): { model: string; fallbackReason?: string } {
  const clean = selectedModel.trim()
  if (clean) return { model: clean }

  const cfgModel = readCodexConfigDefaultModel(codexHome)
  const cached = readCodexCachedModels(codexHome)
  if (cfgModel && cached.length > 0 && !cached.includes(cfgModel)) {
    return {
      model: cached[0],
      fallbackReason: `Model "${cfgModel}" trong ~/.codex/config.toml không nằm trong danh sách khả dụng — tự động chuyển sang "${cached[0]}".`
    }
  }
  return { model: '' }
}

function readTailSync(filePath: string, maxBytes = 96_000): string {
  const stat = fs.statSync(filePath)
  if (stat.size <= maxBytes) return fs.readFileSync(filePath, 'utf8')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

export function detectClaudeDefaultModel(
  claudeHome = path.join(os.homedir(), '.claude')
): { model: string; source: string } {
  const settingsPath = path.join(claudeHome, 'settings.json')
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { model?: unknown }
      if (typeof parsed.model === 'string' && parsed.model.trim()) {
        return { model: parsed.model.trim(), source: '~/.claude/settings.json' }
      }
    } catch {
      // ignore invalid json
    }
  }

  const envModel = (process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || '').trim()
  if (envModel) {
    return { model: envModel, source: 'biến môi trường' }
  }

  // Fallback: kiểm tra model gần nhất mà Claude CLI sử dụng trong ~/.claude/projects
  const projectsDir = path.join(claudeHome, 'projects')
  if (fs.existsSync(projectsDir)) {
    try {
      const candidates: Array<{ file: string; mtime: number }> = []
      for (const proj of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!proj.isDirectory()) continue
        const pDir = path.join(projectsDir, proj.name)
        for (const f of fs.readdirSync(pDir, { withFileTypes: true })) {
          if (f.isFile() && f.name.endsWith('.jsonl')) {
            const full = path.join(pDir, f.name)
            candidates.push({ file: full, mtime: fs.statSync(full).mtimeMs })
          }
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime)
      for (const c of candidates.slice(0, 3)) {
        const tail = readTailSync(c.file, 131_072)
        const matches = Array.from(tail.matchAll(/"model"\s*:\s*"(claude-[^"]+)"/g))
        const last = matches[matches.length - 1]
        if (last?.[1]) {
          return { model: last[1], source: 'mặc định Claude CLI' }
        }
      }
    } catch {
      // ignore
    }
  }

  return { model: 'sonnet', source: 'mặc định CLI' }
}

export function detectAgyDefaultModel(
  parsedModels: Array<{ id: string; label: string }>,
  agyHome = path.join(os.homedir(), '.gemini', 'antigravity-cli')
): { model: string | null; source: string | null } {
  const settingsPath = path.join(agyHome, 'settings.json')
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
        model?: unknown
        defaultModel?: unknown
      }
      const m = typeof parsed.model === 'string' ? parsed.model : typeof parsed.defaultModel === 'string' ? parsed.defaultModel : ''
      if (m.trim()) {
        return { model: m.trim(), source: '~/.gemini/antigravity-cli/settings.json' }
      }
    } catch {
      // ignore
    }
  }

  const logPath = path.join(agyHome, 'cli.log')
  if (fs.existsSync(logPath)) {
    try {
      const tail = readTailSync(logPath, 96_000)
      const matches = Array.from(
        tail.matchAll(/Propagating selected model override to backend:\s*label="([^"]+)"/g)
      )
      const lastLabel = matches[matches.length - 1]?.[1]
      if (lastLabel) {
        const hit = parsedModels.find(
          (m) => m.label.toLowerCase() === lastLabel.toLowerCase() || m.id.toLowerCase() === lastLabel.toLowerCase()
        )
        if (hit) {
          return { model: hit.id, source: 'mặc định AGY CLI' }
        }
      }
    } catch {
      // ignore
    }
  }

  if (parsedModels.length > 0) {
    return { model: parsedModels[0].id, source: 'mặc định AGY CLI' }
  }
  return { model: null, source: null }
}

export function findCodexEntryInDir(dir: string): { nodeExe: string; codexJs: string } | null {
  const nodeExe = path.join(dir, 'node.exe')
  const codexJs = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  if (fs.existsSync(nodeExe) && fs.existsSync(codexJs)) {
    return { nodeExe, codexJs }
  }
  return null
}

function findExeInDirs(names: string[], dirs: string[]): string | null {
  for (const dir of dirs) {
    if (!dir || isTransientFnmMultishell(dir) || !fs.existsSync(dir)) continue
    for (const name of names) {
      const full = path.join(dir, name)
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return full
      }
    }
  }
  return null
}

export function resolveCliCommand(
  provider: ProviderId,
  overridePath?: string
): ResolvedCliCommand | null {
  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const envInfo = resolveWindowsEnvironment()

  if (overridePath && fs.existsSync(overridePath)) {
    if (overridePath.toLowerCase().endsWith('.js')) {
      const node = findExeInDirs(['node.exe'], envInfo.persistentBinDirs) ?? 'node.exe'
      return {
        file: node,
        argsPrefix: [overridePath],
        resolvedVia: 'override',
        executablePath: overridePath,
        entryScriptPath: overridePath
      }
    }
    if (overridePath.toLowerCase().endsWith('.cmd') || overridePath.toLowerCase().endsWith('.bat')) {
      return {
        file: process.env.ComSpec || 'cmd.exe',
        argsPrefix: ['/d', '/s', '/c', overridePath],
        resolvedVia: 'override',
        executablePath: overridePath
      }
    }
    return {
      file: overridePath,
      argsPrefix: [],
      resolvedVia: 'override',
      executablePath: overridePath
    }
  }

  if (provider === 'codex') {
    const fnm = resolveFnmInstallationDirs()
    const candidateNodeDirs = [
      ...(fnm.fnmRealDir ? [fnm.fnmRealDir] : []),
      ...fnm.allNodeDirs,
      ...envInfo.persistentBinDirs
    ]
    for (const dir of candidateNodeDirs) {
      const hit = findCodexEntryInDir(dir)
      if (hit) {
        const isFnm = fnm.allNodeDirs.some((d) => d.toLowerCase() === dir.toLowerCase()) ||
          (fnm.fnmRealDir?.toLowerCase() === dir.toLowerCase())
        return {
          file: hit.nodeExe,
          argsPrefix: [hit.codexJs],
          resolvedVia: isFnm ? 'fnm' : 'registry-path',
          executablePath: hit.nodeExe,
          entryScriptPath: hit.codexJs
        }
      }
    }
    // Fallback codex.cmd trong %APPDATA%\npm
    const npmCmd = findExeInDirs(['codex.cmd', 'codex.exe'], [path.join(appData, 'npm'), ...envInfo.persistentBinDirs])
    if (npmCmd) {
      if (npmCmd.toLowerCase().endsWith('.cmd')) {
        return {
          file: process.env.ComSpec || 'cmd.exe',
          argsPrefix: ['/d', '/s', '/c', npmCmd],
          resolvedVia: 'standard-dir',
          executablePath: npmCmd
        }
      }
      return { file: npmCmd, argsPrefix: [], resolvedVia: 'standard-dir', executablePath: npmCmd }
    }
    return null
  }

  if (provider === 'agy') {
    const standardDirs = [
      path.join(localAppData, 'agy', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.gemini', 'antigravity', 'bin')
    ]
    const stdHit = findExeInDirs(['agy.exe', 'agy.cmd'], standardDirs)
    if (stdHit) {
      return {
        file: stdHit,
        argsPrefix: [],
        resolvedVia: 'standard-dir',
        executablePath: stdHit
      }
    }
    const regHit = findExeInDirs(['agy.exe', 'agy.cmd'], envInfo.persistentBinDirs)
    if (regHit) {
      return { file: regHit, argsPrefix: [], resolvedVia: 'registry-path', executablePath: regHit }
    }
    return null
  }

  if (provider === 'claude') {
    const stdHit = findExeInDirs(
      ['claude.exe', 'claude.cmd'],
      [path.join(home, '.local', 'bin'), path.join(appData, 'npm')]
    )
    if (stdHit) {
      return stdHit.toLowerCase().endsWith('.cmd')
        ? { file: process.env.ComSpec || 'cmd.exe', argsPrefix: ['/d', '/s', '/c', stdHit], resolvedVia: 'standard-dir', executablePath: stdHit }
        : { file: stdHit, argsPrefix: [], resolvedVia: 'standard-dir', executablePath: stdHit }
    }
    const regHit = findExeInDirs(['claude.exe', 'claude.cmd'], envInfo.persistentBinDirs)
    if (regHit) {
      return regHit.toLowerCase().endsWith('.cmd')
        ? { file: process.env.ComSpec || 'cmd.exe', argsPrefix: ['/d', '/s', '/c', regHit], resolvedVia: 'registry-path', executablePath: regHit }
        : { file: regHit, argsPrefix: [], resolvedVia: 'registry-path', executablePath: regHit }
    }
    return null
  }

  return null
}

let cachedStatuses: CliStatus[] | null = null

export async function inspectAllClis(
  overrides: Partial<Record<ProviderId, string>> = {},
  forceRefresh = false
): Promise<CliStatus[]> {
  if (cachedStatuses && !forceRefresh) return cachedStatuses
  if (forceRefresh) resolveWindowsEnvironment(true)

  const env = getEnrichedEnv([], forceRefresh)
  const providers: ProviderId[] = ['claude', 'codex', 'agy']

  const results = await Promise.all(
    providers.map(async (provider): Promise<CliStatus> => {
      const meta = PROVIDERS[provider]
      const resolved = resolveCliCommand(provider, overrides[provider])

      if (!resolved) {
        return {
          provider,
          name: meta.name,
          installed: false,
          executablePath: null,
          resolvedVia: 'not-found',
          version: null,
          defaultModel: null,
          defaultModelSource: null,
          models: [...meta.presetModels],
          installCommand: meta.installCommand
        }
      }

      const verRes = await execCapture(resolved.file, [...resolved.argsPrefix, '--version'], 6000, env)
      const version = verRes.code === 0 ? verRes.stdout.trim().split(/\r?\n/)[0] || null : null

      let models = [...meta.presetModels]
      let defaultModel: string | null = null
      let defaultModelSource: string | null = null
      let notes: string | undefined

      if (provider === 'claude') {
        const detected = detectClaudeDefaultModel()
        defaultModel = detected.model
        defaultModelSource = detected.source
        if (defaultModel && !models.includes(defaultModel)) {
          models = [defaultModel, ...models]
        }
      } else if (provider === 'codex') {
        const cfgDefault = readCodexConfigDefaultModel()
        const cached = readCodexCachedModels()
        if (cached.length > 0) {
          if (cfgDefault && cached.includes(cfgDefault)) {
            defaultModel = cfgDefault
            defaultModelSource = '~/.codex/config.toml'
          } else {
            defaultModel = cached[0]
            defaultModelSource = cfgDefault
              ? `fallback từ ${cfgDefault} (models_cache.json)`
              : 'models_cache.json'
          }
          models = Array.from(new Set([...cached, ...meta.presetModels]))
        } else {
          defaultModel = cfgDefault
          defaultModelSource = cfgDefault ? '~/.codex/config.toml' : null
          if (defaultModel && !models.includes(defaultModel)) {
            models = [defaultModel, ...models]
          }
        }
        if (resolved.resolvedVia === 'fnm') {
          notes = 'Chạy trực tiếp qua node.exe + codex.js (bền vững qua fnm alias, không qua shim .ps1/.cmd).'
        }
      } else if (provider === 'agy') {
        const modRes = await execCapture(resolved.file, [...resolved.argsPrefix, 'models'], 8000, env)
        const parsedModelPairs: Array<{ id: string; label: string }> = []
        if (modRes.code === 0 && modRes.stdout) {
          for (const rawLine of modRes.stdout.split(/\r?\n/)) {
            const line = rawLine.trim()
            if (!line || line.startsWith('Fetching')) continue
            const [idRaw, labelRaw] = line.split('\t')
            const id = idRaw?.trim()
            if (id) {
              parsedModelPairs.push({ id, label: (labelRaw ?? id).trim() })
            }
          }
          if (parsedModelPairs.length > 0) {
            models = Array.from(new Set(parsedModelPairs.map((m) => m.id)))
          }
        }
        const detected = detectAgyDefaultModel(parsedModelPairs)
        defaultModel = detected.model
        defaultModelSource = detected.source
      }

      return {
        provider,
        name: meta.name,
        installed: true,
        executablePath: resolved.executablePath,
        entryScriptPath: resolved.entryScriptPath,
        resolvedVia: resolved.resolvedVia,
        version,
        defaultModel,
        defaultModelSource,
        models,
        installCommand: meta.installCommand,
        notes
      }
    })
  )

  cachedStatuses = results
  return results
}
