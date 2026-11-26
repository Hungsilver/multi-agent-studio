import type { NormalizedAgentEvent } from '@shared/types/ai'
import {
  classifyToolCategory,
  summarizeToolInput,
  type AdapterBuildCommandInput,
  type AdapterCommandSpec,
  type AdapterStreamState,
  type IAiProviderAdapter
} from './base'

export class GeminiCliAdapter implements IAiProviderAdapter {
  readonly provider = 'gemini' as const

  buildHeadlessCommand(input: AdapterBuildCommandInput): AdapterCommandSpec {
    const approvalMode = {
      plan: 'default',
      edit: 'auto_edit',
      full: 'yolo'
    }[input.mode]

    const args = ['--output-format', 'stream-json', '--approval-mode', approvalMode]
    if (input.model.trim()) args.push('-m', input.model.trim())
    if (input.providerSessionId) args.push('--resume', input.providerSessionId)

    return {
      args,
      stdinData: input.prompt,
      unsetEnv: []
    }
  }

  buildInteractiveArgs(sessionId: string | null, model: string): string[] {
    const args: string[] = []
    if (model.trim()) args.push('-m', model.trim())
    if (sessionId) args.push('--resume', sessionId)
    return args
  }

  parseLine(line: string, state: AdapterStreamState): NormalizedAgentEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    if (!trimmed.startsWith('{')) {
      return [...this.flush(state), { type: 'text.delta', text: `${trimmed}\n` }]
    }

    let j: Record<string, unknown>
    try {
      j = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return []
    }

    const type = String(j.type ?? '')
    if (type === 'message') {
      if (j.role === 'assistant') {
        state.buffer += String(j.content ?? '')
        if (j.delta === false) {
          return this.flush(state)
        }
      }
      return []
    }

    const events = this.flush(state)

    if (type === 'init' && typeof j.session_id === 'string') {
      events.push({ type: 'session.init', providerSessionId: j.session_id })
    } else if (type === 'tool_use') {
      const name = String(j.tool_name ?? 'tool')
      const callId = String(j.tool_id ?? `${name}-${Date.now()}`)
      const params = (j.parameters as Record<string, unknown>) ?? {}
      const category = classifyToolCategory(name)
      state.activeToolCalls.set(callId, { name, category })
      events.push({
        type: 'tool.start',
        callId,
        name,
        category,
        summary: summarizeToolInput(params),
        input: params
      })
    } else if (type === 'tool_result') {
      const isErr = j.status === 'error'
      const errObj = j.error as { message?: string } | undefined
      events.push({
        type: 'tool.result',
        callId: String(j.tool_id ?? ''),
        ok: !isErr,
        output: String(errObj?.message ?? j.output ?? '').slice(0, 2000)
      })
    } else if (type === 'error') {
      events.push({ type: 'error', message: String(j.message ?? 'Gemini CLI error') })
    } else if (type === 'result') {
      const isErr = j.status === 'error'
      const errObj = j.error as { message?: string } | undefined
      const stats = j.stats as { duration_ms?: number; input_tokens?: number; output_tokens?: number } | undefined
      events.push({
        type: 'turn.complete',
        durationMs: stats?.duration_ms ?? 0,
        inputTokens: stats?.input_tokens,
        outputTokens: stats?.output_tokens,
        isError: isErr,
        errorHint: errObj?.message
      })
    }

    return events
  }

  flush(state: AdapterStreamState): NormalizedAgentEvent[] {
    if (!state.buffer) return []
    const text = state.buffer
    state.buffer = ''
    return [{ type: 'text.delta', text }]
  }

  formatProcessError(exitCode: number, stderr: string): { message: string; hint?: string } {
    const clean = stderr.trim().split(/\r?\n/).slice(-10).join('\n')
    return {
      message: `Gemini CLI thoát mã ${exitCode}${clean ? `:\n${clean}` : ''}`
    }
  }
}
