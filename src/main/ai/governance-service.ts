import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { McpServerInfo, RuleFile, SkillItem } from '@shared/types/governance'
import { getDefaultDataDir } from '../storage/database'

function parseFrontmatter(raw: string): { name: string; description: string; tags: string[]; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { name: '', description: '', tags: [], body: normalized.trim() }
  }
  const yaml = match[1]
  const body = match[2].trim()
  let name = ''
  let description = ''
  let tags: string[] = []

  for (const line of yaml.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    const k = kv[1].toLowerCase()
    const v = kv[2].trim().replace(/^["']|["']$/g, '')
    if (k === 'name') name = v
    else if (k === 'description') description = v
    else if (k === 'tags') {
      tags = v
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
  }
  return { name, description, tags, body }
}

function serializeSkillMarkdown(input: { name: string; description: string; tags: string[]; body: string }): string {
  const tagsLine = input.tags.length > 0 ? `\ntags: [${input.tags.join(', ')}]` : ''
  return `---\nname: ${input.name}\ndescription: ${input.description}${tagsLine}\n---\n\n${input.body.trim()}\n`
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || `skill-${Date.now()}`
  )
}

function scanSkillsRoot(
  rootDir: string,
  scope: 'workspace' | 'global',
  source: SkillItem['source']
): SkillItem[] {
  if (!fs.existsSync(rootDir)) return []
  const items: SkillItem[] = []
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const skillFile = path.join(rootDir, ent.name, 'SKILL.md')
      if (!fs.existsSync(skillFile)) continue
      try {
        const raw = fs.readFileSync(skillFile, 'utf8')
        const stat = fs.statSync(skillFile)
        const parsed = parseFrontmatter(raw)
        const name = parsed.name || ent.name
        items.push({
          id: `${scope}:${source}:${name}`,
          name,
          description: parsed.description || 'Chưa có mô tả',
          tags: parsed.tags,
          body: parsed.body,
          rawContent: raw,
          filePath: skillFile,
          scope,
          source,
          updatedAt: stat.mtime.toISOString()
        })
      } catch {
        // skip unreadable skill
      }
    }
  } catch {
    // skip unreadable root
  }
  return items
}

export function listAllSkills(workspacePath?: string): SkillItem[] {
  const home = os.homedir()
  const appSkillsDir = path.join(getDefaultDataDir(), 'skills')

  const candidates: Array<{ dir: string; scope: 'workspace' | 'global'; source: SkillItem['source'] }> = [
    { dir: appSkillsDir, scope: 'global', source: 'app' },
    { dir: path.join(home, '.claude', 'skills'), scope: 'global', source: 'claude' },
    { dir: path.join(home, '.agents', 'skills'), scope: 'global', source: 'agents' },
    { dir: path.join(home, '.gemini', 'skills'), scope: 'global', source: 'gemini' }
  ]

  if (workspacePath && fs.existsSync(workspacePath)) {
    candidates.unshift(
      { dir: path.join(workspacePath, '.claude', 'skills'), scope: 'workspace', source: 'claude' },
      { dir: path.join(workspacePath, '.agents', 'skills'), scope: 'workspace', source: 'agents' },
      { dir: path.join(workspacePath, '.gemini', 'skills'), scope: 'workspace', source: 'gemini' }
    )
  }

  const all: SkillItem[] = []
  const seenPaths = new Set<string>()
  for (const c of candidates) {
    for (const item of scanSkillsRoot(c.dir, c.scope, c.source)) {
      const key = path.resolve(item.filePath).toLowerCase()
      if (seenPaths.has(key)) continue
      seenPaths.add(key)
      all.push(item)
    }
  }
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export function saveSkillFile(input: {
  workspacePath?: string
  scope: 'workspace' | 'global'
  source?: SkillItem['source']
  name: string
  description: string
  tags: string[]
  body: string
  existingFilePath?: string
}): SkillItem {
  const cleanName = input.name.trim()
  if (!cleanName) throw new Error('Tên Skill không được để trống')
  const slug = slugify(cleanName)
  const source = input.source ?? (input.scope === 'workspace' ? 'agents' : 'app')

  let targetPath = input.existingFilePath
  if (!targetPath) {
    const baseDir =
      input.scope === 'workspace' && input.workspacePath
        ? path.join(input.workspacePath, source === 'claude' ? '.claude' : source === 'gemini' ? '.gemini' : '.agents', 'skills')
        : source === 'claude'
          ? path.join(os.homedir(), '.claude', 'skills')
          : source === 'agents'
            ? path.join(os.homedir(), '.agents', 'skills')
            : path.join(getDefaultDataDir(), 'skills')
    targetPath = path.join(baseDir, slug, 'SKILL.md')
  }

  const content = serializeSkillMarkdown({
    name: cleanName,
    description: input.description.trim(),
    tags: input.tags,
    body: input.body
  })

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, content, 'utf8')
  const stat = fs.statSync(targetPath)

  return {
    id: `${input.scope}:${source}:${cleanName}`,
    name: cleanName,
    description: input.description.trim() || 'Chưa có mô tả',
    tags: input.tags,
    body: input.body.trim(),
    rawContent: content,
    filePath: targetPath,
    scope: input.scope,
    source,
    updatedAt: stat.mtime.toISOString()
  }
}

