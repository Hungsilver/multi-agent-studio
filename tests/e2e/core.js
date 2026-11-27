// CLI giả lập cho kiểm thử E2E: ghi lại mọi lần gọi và phát stream đúng định dạng từng provider.
const fs = require('fs')
const path = require('path')

module.exports = function run(provider) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => (input += d))
  process.stdin.on('end', async () => {
    const args = process.argv.slice(2)
    let prompt = input
    if (provider === 'agy') {
      try {
        prompt = JSON.parse(input.split('\n')[0]).message.content
      } catch {
        /* keep raw */
      }
    }
    const flagIdx = (f) => args.indexOf(f)
    let resumeId = ''
    if (provider === 'claude' && flagIdx('--resume') >= 0) resumeId = args[flagIdx('--resume') + 1]
    if (provider === 'codex' && flagIdx('resume') >= 0) resumeId = args[flagIdx('resume') + 1]
    if (provider === 'agy' && flagIdx('--conversation') >= 0) resumeId = args[flagIdx('--conversation') + 1]

    const logFile = process.env.FAKE_CLI_LOG || path.join(__dirname, 'calls.jsonl')
    fs.appendFileSync(
      logFile,
      JSON.stringify({ provider, args, prompt, resumeId, cwd: process.cwd(), t: Date.now() }) + '\n'
    )

    const lines = prompt.split(/\r?\n/).filter((l) => l.trim())
    const userLine = lines[lines.length - 1] || ''
    if (userLine.includes('FAILNOW')) {
      process.stderr.write('fake failure requested\n')
      process.exit(3)
    }
    const slow = /SLOW/.test(userLine)
    const handoff = prompt.includes('<session_context_handoff>')
    // Chỉ đếm tiêu đề lượt trong khối handoff (#### ...), và đổi dạng để phản hồi không bị đếm lại ở lượt sau
    const saw = (prompt.match(/#### Lượt #\d+ \(trên \w+\)/g) || [])
      .map((x) => x.replace(/#### Lượt #(\d+) \(trên (\w+)\)/, 'T$1@$2'))
      .join(';')
    const sessId = resumeId || `${provider}-sess-${Math.random().toString(36).slice(2, 8)}`
    const text = `[${provider}] ack "${userLine.slice(0, 60)}" handoff=${handoff} resume=${Boolean(resumeId)} saw=${saw}`
    const chunks = text.match(/.{1,24}/g) || [text]
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    if (provider === 'claude') out({ type: 'system', subtype: 'init', session_id: sessId, model: 'fake' })
    if (provider === 'codex') out({ type: 'thread.started', thread_id: sessId })
    if (provider === 'agy') out({ event: 'init', conversation_id: sessId, init: { model: 'fake' } })

    for (const c of chunks) {
      if (slow) await sleep(120)
      if (provider === 'claude') out({ type: 'assistant', message: { content: [{ type: 'text', text: c }] } })
      if (provider === 'codex') out({ type: 'item.completed', item: { type: 'agent_message', text: c } })
      if (provider === 'agy')
        out({ event: 'step_update', step_update: { step_type: 'agent_response', state: 'ACTIVE', text_delta: c } })
    }
    if (slow) await sleep(400)

    if (provider === 'claude')
      out({
        type: 'result',
        subtype: 'success',
        session_id: sessId,
        duration_ms: 5,
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.001
      })
    if (provider === 'codex') out({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } })
    if (provider === 'agy')
      out({
        event: 'result',
        result: { conversation_id: sessId, status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } }
      })
    process.exit(0)
  })
}
