import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NormalizedAgentEvent } from '@shared/types/ai'
import {
  classifyToolCategory,
  summarizeToolInput,
  type AdapterBuildCommandInput,
  type AdapterCommandSpec,
  type AdapterStreamState,
  type IAiProviderAdapter
} from './base'

const CLAUDE_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']

export function isClaudeEnvKeyRejected(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY || ''
  if (apiKey.length < 20) return false
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')
    const parsed = JSON.parse(raw) as {
      customApiKeyResponses?: { rejected?: string[] }
    }
    const suffix = apiKey.slice(-20)
    return Boolean(parsed.customApiKeyResponses?.rejected?.includes(suffix))
  } catch {
    return false
  }
}

export class ClaudeCodeAdapter implements IAiProviderAdapter {
  readonly provider = 'claude' as const

  buildHeadlessCommand(input: AdapterBuildCommandInput): AdapterCommandSpec {
    const perm = {
      plan: 'plan',
      edit: 'acceptEdits',
      full: 'bypassPermissions'
    }[input.mode]

    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', perm]
    if (input.model) args.push('--model', input.model)
    if (input.providerSessionId) args.push('--resume', input.providerSessionId)
    for (const dir of input.extraDirs) {
      args.push('--add-dir', dir)
    }

    const unsetEnv =
      input.claudeAuthMode === 'account'
        ? [...CLAUDE_ENV_VARS]
        : isClaudeEnvKeyRejected()
          ? ['ANTHROPIC_API_KEY']
          : []

    return {
      args,
      stdinData: input.prompt,
      unsetEnv
    }
  }

  buildInteractiveArgs(sessionId: string | null, model: string): string[] {
    const args: string[] = []
    if (model) args.push('--model', model)
    if (sessionId) args.push('--resume', sessionId)
    return args
  }

  parseLine(line: string, state: AdapterStreamState): NormalizedAgentEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    if (!trimmed.startsWith('{')) {
      return [{ type: 'text.delta', text: `${trimmed}\n` }]
    }

    let j: Record<string, unknown>
    try {
      j = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return []
    }

    const events: NormalizedAgentEvent[] = []
    const type = String(j.type ?? '')

    if (type === 'system' && j.subtype === 'init' && typeof j.session_id === 'string') {
      events.push({
        type: 'session.init',
        providerSessionId: j.session_id,
        model: typeof j.model === 'string' ? j.model : undefined,
        tools: Array.isArray(j.tools) ? (j.tools as string[]) : undefined
      })
      return events
    }

    if (type === 'assistant') {
      const msg = j.message as { content?: Array<Record<string, unknown>> } | undefined
      for (const c of msg?.content ?? []) {
        if (c.type === 'thinking' && typeof c.thinking === 'string') {
          events.push({ type: 'thinking.delta', text: c.thinking })
        } else if (c.type === 'text' && typeof c.text === 'string') {
          events.push({ type: 'text.delta', text: c.text })
        } else if (c.type === 'tool_use') {
          const name = String(c.name ?? 'tool')
          const callId = String(c.id ?? `${name}-${Date.now()}`)
          const inputObj = (c.input as Record<string, unknown>) ?? {}
          const category = classifyToolCategory(name)
          state.activeToolCalls.set(callId, { name, category })
          events.push({
            type: 'tool.start',
            callId,
            name,
            category,
            summary: summarizeToolInput(inputObj),
            input: inputObj
          })
        }
      }
      return events
    }

    if (type === 'user') {
      const msg = j.message as { content?: Array<Record<string, unknown>> } | undefined
      for (const c of msg?.content ?? []) {
        if (c.type === 'tool_result') {
          const callId = String(c.tool_use_id ?? '')
          const isError = Boolean(c.is_error)
          const rawOut =
            typeof c.content === 'string'
              ? c.content
              : Array.isArray(c.content)
                ? (c.content as Array<{ text?: string }>).map((x) => x.text ?? '').join('\n')
                : ''
          events.push({
            type: 'tool.result',
            callId,
            ok: !isError,
            output: rawOut.slice(0, 2000)
          })
        }
      }
      return events
    }

    if (type === 'result') {
      if (typeof j.session_id === 'string') {
        events.push({ type: 'session.init', providerSessionId: j.session_id })
      }
      const isError = Boolean(j.is_error) || (j.subtype !== undefined && j.subtype !== 'success')
      const usage = j.usage as Record<string, unknown> | undefined
      const denials = Array.isArray(j.permission_denials) ? j.permission_denials.filter(Boolean).length : 0
      const resultText = typeof j.result === 'string' ? j.result : ''
      const hint = isError ? detectClaudeErrorHint(resultText) : undefined
      const inputTok = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0
      const cacheCreateTok = typeof usage?.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
      const cacheReadTok = typeof usage?.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
      const totalInputTokens = inputTok + cacheCreateTok + cacheReadTok
      events.push({
        type: 'turn.complete',
        durationMs: typeof j.duration_ms === 'number' ? j.duration_ms : 0,
        inputTokens: totalInputTokens > 0 ? totalInputTokens : undefined,
        outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined,
        cacheReadTokens: cacheReadTok > 0 ? cacheReadTok : undefined,
        costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined,
        isError,
        errorHint: hint ?? (isError && resultText ? resultText : undefined),
        permissionDenials: denials
      })
    }

    return events
  }

  flush(): NormalizedAgentEvent[] {
    return []
  }

  formatProcessError(exitCode: number, stderr: string): { message: string; hint?: string } {
    const clean = stderr.trim().split(/\r?\n/).slice(-10).join('\n')
    const hint = detectClaudeErrorHint(clean)
    return {
      message: `Claude Code thoát mã ${exitCode}${clean ? `:\n${clean}` : ''}`,
      hint
    }
  }
}

export function detectClaudeErrorHint(text: string): string | undefined {
  if (/Invalid API key|Fix external API key/i.test(text)) {
    return 'ANTHROPIC_API_KEY trong biến môi trường đang bị từ chối. Bạn có thể chuyển sang "Dùng tài khoản /login" trong Cài đặt.'
  }
  if (/OAuth session expired|Not logged in|Please run \/login/i.test(text)) {
    return 'Phiên đăng nhập Claude Code đã hết hạn. Bấm nút Terminal để mở interactive CLI rồi chạy /login.'
  }
  if (/issue with the selected model|model.*may not exist/i.test(text)) {
    return 'Model đã chọn không khả dụng trên tài khoản hiện tại — hãy đổi model khác.'
  }
  return undefined
}
