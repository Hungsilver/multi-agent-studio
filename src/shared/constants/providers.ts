import type { ProviderId } from '../types/ai'

export interface ProviderMetadata {
  id: ProviderId
  name: string
  shortName: string
  color: string
  badgeBg: string
  executable: string
  packageName: string
  installCommand: string
  presetModels: string[]
  supportsEffort: boolean
  supportsImageFlag: boolean
  description: string
}

export const PROVIDERS: Record<ProviderId, ProviderMetadata> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    shortName: 'Claude',
    color: '#D97757',
    badgeBg: 'rgba(217, 119, 87, 0.14)',
    executable: 'claude',
    packageName: '@anthropic-ai/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code@latest',
    presetModels: ['sonnet', 'opus', 'haiku'],
    supportsEffort: false,
    supportsImageFlag: false,
    description: 'Anthropic Claude Code CLI — mạnh về phân tích codebase lớn và sửa code chuẩn xác.'
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex',
    shortName: 'Codex',
    color: '#10A37F',
    badgeBg: 'rgba(16, 163, 127, 0.14)',
    executable: 'codex',
    packageName: '@openai/codex',
    installCommand: 'npm install -g @openai/codex@latest',
    presetModels: ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    supportsEffort: false,
    supportsImageFlag: true,
    description: 'OpenAI Codex CLI — tối ưu tốc độ sửa code, sandbox Windows & review code.'
  },
  agy: {
    id: 'agy',
    name: 'Antigravity CLI',
    shortName: 'AGY',
    color: '#3B82F6',
    badgeBg: 'rgba(59, 130, 246, 0.14)',
    executable: 'agy',
    packageName: 'antigravity-cli',
    installCommand: 'irm https://antigravity.google/cli/install.ps1 | iex',
    presetModels: [
      'gemini-4-neon-high',
      'gemini-4-neon-medium',
      'gemini-4-carbon-high',
      'gemini-pro-orchestrator-neon',
      'gemini-pro-orchestrator',
      'gemini-3.8-flash-high',
      'claude-opus-5-5-high',
      'claude-sonnet-5-5-high'
    ],
    supportsEffort: true,
    supportsImageFlag: false,
    description: 'Google Antigravity CLI (agy) — hỗ trợ đa model Gemini 4 / Claude / Reasoning effort & subagents.'
  }
}

export const PROVIDER_LIST: ProviderMetadata[] = [
  PROVIDERS.claude,
  PROVIDERS.codex,
  PROVIDERS.agy
]
