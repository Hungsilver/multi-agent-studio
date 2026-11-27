import type { ProviderId } from '@shared/types/ai'
import { AgyAdapter } from './agy-adapter'
import type { IAiProviderAdapter } from './base'
import { ClaudeCodeAdapter } from './claude-adapter'
import { CodexAdapter } from './codex-adapter'

const ADAPTERS: Record<ProviderId, IAiProviderAdapter> = {
  claude: new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
  agy: new AgyAdapter()
}

export function getProviderAdapter(provider: ProviderId): IAiProviderAdapter {
  return ADAPTERS[provider]
}
