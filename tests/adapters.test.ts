import { describe, expect, it } from 'vitest'
import { AgyAdapter } from '../src/main/ai/adapters/agy-adapter'
import { createAdapterStreamState } from '../src/main/ai/adapters/base'
import { ClaudeCodeAdapter } from '../src/main/ai/adapters/claude-adapter'
import { CodexAdapter } from '../src/main/ai/adapters/codex-adapter'
import { GeminiCliAdapter } from '../src/main/ai/adapters/gemini-adapter'

describe('AI Provider Adapters', () => {
  it('ClaudeCodeAdapter parses init, text, tool_use, tool_result, and result', () => {
    const adapter = new ClaudeCodeAdapter()
    const state = createAdapterStreamState()

    const ev1 = adapter.parseLine('{"type":"system","subtype":"init","session_id":"cl-123","model":"sonnet"}', state)
    expect(ev1[0]).toMatchObject({ type: 'session.init', providerSessionId: 'cl-123' })

    const ev2 = adapter.parseLine(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Đang đọc file"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"src/index.ts"}}]}}',
      state
    )
    expect(ev2).toHaveLength(2)
    expect(ev2[0]).toEqual({ type: 'text.delta', text: 'Đang đọc file' })
    expect(ev2[1]).toMatchObject({ type: 'tool.start', callId: 't1', category: 'read', summary: 'src/index.ts' })

    const ev3 = adapter.parseLine(
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":2400,"total_cost_usd":0.012,"usage":{"input_tokens":100,"cache_creation_input_tokens":200,"cache_read_input_tokens":300,"output_tokens":50}}',
      state
    )
    expect(ev3[0]).toMatchObject({
      type: 'turn.complete',
      durationMs: 2400,
      inputTokens: 600,
      cacheReadTokens: 300,
      outputTokens: 50,
      costUsd: 0.012,
      isError: false
    })
  })

  it('CodexAdapter preserves default config model when model is empty, filters notices, and parses JSONL', () => {
    const adapter = new CodexAdapter()
    const cmd = adapter.buildHeadlessCommand({
      mode: 'edit',
      model: '',
      effort: 'medium',
      providerSessionId: null,
      prompt: 'Fix bug',
      imagePaths: ['C:\\tmp\\shot.png'],
      extraDirs: [],
      claudeAuthMode: 'env'
    })
    expect(cmd.args).not.toContain('-m')
    expect(cmd.args).toContain('-i')
    expect(cmd.args).toContain('C:\\tmp\\shot.png')
    expect(cmd.args[cmd.args.length - 1]).toBe('-')

    const state = createAdapterStreamState()
    const e1 = adapter.parseLine('{"type":"thread.started","thread_id":"th-99"}', state)
    expect(e1[0]).toEqual({ type: 'session.init', providerSessionId: 'th-99' })

    const eNotice = adapter.parseLine(
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Configured service tier `priority` is not advertised as supported for model `gpt-6-luna` and will be omitted from requests."}}',
      state
    )
    expect(eNotice[0].type).toBe('thinking.delta')

    const e2 = adapter.parseLine('{"type":"item.completed","item":{"type":"agent_message","text":"Đã sửa xong"}}', state)
    expect(e2[0]).toEqual({ type: 'text.delta', text: 'Đã sửa xong' })

    const e3 = adapter.parseLine('{"type":"turn.completed","usage":{"input_tokens":500,"output_tokens":120}}', state)
    expect(e3[0]).toMatchObject({ type: 'turn.complete', inputTokens: 500, outputTokens: 120, isError: false })
  })

  it('AgyAdapter avoids duplicate output when short response emits DONE step_update followed by result', () => {
    const adapter = new AgyAdapter()
    const state = createAdapterStreamState()

    adapter.parseLine('{"event":"init","conversation_id":"conv-short","init":{"model":"gemini-3.8-flash-low"}}', state)
    const eDone = adapter.parseLine(
      '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"PONG\\n"}}',
      state
    )
    expect(eDone).toEqual([{ type: 'text.delta', text: 'PONG\n' }])

    const eRes = adapter.parseLine(
      '{"event":"result","result":{"conversation_id":"conv-short","status":"SUCCESS","response":"PONG\\n","duration_seconds":1.2,"usage":{"input_tokens":100,"output_tokens":2}}}',
      state
    )
    // Must not emit a second text.delta for "PONG\n"
    expect(eRes.filter((e) => e.type === 'text.delta')).toHaveLength(0)
    expect(eRes.find((e) => e.type === 'turn.complete')).toMatchObject({ durationMs: 1200, isError: false })
  })

  it('AgyAdapter builds stream-json command, skips conflicting --effort on suffixed models, and parses events', () => {
    const adapter = new AgyAdapter()
    const cmd = adapter.buildHeadlessCommand({
      mode: 'plan',
      model: 'gemini-4-neon-high',
      effort: 'high',
      providerSessionId: 'conv-1',
      prompt: 'Lập kế hoạch',
      imagePaths: [],
      extraDirs: [],
      claudeAuthMode: 'env'
    })
    expect(cmd.args).toContain('--input-format')
    expect(cmd.args).toContain('--output-format')
    expect(cmd.args).toContain('plan')
    expect(cmd.args).toContain('conv-1')
    expect(cmd.args).not.toContain('--effort')
    expect(JSON.parse(cmd.stdinData)).toEqual({ event: 'user', message: { content: 'Lập kế hoạch' } })

    const cmdUnsuffixed = adapter.buildHeadlessCommand({
      mode: 'edit',
      model: 'gemini-pro-orchestrator',
      effort: 'high',
      providerSessionId: null,
      prompt: 'Run',
      imagePaths: [],
      extraDirs: [],
      claudeAuthMode: 'env'
    })
    expect(cmdUnsuffixed.args).toContain('--effort')
    expect(cmdUnsuffixed.args).toContain('high')

    const state = createAdapterStreamState()
    const eInit = adapter.parseLine('{"event":"init","conversation_id":"conv-2","init":{"model":"gemini-4-neon-high"}}', state)
    expect(eInit[0]).toMatchObject({ type: 'session.init', providerSessionId: 'conv-2' })

    const eDelta = adapter.parseLine('{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Xin chào "}}', state)
    expect(eDelta[0]).toEqual({ type: 'text.delta', text: 'Xin chào ' })

    // Final DONE with text_delta should not duplicate after ACTIVE deltas
    const eDone = adapter.parseLine('{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"Xin chào "}}', state)
    expect(eDone).toHaveLength(0)

    const eTool = adapter.parseLine('{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"npm test"},"output":"PASS"}}}', state)
    expect(eTool[0]).toMatchObject({ type: 'tool.start', name: 'run_command', category: 'bash', summary: 'npm test' })
    expect(eTool[1]).toMatchObject({ type: 'tool.result', ok: true, output: 'PASS' })

    const eRes = adapter.parseLine('{"event":"result","result":{"conversation_id":"conv-2","status":"SUCCESS","duration_seconds":2.5,"usage":{"input_tokens":200,"output_tokens":80}}}', state)
    expect(eRes[1]).toMatchObject({ type: 'turn.complete', durationMs: 2500, inputTokens: 200, outputTokens: 80, isError: false })
  })

  it('GeminiCliAdapter buffers delta text until flush', () => {
    const adapter = new GeminiCliAdapter()
    const state = createAdapterStreamState()
    expect(adapter.parseLine('{"type":"message","role":"assistant","content":"Hello ","delta":true}', state)).toHaveLength(0)
    const flushed = adapter.parseLine('{"type":"message","role":"assistant","content":"World","delta":false}', state)
    expect(flushed).toEqual([{ type: 'text.delta', text: 'Hello World' }])
  })
})
