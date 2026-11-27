import type { NormalizedAgentEvent } from '@shared/types/ai'
import type {
  AdapterBuildCommandInput,
  AdapterCommandSpec,
  AdapterStreamState,
  IAiProviderAdapter
} from './base'

function extractCodexErrorText(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string }
      if (parsed.error?.message) return parsed.error.message
      if (parsed.message) return parsed.message
    } catch {
      // ignore
    }
  }
  return trimmed
}

export class CodexAdapter implements IAiProviderAdapter {
  readonly provider = 'codex' as const

  buildHeadlessCommand(input: AdapterBuildCommandInput): AdapterCommandSpec {
    const args: string[] = ['exec']
    if (input.workDir) {
      args.push('-C', input.workDir)
    }
    if (input.mode === 'plan') {
      args.push('--sandbox', 'read-only')
    } else if (input.mode === 'edit') {
      args.push('--sandbox', 'workspace-write')
    } else {
      args.push('--dangerously-bypass-approvals-and-sandbox')
    }
    args.push('--skip-git-repo-check', '--json')

    if (input.providerSessionId) {
      args.push('resume', input.providerSessionId)
    }

    // Chỉ truyền -m khi người dùng chọn model cụ thể; để trống = tôn trọng model trong ~/.codex/config.toml (vd gpt-6.2-sol)
    if (input.model.trim()) {
      args.push('-m', input.model.trim())
    }

    for (const img of input.imagePaths) {
      args.push('-i', img)
    }

    if (!input.providerSessionId) {
      for (const dir of input.extraDirs) {
        args.push('--add-dir', dir)
      }
    }

    args.push('-')

    return {
      args,
      stdinData: input.prompt,
      unsetEnv: []
    }
  }

  buildInteractiveArgs(sessionId: string | null, model: string): string[] {
    const args: string[] = []
    if (model.trim()) args.push('-m', model.trim())
    if (sessionId) args.push('resume', sessionId)
    return args
  }

