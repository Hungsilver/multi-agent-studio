// E2E không cần API thật: dùng CLI giả (core.js) để kiểm thử chuyển AI tool, chạy song song, lỗi, reload...
// Chạy: npm run build && npm run e2e
// Kịch bản E2E chạy trong main process của Electron (AICT_E2E_SCRIPT).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const HERE = process.env.E2E_DIR
const OUT = process.env.E2E_OUT || HERE
const results = []
const consoleErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) })
  console.log(`[E2E] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + String(detail).slice(0, 400)}`)
}

export default async function ({ app, win }) {
  const wc = win.webContents
  wc.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Autofill|DevTools|Electron Security Warning/i.test(message)) consoleErrors.push(message.slice(0, 300))
  })
  wc.on('render-process-gone', (_e, d) => consoleErrors.push('render-process-gone ' + d.reason))
  const ex = (code) => wc.executeJavaScript(code, true)
  const waitFor = async (code, timeout = 15000, label = code) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try {
        if (await ex(code)) return true
      } catch {
        /* retry */
      }
      await sleep(120)
    }
    throw new Error('waitFor timeout: ' + label.slice(0, 160))
  }
  const shot = async (name) => {
    try {
      const img = await wc.capturePage()
      fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG())
    } catch (e) {
      console.log('[E2E] shot failed', e.message)
    }
  }

  let exitCode = 0
  try {
    win.show()
    win.setSize(1440, 900)
    await waitFor('Boolean(window.__aict) && Boolean(window.workspaceApi)', 30000, 'app ready')
    await waitFor('window.__aict.useSettingsStore.getState().loaded === true', 30000, 'settings loaded')

    // --- workspace git tạm ---
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'aict-e2e-ws-'))
    execFileSync('git', ['init', '-q'], { cwd: ws })
    fs.writeFileSync(path.join(ws, 'a.txt'), 'hello\n')
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: ws })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: ws })
    const wsJs = JSON.stringify(ws)
    const H = JSON.stringify(HERE.replace(/\\/g, '/'))

    await ex(`window.workspaceApi.updateSettings({ cliOverrides: {
      claude: ${H} + '/claude.js', codex: ${H} + '/codex.js', agy: ${H} + '/agy.js' }, autoCompactEnabled: false })`)
    await ex(`window.__aict.useSettingsStore.getState().init()`)

    const store = 'window.__aict.useAiStore'
    const getSess = (id) => ex(`(${store}.getState().sessions.find(s => s.id === ${JSON.stringify(id)}) || null)`)
    const getDetail = (id) => ex(`(${store}.getState().detailsBySessionId[${JSON.stringify(id)}] || null)`)
    const waitIdle = (id, timeout = 20000) =>
      waitFor(
        `(() => { const d = ${store}.getState().detailsBySessionId[${JSON.stringify(id)}]; if (!d) return false;
           const last = d.turns[d.turns.length-1]; return d.session.status !== 'running' && last && last.status !== 'running' })()`,
        timeout,
        'idle ' + id
      )
    const lastText = async (id) => {
      const d = await getDetail(id)
      const t = d.turns[d.turns.length - 1]
      return t.events.filter((e) => e.event.type === 'text.delta').map((e) => e.event.text).join('')
    }
    const send = (id, prompt, extra = {}) =>
      ex(`${store}.getState().sendPrompt(Object.assign({ sessionId: ${JSON.stringify(id)}, prompt: ${JSON.stringify(prompt)} }, ${JSON.stringify(extra)}))`)

    // ===== 1. Tạo phiên & chạy lượt đầu =====
    const A = await ex(`${store}.getState().createSession({ workspacePath: ${wsJs}, provider: 'claude', permissionMode: 'edit' })`)
    await waitFor(`${store}.getState().activeSessionId === ${JSON.stringify(A.id)}`, 8000, 'active = A')
    await send(A.id, 'hello one')
    await waitIdle(A.id)
    let txt = await lastText(A.id)
    check('claude lượt 1 có phản hồi stream', /\[claude\] ack "hello one" handoff=false/.test(txt), txt)
    const sA1 = await getSess(A.id)
    check('tiêu đề tự đặt từ prompt đầu', sA1.title === 'hello one', sA1.title)

    // ===== 2. Chuyển claude -> codex giữ ngữ cảnh =====
    const unsynced = await ex(`${store}.getState().switchProvider(${JSON.stringify(A.id)}, 'codex')`)
    check('switchProvider báo 1 lượt chưa đồng bộ', unsynced === 1, unsynced)
    await send(A.id, 'hello two')
    await waitIdle(A.id)
    txt = await lastText(A.id)
    check('codex nhận handoff chứa lượt #1 (claude)', /handoff=true/.test(txt) && /T1@claude/.test(txt), txt)
    let d = await getDetail(A.id)
    check('có sự kiện handoff claude->codex', d.turns[1].events.some((e) => e.event.type === 'handoff' && e.event.fromProvider === 'claude' && e.event.toProvider === 'codex'))

    // ===== 3. Quay lại claude: resume session cũ + chỉ nhận lượt codex =====
    await ex(`${store}.getState().switchProvider(${JSON.stringify(A.id)}, 'claude')`)
    await send(A.id, 'hello three')
    await waitIdle(A.id)
    txt = await lastText(A.id)
    check('claude quay lại: resume=true', /resume=true/.test(txt), txt)
    check('claude quay lại: chỉ nhận lượt #2 (codex) chưa đồng bộ', /T2@codex/.test(txt) && !/T1@/.test(txt), txt)

    // ===== 4. agy cũng nhận đủ lịch sử còn thiếu =====
    await ex(`${store}.getState().switchProvider(${JSON.stringify(A.id)}, 'agy')`)
    await send(A.id, 'hello four')
    await waitIdle(A.id)
    txt = await lastText(A.id)
    check('agy lần đầu nhận lượt #1..#3', /T1@/.test(txt) && /T2@/.test(txt) && /T3@/.test(txt), txt)

    // ===== 5. Store khớp DB sau stream (không trùng/mất event) =====
    const dbDetail = await ex(`window.workspaceApi.getSessionDetail(${JSON.stringify(A.id)})`)
    const storeDetail = await getDetail(A.id)
    const cnt = (x) => x.turns.map((t) => t.events.length).join(',')
    check('số event store == DB', cnt(dbDetail) === cnt(storeDetail), `db=${cnt(dbDetail)} store=${cnt(storeDetail)}`)

    // ===== 6. Nhiều phiên chạy song song cùng project =====
    const B = await ex(`${store}.getState().createSession({ workspacePath: ${wsJs}, provider: 'codex', permissionMode: 'edit' }, { openInSplitPane: true })`)
    const C = await ex(`${store}.getState().createSession({ workspacePath: ${wsJs}, provider: 'agy', permissionMode: 'edit' }, { openInSplitPane: true })`)
    await Promise.all([send(A.id, 'SLOW par-A'), send(B.id, 'SLOW par-B'), send(C.id, 'SLOW par-C')])
    await sleep(300)
    const running = await ex(`${store}.getState().sessions.filter(s => s.status === 'running').length`)
    check('3 phiên chạy đồng thời', running === 3, running)

    // gửi trùng khi đang chạy phải bị từ chối
    let dupErr = ''
    try {
      await send(B.id, 'dup send')
    } catch (e) {
      dupErr = String(e.message || e)
    }
    check('gửi trùng khi đang chạy bị từ chối', /đang xử lý|Phiên này/.test(dupErr), dupErr)
    let swErr = ''
    try {
      await ex(`${store}.getState().switchProvider(${JSON.stringify(B.id)}, 'claude')`)
    } catch (e) {
      swErr = String(e.message || e)
    }
    check('đổi tool khi đang chạy bị từ chối', /dừng/.test(swErr), swErr)

    await shot('parallel-running')
    await Promise.all([waitIdle(A.id), waitIdle(B.id), waitIdle(C.id)])
    for (const [id, tag, prov] of [[A.id, 'par-A', 'agy'], [B.id, 'par-B', 'codex'], [C.id, 'par-C', 'agy']]) {
      const t = await lastText(id)
      check(`phiên ${tag} nhận đúng phản hồi của riêng nó`, t.includes(`ack "SLOW ${tag}"`) && t.startsWith(`[${prov}]`), t)
    }
    const calls = fs.readFileSync(path.join(OUT, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const par = calls.filter((c) => /SLOW par-/.test(c.prompt))
    const overlap = Math.max(...par.map((c) => c.t)) - Math.min(...par.map((c) => c.t))
    check('3 CLI được spawn gần như cùng lúc', overlap < 3000, overlap)

    // ===== 7. Lỗi CLI: không kẹt running =====
    await send(B.id, 'FAILNOW please')
    await waitFor(`${store}.getState().sessions.find(s => s.id === ${JSON.stringify(B.id)}).status === 'error'`, 15000, 'B error')
    d = await ex(`window.workspaceApi.getSessionDetail(${JSON.stringify(B.id)})`)
    const lastTurn = d.turns[d.turns.length - 1]
    check('lỗi CLI: lượt kết thúc status=error (DB)', lastTurn.status === 'error', lastTurn.status)
    check('lỗi CLI: session không còn running (DB)', d.session.status !== 'running', d.session.status)
    await send(B.id, 'after failure')
    await waitIdle(B.id)
    txt = await lastText(B.id)
    check('sau lỗi vẫn gửi tiếp được', /after failure/.test(txt), txt + ' || ' + JSON.stringify((await getDetail(B.id)).turns.map(t => [t.status, t.events.map(e => e.event.type).join('>')])))

    // ===== 8. Sidebar =====
    await ex(`window.__aict.useSettingsStore.getState().setActiveTab && window.__aict.useSettingsStore.getState().setActiveTab('ai')`)
    await sleep(500)
    const rows = await ex(`Array.from(document.querySelectorAll('[data-session-id]')).map(r => ({ id: r.dataset.sessionId, active: r.dataset.active, text: r.innerText.replace(/\\s+/g,' ').slice(0,80) }))`)
    check('sidebar hiển thị đủ 3 phiên', rows.length >= 3, JSON.stringify(rows))
    check('chỉ đúng 1 hàng active', rows.filter((r) => r.active === 'true').length === 1, JSON.stringify(rows))
    await ex(`document.querySelector('[data-session-id=${JSON.stringify(A.id)}]').click()`)
    await sleep(500)
    const activeAfter = await ex(`${store}.getState().activeSessionId`)
    check('click hàng sidebar chuyển phiên', activeAfter === A.id, activeAfter)
    await shot('sidebar')

    // ===== 9. Chuyển phiên nhanh liên tiếp: không nhảy ngược =====
    await ex(`(async () => { const s = ${store}.getState();
      s.selectSession(${JSON.stringify(B.id)}); s.selectSession(${JSON.stringify(C.id)}); await s.selectSession(${JSON.stringify(A.id)}) })()`)
    await sleep(800)
    const finalActive = await ex(`${store}.getState().activeSessionId`)
    check('chọn nhanh B,C,A → active cuối là A', finalActive === A.id, finalActive)

    // ===== 10. Fork & xóa =====
    const F = await ex(`${store}.getState().forkSession(${JSON.stringify(A.id)})`)
    await send(F.id, 'in fork')
    await waitIdle(F.id)
    txt = await lastText(F.id)
    check('fork nhận toàn bộ lịch sử cũ', /handoff=true/.test(txt) && /T1@/.test(txt), txt)
    await ex(`${store}.getState().deleteSession(${JSON.stringify(F.id)})`)
    const stillThere = await getSess(F.id)
    check('xóa phiên fork', stillThere === null)

    // ===== 10b. Giao diện thật: 1 khung, gõ vào composer và Enter =====
    await ex(`(async () => { while (${store}.getState().paneSessionIds.length > 1) { await ${store}.getState().closeSplitPane(${store}.getState().paneSessionIds.length - 1) } })()`)
    await ex(`${store}.getState().selectSession(${JSON.stringify(B.id)})`)
    await waitFor(`${store}.getState().activeSessionId === ${JSON.stringify(B.id)} && document.querySelectorAll('textarea').length === 1`, 8000, 'single pane B')
    const turnsBeforeUi = (await getDetail(B.id)).turns.length
    await ex(`(() => { const ta = document.querySelector('textarea');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, 'ui typed msg'); ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })()`)
    await waitFor(`${store}.getState().detailsBySessionId[${JSON.stringify(B.id)}].turns.length === ${turnsBeforeUi + 1}`, 6000, 'UI send created a turn')
    await waitIdle(B.id)
    txt = await lastText(B.id)
    check('gửi qua composer (UI) hoạt động', /ui typed msg/.test(txt), txt)

    // ===== 10c. Đổi provider qua menu UI =====
    await ex(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /Đổi AI Tool|Đang dùng/.test(x.title || '')); b.click() })()`)
    await waitFor(`Boolean(document.querySelector('[role=menu][aria-label="Chọn AI Tool"]'))`, 4000, 'provider menu')
    await ex(`(() => { const m = document.querySelector('[role=menu][aria-label="Chọn AI Tool"]');
      Array.from(m.querySelectorAll('button')).find(x => /Claude Code/.test(x.innerText)).click() })()`)
    await waitFor(`${store}.getState().sessions.find(s => s.id === ${JSON.stringify(B.id)}).provider === 'claude'`, 5000, 'B -> claude via UI')
    check('đổi provider qua menu UI', true)
    await send(B.id, 'after ui switch')
    await waitIdle(B.id)
    txt = await lastText(B.id)
    check('sau đổi qua UI: claude nhận handoff từ codex', /\[claude\]/.test(txt) && /handoff=true/.test(txt) && /T\d+@codex/.test(txt), txt)

    // ===== 10d. Đổi tên + xóa từ sidebar =====
    await ex(`(() => { const row = document.querySelector('[data-session-id=${JSON.stringify(C.id)}]');
      const span = row.querySelector('span.truncate'); span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })()`)
    await waitFor(`Boolean(document.querySelector('[data-session-id=${JSON.stringify(C.id)}] input'))`, 3000, 'rename input')
    await ex(`(() => { const inp = document.querySelector('[data-session-id=${JSON.stringify(C.id)}] input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, 'Tên mới C'); inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })()`)
    await waitFor(`${store}.getState().sessions.find(s => s.id === ${JSON.stringify(C.id)}).title === 'Tên mới C'`, 4000, 'renamed')
    check('đổi tên phiên từ sidebar', true)
    await ex(`document.querySelector('[data-session-id=${JSON.stringify(C.id)}] button[title="Xóa phiên"]').click()`)
    await waitFor(`!${store}.getState().sessions.some(s => s.id === ${JSON.stringify(C.id)})`, 4000, 'deleted C')
    check('xóa phiên từ sidebar', true)
    await shot('after-ui')

    // ===== 10e. Tải lại cửa sổ giữa lúc đang chạy =====
    await send(A.id, 'SLOW reload-me')
    await sleep(350)
    await wc.reload()
    await waitFor('Boolean(window.__aict) && window.__aict.useSettingsStore.getState().loaded === true', 30000, 'after reload')
    await waitFor(`${store}.getState().sessions.length > 0`, 10000, 'sessions after reload')
    await ex(`${store}.getState().selectSession(${JSON.stringify(A.id)})`)
    await waitIdle(A.id, 20000)
    txt = await lastText(A.id)
    check('reload giữa chừng: lượt vẫn hoàn tất và hiển thị đủ', /reload-me/.test(txt) && txt.length > 40, txt)
    const dbAfter = await ex(`window.workspaceApi.getSessionDetail(${JSON.stringify(A.id)})`)
    const stAfter = await getDetail(A.id)
    check('reload giữa chừng: store == DB', cnt(dbAfter) === cnt(stAfter), `db=${cnt(dbAfter)} store=${cnt(stAfter)}`)

    // ===== 10f. Giao diện nhận lỗi khi mở VS Code thất bại (đường dẫn không tồn tại) =====
    await ex(`window.workspaceApi.openInVsCode('C:/khong/ton/tai/aict-e2e').then(() => 'ok', (e) => String(e.message))`).then((r) => {
      check('openInVsCode báo lỗi khi đường dẫn sai', /không hợp lệ hoặc không tồn tại/.test(r), r)
    })

    // ===== 10g. Xóa worktree: Git từ chối khi còn file untracked, thư mục được giữ =====
    const wt = await ex(`window.workspaceApi.listWorktrees(${wsJs})`)
    check('listWorktrees có repo chính', wt.length >= 1)
    const msg = await ex(`window.workspaceApi.removeWorktree(${wsJs}, ${wsJs} + '/khong-phai-worktree', false, false).then(() => 'ok', (e) => String(e.message))`)
    check('removeWorktree từ chối đường dẫn không đăng ký', /không phải Worktree/.test(msg), msg)

    // ===== 11. Lỗi render console =====
    check('không có lỗi console renderer', consoleErrors.length === 0, consoleErrors.join(' | '))
  } catch (err) {
    check('script không ném lỗi', false, err && err.stack ? err.stack : err)
    exitCode = 1
    await shot('failure')
  }

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2))
  const failed = results.filter((r) => !r.ok).length
  console.log(`[E2E] DONE ${results.length - failed}/${results.length} passed`)
  setTimeout(() => app.exit(failed || exitCode ? 1 : 0), 500)
}
