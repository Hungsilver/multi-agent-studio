import type { NormalizedAgentEvent } from '@shared/types/ai'
import {
  classifyToolCategory,
  summarizeToolInput,
  type AdapterBuildCommandInput,
  type AdapterCommandSpec,
  type AdapterStreamState,
  type IAiProviderAdapter
} from './base'

export class AgyAdapter implements IAiProviderAdapter {
  readonly provider = 'agy' as const

  buildHeadlessCommand(input: AdapterBuildCommandInput): AdapterCommandSpec {
    const args: string[] = [
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json'
    ]

    if (input.mode === 'plan') {
      args.push('--mode', 'plan')
    } else if (input.mode === 'edit') {
      args.push('--mode', 'accept-edits')
    } else {
      args.push('--dangerously-skip-permissions')
    }

    if (input.model.trim()) {
      args.push('--model', input.model.trim())
    }
    // Các model có hậu tố effort (-low|-medium|-high|-xhigh|-max) sẽ xung đột nếu truyền thêm --effort
    const modelHasEffortSuffix = /-(low|medium|high|xhigh|max)$/i.test(input.model.trim())
    if (input.effort && !modelHasEffortSuffix) {
      args.push('--effort', input.effort)
    }
    if (input.providerSessionId) {
      args.push('--conversation', input.providerSessionId)
    }
    for (const dir of input.extraDirs) {
      args.push('--add-dir', dir)
    }

    const userEvent = JSON.stringify({
      event: 'user',
      message: {
        content: input.prompt
      }
    })

    return {
      args,
      stdinData: `${userEvent}\n`,
      unsetEnv: []
    }
  }

  buildInteractiveArgs(sessionId: string | null, model: string): string[] {
    const args: string[] = []
    if (model.trim()) args.push('--model', model.trim())
    if (sessionId) args.push('--conversation', sessionId)
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

    const ev = String(j.event ?? '')
    const events: NormalizedAgentEvent[] = []

    if (ev === 'init') {
      const convId = typeof j.conversation_id === 'string' ? j.conversation_id : ''
      const initObj = (j.init as Record<string, unknown>) ?? {}
      if (convId) {
        events.push({
          type: 'session.init',
          providerSessionId: convId,
          model: typeof initObj.model === 'string' ? initObj.model : undefined,
          tools: Array.isArray(initObj.tools) ? (initObj.tools as string[]) : undefined
        })
      }
      return events
    }

    if (ev === 'step_update' && j.step_update && typeof j.step_update === 'object') {
      const su = j.step_update as Record<string, unknown>
      const stepType = String(su.step_type ?? '')
      const stepState = String(su.state ?? '')

      if (stepType === 'agent_response' && typeof su.text_delta === 'string' && su.text_delta) {
        if (stepState === 'ACTIVE') {
          state.seenTextDelta = true
          events.push({ type: 'text.delta', text: su.text_delta })
        } else if (stepState === 'DONE' && !state.seenTextDelta) {
          // Đặt seenTextDelta = true để result event ở cuối không phát lặp lại nội dung ngắn
          state.seenTextDelta = true
          events.push({ type: 'text.delta', text: su.text_delta })
        }
        return events
      }

      if (stepType === 'thinking' && typeof su.text_delta === 'string' && su.text_delta) {
        events.push({ type: 'thinking.delta', text: su.text_delta })
        return events
      }

      if (stepType === 'tool') {
        const toolInfo = (su.tool_info as Record<string, unknown>) ?? {}
        const name = String(toolInfo.name ?? su.tool_name ?? 'tool')
        const stepIdx = String(su.step_index ?? '0')
        const callId = `agy-step-${stepIdx}-${name}`
        const params = (toolInfo.parameters as Record<string, unknown>) ?? {}

        if (!state.activeToolCalls.has(callId)) {
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
        }

        if (stepState === 'DONE') {
          const errObj = toolInfo.error as { message?: string } | undefined
          const output = errObj?.message
            ? errObj.message
            : typeof toolInfo.output === 'string'
              ? toolInfo.output
              : ''
          events.push({
            type: 'tool.result',
            callId,
            ok: !errObj,
            output: output.slice(0, 2000)
          })
        }

        const subInfo = su.subagent_info as { subagents?: Array<Record<string, unknown>> } | undefined
        if (subInfo?.subagents?.length && stepState === 'DONE') {
          for (const sub of subInfo.subagents) {
            events.push({
              type: 'tool.start',
              callId: `agy-sub-${String(sub.conversation_id ?? stepIdx)}`,
              name: `subagent · ${String(sub.role ?? sub.type_name ?? 'agent')}`,
              category: 'agent',
              summary: String(sub.type_name ?? ''),
              input: sub
            })
          }
        }
        return events
      }
      return events
    }

    if (ev === 'result' && j.result && typeof j.result === 'object') {
      const res = j.result as Record<string, unknown>
      if (typeof res.conversation_id === 'string' && res.conversation_id) {
        events.push({ type: 'session.init', providerSessionId: res.conversation_id })
      }
      const status = String(res.status ?? 'SUCCESS')
      const isError = status !== 'SUCCESS'
      const usage = res.usage as Record<string, unknown> | undefined
      const errMsg = typeof res.error === 'string' ? res.error : undefined
      if (!state.seenTextDelta && typeof res.response === 'string' && res.response) {
        events.push({ type: 'text.delta', text: res.response })
      }
      events.push({
        type: 'turn.complete',
        durationMs: typeof res.duration_seconds === 'number' ? Math.round(res.duration_seconds * 1000) : 0,
        inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined,
        outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined,
        cacheReadTokens: typeof usage?.cache_read_tokens === 'number' ? usage.cache_read_tokens : undefined,
        isError,
        errorHint: errMsg
      })
      state.seenTextDelta = false
    }

    return events
  }

  flush(): NormalizedAgentEvent[] {
    return []
  }

  formatProcessError(exitCode: number, stderr: string): { message: string; hint?: string } {
    const clean = stderr.trim().split(/\r?\n/).slice(-12).join('\n')
    let hint: string | undefined
    if (/authentication required|not logged in|authenticate/i.test(stderr)) {
      hint = 'Antigravity CLI chưa đăng nhập — mở Terminal nhúng chạy `agy` một lần để xác thực.'
    }
    return {
      message: `Antigravity CLI (agy) thoát mã ${exitCode}${clean ? `:\n${clean}` : ''}`,
      hint
    }
  }
}