  parseLine(line: string, _state: AdapterStreamState): NormalizedAgentEvent[] {
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

    // Legacy codex JSON format
    if (j.msg && typeof j.msg === 'object') {
      const m = j.msg as Record<string, unknown>
      if (m.type === 'agent_message' && typeof m.message === 'string') {
        return [{ type: 'text.delta', text: m.message }]
      }
      if (m.type === 'exec_command_begin') {
        const cmd = Array.isArray(m.command) ? m.command.join(' ') : String(m.command ?? '')
        return [
          {
            type: 'tool.start',
            callId: `codex-cmd-${Date.now()}`,
            name: 'Chạy lệnh',
            category: 'bash',
            summary: cmd.slice(0, 140),
            input: { command: cmd }
          }
        ]
      }
      if (m.type === 'error') {
        return [{ type: 'error', message: extractCodexErrorText(String(m.message ?? 'Codex error')) }]
      }
      return []
    }

    const type = String(j.type ?? '')
    const events: NormalizedAgentEvent[] = []

    if (type === 'thread.started' && typeof j.thread_id === 'string') {
      events.push({ type: 'session.init', providerSessionId: j.thread_id })
      return events
    }

    if (type === 'item.started' && j.item && typeof j.item === 'object') {
      const it = j.item as Record<string, unknown>
      if (it.type === 'command_execution') {
        const cmd = String(it.command ?? '')
        const callId = String(it.id ?? `cmd-${Date.now()}`)
        events.push({
          type: 'tool.start',
          callId,
          name: 'Chạy lệnh',
          category: 'bash',
          summary: cmd.slice(0, 140),
          input: { command: cmd }
        })
      }
      return events
    }

    if (type === 'item.completed' && j.item && typeof j.item === 'object') {
      const it = j.item as Record<string, unknown>
      const itemType = String(it.type ?? '')
      if (itemType === 'agent_message' && typeof it.text === 'string') {
        events.push({ type: 'text.delta', text: it.text })
      } else if (itemType === 'reasoning' && typeof it.text === 'string') {
        events.push({ type: 'thinking.delta', text: it.text })
      } else if (itemType === 'command_execution') {
        const exitCode = typeof it.exit_code === 'number' ? it.exit_code : 0
        const callId = String(it.id ?? '')
        events.push({
          type: 'tool.result',
          callId,
          ok: exitCode === 0,
          output: String(it.aggregated_output ?? '').slice(0, 2000)
        })
      } else if (itemType === 'file_change') {
        const changes = Array.isArray(it.changes) ? (it.changes as Array<{ kind?: string; path?: string }>) : []
        const summary = changes.map((c) => `${c.kind ?? 'edit'} ${c.path ?? ''}`).join(', ')
        const callId = String(it.id ?? `file-${Date.now()}`)
        events.push({
          type: 'tool.start',
          callId,
          name: 'Sửa file',
          category: 'edit',
          summary: summary.slice(0, 140),
          input: { changes }
        })
        events.push({ type: 'tool.result', callId, ok: true, output: summary })
      } else if (itemType === 'mcp_tool_call') {
        const server = String(it.server ?? 'mcp')
        const tool = String(it.tool ?? 'call')
        events.push({
          type: 'tool.start',
          callId: String(it.id ?? `mcp-${Date.now()}`),
          name: `${server} · ${tool}`,
          category: 'mcp',
          summary: '',
          input: (it.arguments as Record<string, unknown>) ?? {}
        })
      } else if (itemType === 'web_search') {
        events.push({
          type: 'tool.start',
          callId: String(it.id ?? `web-${Date.now()}`),
          name: 'Tìm web',
          category: 'search',
          summary: String(it.query ?? ''),
          input: { query: it.query }
        })
      } else if (itemType === 'error') {
        const msg = extractCodexErrorText(String(it.message ?? ''))
        // Codex phát item.type="error" cho các thông báo không nghiêm trọng (vd priority tier không được hỗ trợ)
        if (/will be omitted from requests|defaulting to fallback metadata/i.test(msg)) {
          events.push({ type: 'thinking.delta', text: `[Codex notice] ${msg}\n` })
        } else {
          events.push({ type: 'error', message: msg })
        }
      }
      return events
    }

    if (type === 'turn.completed') {
      const u = j.usage as Record<string, unknown> | undefined
      events.push({
        type: 'turn.complete',
        durationMs: 0,
        inputTokens: typeof u?.input_tokens === 'number' ? u.input_tokens : undefined,
        outputTokens: typeof u?.output_tokens === 'number' ? u.output_tokens : undefined,
        cacheReadTokens: typeof u?.cached_input_tokens === 'number' ? u.cached_input_tokens : undefined,
        isError: false
      })
      return events
    }

    if (type === 'turn.failed') {
      const errObj = j.error as { message?: string } | undefined
      const msg = extractCodexErrorText(String(errObj?.message ?? 'Codex turn failed'))
      events.push({ type: 'error', message: msg })
      events.push({ type: 'turn.complete', durationMs: 0, isError: true, errorHint: msg })
      return events
    }

    if (type === 'error') {
      events.push({ type: 'error', message: extractCodexErrorText(String(j.message ?? 'Codex error')) })
    }

    return events
  }

  flush(): NormalizedAgentEvent[] {
    return []
  }

  formatProcessError(exitCode: number, stderr: string): { message: string; hint?: string } {
    const clean = stderr.trim().split(/\r?\n/).slice(-12).join('\n')
    let hint: string | undefined
    if (/models? cache|base_instructions/i.test(stderr)) {
      hint = 'Cache model Codex không tương thích. Hãy cập nhật @openai/codex trong Cài đặt.'
    } else if (/model.*not supported|unsupported.*model/i.test(stderr)) {
      hint = 'Model đã chọn không được tài khoản ChatGPT/API này hỗ trợ — hãy chọn "Mặc định của CLI" hoặc model khác.'
    } else if (/log ?in|auth|401|credential/i.test(stderr)) {
      hint = 'Codex chưa đăng nhập — mở Terminal nhúng và chạy `codex login`.'
    }
    return {
      message: `Codex thoát mã ${exitCode}${clean ? `:\n${clean}` : ''}`,
      hint
    }
  }
}