export function deleteSkillFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const dir = path.dirname(filePath)
  fs.unlinkSync(filePath)
  try {
    const rest = fs.readdirSync(dir)
    if (rest.length === 0) fs.rmdirSync(dir)
  } catch {
    // ignore
  }
}

export function listRuleFiles(workspacePath?: string): RuleFile[] {
  const home = os.homedir()
  const specs: Array<{ name: string; filePath: string; scope: 'workspace' | 'global' }> = []

  if (workspacePath && fs.existsSync(workspacePath)) {
    specs.push(
      { name: 'AGENTS.md', filePath: path.join(workspacePath, 'AGENTS.md'), scope: 'workspace' },
      { name: 'CLAUDE.md', filePath: path.join(workspacePath, 'CLAUDE.md'), scope: 'workspace' },
      { name: 'GEMINI.md', filePath: path.join(workspacePath, 'GEMINI.md'), scope: 'workspace' },
      { name: '.cursorrules', filePath: path.join(workspacePath, '.cursorrules'), scope: 'workspace' }
    )
  }

  specs.push(
    { name: 'Global CLAUDE.md', filePath: path.join(home, '.claude', 'CLAUDE.md'), scope: 'global' },
    { name: 'Global AGENTS.md', filePath: path.join(home, '.codex', 'AGENTS.md'), scope: 'global' },
    { name: 'Global GEMINI.md', filePath: path.join(home, '.gemini', 'GEMINI.md'), scope: 'global' }
  )

  return specs.map((s) => {
    const exists = fs.existsSync(s.filePath)
    let content = ''
    let updatedAt: string | null = null
    if (exists) {
      try {
        content = fs.readFileSync(s.filePath, 'utf8')
        updatedAt = fs.statSync(s.filePath).mtime.toISOString()
      } catch {
        content = ''
      }
    }
    return {
      id: `${s.scope}:${s.name}`,
      name: s.name,
      filePath: s.filePath,
      scope: s.scope,
      exists,
      content,
      updatedAt
    }
  })
}

export function saveRuleFileContent(filePath: string, content: string): RuleFile {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  const stat = fs.statSync(filePath)
  return {
    id: filePath,
    name: path.basename(filePath),
    filePath,
    scope: filePath.startsWith(os.homedir()) ? 'global' : 'workspace',
    exists: true,
    content,
    updatedAt: stat.mtime.toISOString()
  }
}

export function syncAgentsRuleToTargets(
  workspacePath: string,
  targets: Array<'CLAUDE.md' | 'GEMINI.md'>
): RuleFile[] {
  const agentsPath = path.join(workspacePath, 'AGENTS.md')
  if (!fs.existsSync(agentsPath)) {
    throw new Error('Không tìm thấy AGENTS.md trong thư mục workspace để đồng bộ.')
  }
  const content = fs.readFileSync(agentsPath, 'utf8')
  return targets.map((t) => saveRuleFileContent(path.join(workspacePath, t), content))
}

export function listMcpServers(workspacePath?: string): McpServerInfo[] {
  const servers: McpServerInfo[] = []
  const home = os.homedir()

  const parseJsonMcp = (filePath: string, sourceLabel: string): void => {
    if (!fs.existsSync(filePath)) return
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        mcpServers?: Record<string, { command?: string; args?: string[]; url?: string; disabled?: boolean }>
      }
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        servers.push({
          name,
          source: sourceLabel,
          transport: cfg.url ? 'http' : cfg.command ? 'stdio' : 'unknown',
          commandOrUrl: cfg.url || cfg.command || '',
          args: cfg.args ?? [],
          enabled: !cfg.disabled
        })
      }
    } catch {
      // ignore invalid json
    }
  }

  if (workspacePath) {
    parseJsonMcp(path.join(workspacePath, '.mcp.json'), '.mcp.json (workspace)')
  }
  parseJsonMcp(path.join(home, '.claude.json'), '~/.claude.json')

  // Parse ~/.codex/config.toml [mcp_servers.<name>]
  const codexToml = path.join(home, '.codex', 'config.toml')
  if (fs.existsSync(codexToml)) {
    try {
      const raw = fs.readFileSync(codexToml, 'utf8')
      const lines = raw.split(/\r?\n/)
      let curName: string | null = null
      let curCmd = ''
      let curArgs: string[] = []
      const flush = (): void => {
        if (curName) {
          servers.push({
            name: curName,
            source: '~/.codex/config.toml',
            transport: curCmd.startsWith('http') ? 'http' : 'stdio',
            commandOrUrl: curCmd || '(toml config)',
            args: curArgs,
            enabled: true
          })
        }
      }
      for (const l of lines) {
        const sec = l.match(/^\[mcp_servers\.([A-Za-z0-9_.-]+)\]$/)
        if (sec) {
          flush()
          curName = sec[1]
          curCmd = ''
          curArgs = []
          continue
        }
        if (/^\[/.test(l)) {
          flush()
          curName = null
          continue
        }
        if (curName) {
          const cmdM = l.match(/^\s*command\s*=\s*["']([^"']+)["']/)
          if (cmdM) curCmd = cmdM[1]
          const urlM = l.match(/^\s*url\s*=\s*["']([^"']+)["']/)
          if (urlM) curCmd = urlM[1]
        }
      }
      flush()
    } catch {
      // ignore
    }
  }

  return servers
}
