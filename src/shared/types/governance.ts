export interface SkillItem {
  id: string
  name: string
  description: string
  tags: string[]
  body: string
  rawContent: string
  filePath: string
  scope: 'workspace' | 'global'
  source: 'claude' | 'agents' | 'gemini' | 'app' | 'plugin'
  updatedAt: string
}

export interface RuleFile {
  id: string
  name: string // AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules
  filePath: string
  scope: 'workspace' | 'global'
  exists: boolean
  content: string
  updatedAt: string | null
}

export interface McpServerInfo {
  name: string
  source: string // ~/.claude.json, .mcp.json, ~/.codex/config.toml
  transport: 'stdio' | 'sse' | 'http' | 'unknown'
  commandOrUrl: string
  args: string[]
  enabled: boolean
}

export interface PromptTemplate {
  id: string
  slashCmd: string
  title: string
  description: string
  body: string
  scope: 'global' | 'workspace'
}
