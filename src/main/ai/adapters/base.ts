import type { EffortLevel, NormalizedAgentEvent, PermissionMode, ProviderId, ToolCategory } from '@shared/types/ai'

export interface AdapterBuildCommandInput {
  mode: PermissionMode
  model: string
  effort: EffortLevel
  providerSessionId: string | null
  prompt: string
  imagePaths: string[]
  extraDirs: string[]
  claudeAuthMode: 'env' | 'account'
  workDir?: string
}

export interface AdapterCommandSpec {
  args: string[]
  stdinData: string
  unsetEnv: string[]
}

export interface IAiProviderAdapter {
  readonly provider: ProviderId
  buildHeadlessCommand(input: AdapterBuildCommandInput): AdapterCommandSpec
  buildInteractiveArgs(sessionId: string | null, model: string): string[]
  parseLine(line: string, state: AdapterStreamState): NormalizedAgentEvent[]
  flush(state: AdapterStreamState): NormalizedAgentEvent[]
  formatProcessError(exitCode: number, stderr: string): { message: string; hint?: string }
}

export interface AdapterStreamState {
  buffer: string
  seenTextDelta: boolean
  activeToolCalls: Map<string, { name: string; category: ToolCategory }>
}

export function createAdapterStreamState(): AdapterStreamState {
  return {
    buffer: '',
    seenTextDelta: false,
    activeToolCalls: new Map()
  }
}

export function classifyToolCategory(name: string): ToolCategory {
  const n = name.toLowerCase()
  if (/^(read|read_file|view_file|glob|ls|list_dir|list_directory|find_by_name)$/.test(n)) return 'read'
  if (/^(grep|search|search_file_content|grep_search|ripgrep|web_search)$/.test(n)) return 'search'
  if (/^(edit|multiedit|write|write_file|write_to_file|replace|replace_file_content|multi_replace_file_content|notebookedit|sửa file)$/.test(n)) return 'edit'
  if (/^(bash|run_command|run_shell_command|powershell|chạy lệnh|command_execution)$/.test(n)) return 'bash'
  if (n.includes('subagent') || n === 'task' || n === 'invoke_subagent') return 'agent'
  if (n.includes('mcp') || n.includes('·')) return 'mcp'
  return 'other'
}

export function summarizeToolInput(input: Record<string, unknown> | undefined, cwd?: string): string {
  if (!input) return ''
  const keys = ['file_path', 'path', 'TargetFile', 'AbsolutePath', 'command', 'CommandLine', 'pattern', 'Query', 'query', 'url', 'description', 'prompt']
  for (const k of keys) {
    const val = input[k]
    if (typeof val === 'string' && val.trim()) {
      let clean = val.trim().split(/\r?\n/)[0]
      if (cwd) {
        const prefix = cwd.replace(/[\\/]+$/, '') + '\\'
        if (clean.toLowerCase().startsWith(prefix.toLowerCase())) {
          clean = clean.slice(prefix.length)
        }
      }
      return clean.length > 140 ? `${clean.slice(0, 140)}…` : clean
    }
  }
  return ''
}
