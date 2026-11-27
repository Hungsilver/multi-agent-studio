import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentOrchestrator } from '../src/main/ai/orchestrator'
import { resolveSessionWorkDir } from '../src/main/ai/session-workdir'
import { captureCheckpoint, restoreFileFromCheckpoint } from '../src/main/git/checkpoint-service'
import { runGit, runGitChecked } from '../src/main/git/git-runner'
import { createIsolatedWorktree, listWorktrees, removeWorktree } from '../src/main/git/worktree-service'
import { WorkspaceDatabase } from '../src/main/storage/database'
import { WorkspaceRepository } from '../src/main/storage/repositories'
import { findVsCodeLauncher, openInVsCode } from '../src/main/system/vscode-launcher'

const temps: string[] = []

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temps.push(d)
  return d
}

async function makeRepo(): Promise<string> {
  const dir = tmp('rf-repo-')
  await runGitChecked(dir, ['init'])
  await runGitChecked(dir, ['config', 'user.email', 't@example.com'])
  await runGitChecked(dir, ['config', 'user.name', 'T'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# r\n')
  await runGitChecked(dir, ['add', '-A'])
  await runGitChecked(dir, ['commit', '-m', 'init'])
  return dir
}

afterEach(() => {
  while (temps.length) {
    try {
      fs.rmSync(temps.pop()!, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
    } catch {
      // Windows temp lock
    }
  }
})

const sha = (p: string): string => createHash('sha1').update(fs.readFileSync(p)).digest('hex')

describe('P1.1 removeWorktree an toàn', () => {
  it('xóa được worktree sạch và nhánh đã merge', async () => {
    const repo = await makeRepo()
    const wt = await createIsolatedWorktree(repo, 'clean')
    await removeWorktree(repo, wt.worktreePath, true)
    expect(fs.existsSync(wt.worktreePath)).toBe(false)
    expect((await runGit(repo, ['rev-parse', '--verify', `refs/heads/${wt.branch}`])).code).not.toBe(0)
  })

  it('giữ nguyên thư mục + nhánh khi còn thay đổi chưa commit hoặc file untracked', async () => {
    const repo = await makeRepo()
    const wt = await createIsolatedWorktree(repo, 'dirty')
    fs.writeFileSync(path.join(wt.worktreePath, 'README.md'), 'sửa chưa commit\n')
    fs.writeFileSync(path.join(wt.worktreePath, 'new.txt'), 'untracked\n')
    await expect(removeWorktree(repo, wt.worktreePath, true)).rejects.toThrow(/untracked|modified|force/i)
    expect(fs.readFileSync(path.join(wt.worktreePath, 'new.txt'), 'utf8')).toBe('untracked\n')
    expect(fs.readFileSync(path.join(wt.worktreePath, 'README.md'), 'utf8')).toBe('sửa chưa commit\n')
    expect((await runGit(repo, ['rev-parse', '--verify', `refs/heads/${wt.branch}`])).code).toBe(0)
    // force chỉ khi người dùng đã xác nhận
    await removeWorktree(repo, wt.worktreePath, true, true)
    expect(fs.existsSync(wt.worktreePath)).toBe(false)
  })

  it('từ chối đường dẫn không phải worktree đã đăng ký và repo chính', async () => {
    const repo = await makeRepo()
    const other = tmp('not-wt-')
    fs.writeFileSync(path.join(other, 'keep.txt'), 'x')
    await expect(removeWorktree(repo, other, false, true)).rejects.toThrow(/không phải Worktree/i)
    expect(fs.existsSync(path.join(other, 'keep.txt'))).toBe(true)
    await expect(removeWorktree(repo, repo, false, true)).rejects.toThrow(/repository chính/i)
    expect((await listWorktrees(repo)).length).toBe(1)
  })

  it('không xóa nhánh chưa merge khi xóa thường (-d)', async () => {
    const repo = await makeRepo()
    const wt = await createIsolatedWorktree(repo, 'unmerged')
    fs.writeFileSync(path.join(wt.worktreePath, 'f.txt'), 'f')
    await runGitChecked(wt.worktreePath, ['add', '-A'])
    await runGitChecked(wt.worktreePath, ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-m', 'c'])
    await expect(removeWorktree(repo, wt.worktreePath, true)).rejects.toThrow(/giữ lại nhánh/)
    expect((await runGit(repo, ['rev-parse', '--verify', `refs/heads/${wt.branch}`])).code).toBe(0)
  })
})

describe('P1.2 restoreFileFromCheckpoint', () => {
  it('snapshot không đọc được → báo lỗi và giữ nguyên file hiện tại', async () => {
    const repo = await makeRepo()
    const f = path.join(repo, 'README.md')
    fs.writeFileSync(f, 'nội dung hiện tại\n')
    await expect(restoreFileFromCheckpoint(repo, 'a'.repeat(40), 'README.md')).rejects.toThrow(/checkpoint/i)
    expect(fs.readFileSync(f, 'utf8')).toBe('nội dung hiện tại\n')
  })

  it('file tạo sau checkpoint bị xóa; file nhị phân khôi phục đúng từng byte; index thật không đổi', async () => {
    const repo = await makeRepo()
    const bin = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x0d, 0x0a, 0x1a, 0x00, 0x7f])
    fs.writeFileSync(path.join(repo, 'blob.bin'), bin)
    const snap = await captureCheckpoint(repo)
    expect(snap.treeHash).toMatch(/^[0-9a-f]{40}$/)

    fs.writeFileSync(path.join(repo, 'blob.bin'), Buffer.from('hỏng'))
    fs.writeFileSync(path.join(repo, 'later.txt'), 'tạo sau checkpoint')

    const indexFile = path.join(repo, '.git', 'index')
    const indexBefore = sha(indexFile)
    const stagedBefore = await runGitChecked(repo, ['ls-files', '-s'])

    await restoreFileFromCheckpoint(repo, snap.treeHash!, 'blob.bin')
    expect(fs.readFileSync(path.join(repo, 'blob.bin')).equals(bin)).toBe(true)

    await restoreFileFromCheckpoint(repo, snap.treeHash!, 'later.txt')
    expect(fs.existsSync(path.join(repo, 'later.txt'))).toBe(false)

    expect(sha(indexFile)).toBe(indexBefore)
    expect(await runGitChecked(repo, ['ls-files', '-s'])).toBe(stagedBefore)
  })

  it('từ chối đường dẫn ngoài repo', async () => {
    const repo = await makeRepo()
    const snap = await captureCheckpoint(repo)
    await expect(restoreFileFromCheckpoint(repo, snap.treeHash!, '../outside.txt')).rejects.toThrow()
  })
})

function fakeSession(over: Partial<{ worktreePath: string | null; workspacePath: string }>) {
  return { worktreePath: null, workspacePath: 'C:/x', worktreeBranch: 'ai/x', ...over }
}

describe('P1.3 phiên mất worktree', () => {
  it('resolveSessionWorkDir báo lỗi thay vì lùi về repo gốc', () => {
    const root = tmp('wd-root-')
    expect(() => resolveSessionWorkDir(fakeSession({ worktreePath: path.join(root, 'gone'), workspacePath: root }))).toThrow(
      /Worktree của phiên không còn tồn tại/
    )
    expect(resolveSessionWorkDir(fakeSession({ worktreePath: null, workspacePath: root }))).toBe(root)
    expect(resolveSessionWorkDir(fakeSession({ worktreePath: root, workspacePath: 'C:/y' }))).toBe(root)
  })

  it('gửi prompt vào phiên mất worktree bị từ chối và repo gốc giữ nguyên', async () => {
    const repo = await makeRepo()
    const db = new WorkspaceDatabase(':memory:')
    await db.init()
    const r = new WorkspaceRepository(db)
    const ws = r.upsertWorkspace(repo)
    const fake = path.join(tmp('fake-cli-'), 'claude.js')
    fs.writeFileSync(fake, "require('fs').writeFileSync(" + JSON.stringify(path.join(repo, 'POISON.txt')) + ", 'x')")
    r.updateSettings({ cliOverrides: { claude: fake } })
    const sess = r.createSession({
      workspaceId: ws.id,
      workspacePath: ws.path,
      provider: 'claude',
      worktreePath: path.join(repo, '.ai-coding-worktrees', 'da-mat'),
      worktreeBranch: 'ai/da-mat'
    })
    const orch = new AgentOrchestrator(r)
    await expect(orch.sendPrompt({ sessionId: sess.id, prompt: 'làm gì đó' })).rejects.toThrow(/Worktree của phiên/)
    expect(fs.existsSync(path.join(repo, 'POISON.txt'))).toBe(false)
    expect(r.listTurns(sess.id)).toHaveLength(0)
    expect(orch.isRunning(sess.id)).toBe(false)
  })
})

describe('P1.4 mở VS Code không qua shell', () => {
  it('truyền đường dẫn có khoảng trắng + Unicode + ký tự shell như một đối số duy nhất', async () => {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = []
    const spawnFn = (file: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options })
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => undefined
      queueMicrotask(() => child.emit('spawn'))
      return child as never
    }
    const target = 'C:\\Dự án & (test) $HOME\\mã nguồn'
    await openInVsCode(target, {
      env: { AICT_VSCODE_PATH: 'C:\\fake\\Code.exe' },
      exists: () => true,
      spawnFn
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('C:\\fake\\Code.exe')
    expect(calls[0].args).toEqual([target])
    expect(calls[0].options.shell).toBe(false)
  })

  it('báo lỗi khi thiếu launcher, đường dẫn tương đối hoặc không tồn tại', async () => {
    const exists = (p: string): boolean => p === 'C:\\proj'
    await expect(openInVsCode('C:\\proj', { env: {}, exists })).rejects.toThrow(/Không tìm thấy VS Code/)
    await expect(openInVsCode('--evil', { env: { AICT_VSCODE_PATH: 'C:\\c.exe' }, exists: () => true })).rejects.toThrow(/không hợp lệ/)
    await expect(openInVsCode('C:\\none', { env: { AICT_VSCODE_PATH: 'C:\\c.exe' }, exists })).rejects.toThrow(/không tồn tại/)
    expect(findVsCodeLauncher({}, () => false)).toBeNull()
  })
})

async function makeOrchestratorEnv(hooks?: ConstructorParameters<typeof AgentOrchestrator>[1]) {
  const repoDir = await makeRepo()
  const db = new WorkspaceDatabase(':memory:')
  await db.init()
  const r = new WorkspaceRepository(db)
  const ws = r.upsertWorkspace(repoDir)
  const dir = tmp('stop-cli-')
  const log = path.join(dir, 'calls.log')
  const fake = path.join(dir, 'claude.js')
  fs.writeFileSync(
    fake,
    `require('fs').appendFileSync(${JSON.stringify(log)}, 'run\\n')
process.stdin.resume(); process.stdin.on('end', () => {
  const o = (x) => console.log(JSON.stringify(x))
  o({ type: 'system', subtype: 'init', session_id: 's1' })
  o({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } })
  o({ type: 'result', subtype: 'success', session_id: 's1', duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } })
})`
  )
  r.updateSettings({ cliOverrides: { claude: fake } })
  const sess = r.createSession({ workspaceId: ws.id, workspacePath: ws.path, provider: 'claude' })
  return { r, sess, log, orch: new AgentOrchestrator(r, hooks) }
}

describe('P2.5 Dừng trong lúc chuẩn bị', () => {
  it('không spawn CLI, không tạo lượt, gỡ khóa phiên và vẫn gửi được lượt sau', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    let first = true
    const { r, sess, log, orch } = await makeOrchestratorEnv({
      afterCheckpoint: async () => {
        if (first) {
          first = false
          await gate
        }
      }
    })
    const statuses: string[] = []
    orch.on('ai:status', (p: { status: string }) => statuses.push(p.status))

    const pending = orch.sendPrompt({ sessionId: sess.id, prompt: 'lượt bị dừng' })
    const outcome = pending.then(
      () => 'resolved',
      (e: Error) => e.message
    )
    await new Promise((res) => setTimeout(res, 50))
    expect(orch.isRunning(sess.id)).toBe(true)
    await orch.stopRun(sess.id)
    release()

    expect(await outcome).toMatch(/Đã dừng/)
    expect(fs.existsSync(log)).toBe(false) // CLI chưa từng chạy
    expect(r.listTurns(sess.id)).toHaveLength(0)
    expect(orch.isRunning(sess.id)).toBe(false)
    expect(statuses[statuses.length - 1]).toBe('idle')

    // lượt kế tiếp vẫn gửi được
    const next = await orch.sendPrompt({ sessionId: sess.id, prompt: 'lượt sau' })
    await vi.waitFor(() => expect(r.getTurn(next.turnId)?.status).toBe('completed'), { timeout: 15000 })
    expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('luồng nhiều giai đoạn: dừng khi đang chuẩn bị pha 1 không chạy CLI nào', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    const { r, sess, log, orch } = await makeOrchestratorEnv({ afterCheckpoint: () => gate })
    const pending = orch
      .sendPrompt({
        sessionId: sess.id,
        prompt: 'đa giai đoạn',
        orchestrator: {
          enabled: true,
          plannerProvider: 'claude',
          plannerModel: '',
          executorProvider: 'claude',
          executorModel: '',
          autoExecute: true,
          verifyAfterExecute: true
        }
      })
      .catch((e: Error) => e.message)
    await new Promise((res) => setTimeout(res, 50))
    await orch.stopRun(sess.id)
    release()
    expect(await pending).toMatch(/Đã dừng/)
    await new Promise((res) => setTimeout(res, 200))
    expect(fs.existsSync(log)).toBe(false)
    expect(r.listTurns(sess.id)).toHaveLength(0)
    expect(orch.isRunning(sess.id)).toBe(false)
  })
})

describe('P2.6 listTurns đọc sự kiện theo lô', () => {
  async function seed(turnCount: number, eventsPerTurn: (i: number) => number) {
    const db = new WorkspaceDatabase(':memory:')
    await db.init()
    const r = new WorkspaceRepository(db)
    const ws = r.upsertWorkspace('C:/tmp/batch-ws')
    const sess = r.createSession({ workspaceId: ws.id, workspacePath: ws.path, provider: 'claude' })
    const other = r.createSession({ workspaceId: ws.id, workspacePath: ws.path, provider: 'codex' })
    const expected: Array<{ idx: number; texts: string[] }> = []
    for (let i = 1; i <= turnCount; i++) {
      const t = r.createTurn({ sessionId: sess.id, provider: 'claude', model: '', userPrompt: `p${i}`, attachments: [], preTreeHash: null, untrackedBackupId: null })
      const texts: string[] = []
      for (let k = 1; k <= eventsPerTurn(i); k++) {
        r.appendEvent(t.id, k, { type: 'text.delta', text: `t${i}e${k}` })
        texts.push(`t${i}e${k}`)
      }
      expected.push({ idx: i, texts })
      // nhiễu: lượt của phiên khác không được lẫn vào
      const o = r.createTurn({ sessionId: other.id, provider: 'codex', model: '', userPrompt: 'x', attachments: [], preTreeHash: null, untrackedBackupId: null })
      r.appendEvent(o.id, 1, { type: 'text.delta', text: 'NOISE' })
    }
    return { db, r, sess, expected }
  }

  it('phiên rỗng, lượt không có sự kiện, nhiều lượt: đúng thứ tự và định dạng', async () => {
    const empty = await seed(0, () => 0)
    expect(empty.r.listTurns(empty.sess.id)).toEqual([])

    const { r, sess, expected } = await seed(4, (i) => (i === 2 ? 0 : i + 1))
    const turns = r.listTurns(sess.id)
    expect(turns.map((t) => t.turnIndex)).toEqual([1, 2, 3, 4])
    for (const exp of expected) {
      const t = turns[exp.idx - 1]
      expect(t.events.map((e) => (e.event.type === 'text.delta' ? e.event.text : ''))).toEqual(exp.texts)
      expect(t.events.every((e) => e.turnId === t.id && typeof e.id === 'number' && typeof e.createdAt === 'string')).toBe(true)
      expect(t.events.map((e) => e.seq)).toEqual(exp.texts.map((_, k) => k + 1))
    }
    expect(JSON.stringify(turns)).not.toContain('NOISE')
    expect(r.getTurn(turns[2].id)?.events).toEqual(turns[2].events)
  })

  it('số truy vấn không tăng theo số lượt', async () => {
    const small = await seed(2, () => 2)
    const big = await seed(40, () => 2)
    const count = async (s: typeof small): Promise<number> => {
      const spy = vi.spyOn(s.db, 'queryAll')
      s.r.listTurns(s.sess.id)
      const n = spy.mock.calls.length
      spy.mockRestore()
      return n
    }
    const nSmall = await count(small)
    const nBig = await count(big)
    expect(nBig).toBe(nSmall)
    expect(nBig).toBeLessThanOrEqual(2)
  })
})
