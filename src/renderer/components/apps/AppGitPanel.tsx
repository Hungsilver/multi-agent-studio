import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowRightLeft, FolderOpen, GitBranch, RefreshCw, X } from 'lucide-react'
import type { RepoSummary } from '@shared/types/git'
import { formatIpcError, openInExplorerWithToast } from '../../lib/os-actions'
import { useSettingsStore } from '../../stores/useSettingsStore'

const buttonClass = 'btn-ghost inline-flex items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50'

export function AppGitPanel({ dir, name, hidden, onClose }: {
  dir: string
  name: string
  hidden: boolean
  onClose: () => void
}): React.JSX.Element {
  const [summary, setSummary] = useState<RepoSummary | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [now, setNow] = useState(Date.now)
  const showToast = useSettingsStore((s) => s.showToast)
  const commit = summary?.headCommit

  useEffect(() => {
    if (hidden || !commit) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [hidden, commit])

  const load = useCallback(async () => {
    const repo = await window.workspaceApi.getRepoSummary(dir, true)
    const refs = repo.isRepo ? await window.workspaceApi.listBranches(repo.root) : []
    return { repo, locals: refs.filter((ref) => ref.kind === 'local').map((ref) => ref.name) }
  }, [dir])

  useEffect(() => {
    let active = true
    void load().then(({ repo, locals }) => {
      if (!active) return
      setSummary(repo)
      setBranches(locals)
      setTarget(repo.branch)
    }).catch((err) => {
      if (active) setError(formatIpcError(err))
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [load])

  async function run(action?: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    try {
      try {
        await action?.()
      } finally {
        const { repo, locals } = await load()
        setSummary(repo)
        setBranches(locals)
        setTarget(repo.branch)
      }
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const commitTime = commit ? new Date(commit.date) : null
  const commitMinutes = commitTime ? Math.floor((now - commitTime.getTime()) / 60_000) : NaN
  const incoming = summary?.incomingChanges
  const upstreamHasDeletions = Boolean(incoming?.deleted)
  return (
    <section aria-label={`Git · ${name}`} data-apps-git-panel="true" hidden={hidden} className="shrink-0 max-h-[35%] overflow-auto border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
        <span className="truncate font-semibold">Git · {name}</span>
        <button type="button" className="btn-ghost ml-auto rounded p-1" aria-label="Làm mới trạng thái Git" title="Làm mới trạng thái Git" disabled={busy} onClick={() => void run()}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
        <button type="button" className="btn-ghost rounded p-1" aria-label="Đóng Git" title="Đóng Git" onClick={onClose}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-[var(--err)]">{error}</p>}
      {!summary && busy && <p role="status">Đang đọc trạng thái Git…</p>}
      {summary && !summary.isRepo && <p className="text-[var(--muted)]">Thư mục dự án không có kho Git.</p>}
      {summary?.isRepo && (
        <>
          <p className="flex flex-wrap items-center gap-x-2 font-semibold">
            <span>{summary.branch}</span>
            {summary.upstream && (
              <span className={upstreamHasDeletions ? 'text-[var(--err)]' : undefined}>
                → {summary.upstream} · ↓{summary.behind} ↑{summary.ahead}
              </span>
            )}
            {summary.dirtyCount > 0 && <span className="text-[var(--warn)]">{summary.dirtyCount} file thay đổi local</span>}
            {incoming && incoming.files > 0 && (
              <span className="inline-flex flex-wrap items-center gap-x-1" aria-label="Thay đổi upstream">
                <span className="text-[var(--muted)]">Upstream</span>
                <span className={incoming.added > 0 ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{incoming.added} thêm</span>
                <span className={incoming.modified > 0 ? 'text-[var(--warn)]' : 'text-[var(--muted)]'}>· {incoming.modified} sửa</span>
                <span className={upstreamHasDeletions ? 'text-[var(--err)]' : 'text-[var(--muted)]'}>· {incoming.deleted} xóa</span>
                {incoming.renamed > 0 && <span className="text-[var(--muted)]">· {incoming.renamed} đổi tên</span>}
              </span>
            )}
            {summary.behind > 0 && !incoming && <span className="text-[var(--err)]">0 file đang sửa</span>}
            {summary.dirtyCount === 0 && (summary.behind === 0 || incoming?.files === 0) && (
              <span className="text-[var(--ok)]">Không có file thay đổi</span>
            )}
          </p>
          {commit && (
            <p className="mt-1 break-words">
              <code>{commit.shortHash}</code> {commit.subject}
              <span className="text-[var(--muted)]">
                {' · '}{commit.author}
                {commitTime && Number.isFinite(commitMinutes) && (
                  <> · <time dateTime={commit.date} title={commitTime.toLocaleString('vi-VN')}>
                    {commitMinutes < 1 ? 'vừa xong' : `${commitMinutes} phút trước`}
                  </time></>
                )}
              </span>
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 break-all text-[var(--muted)]">
            <span>{summary.root}</span>
            {summary.remoteUrl && <span>{summary.remoteUrl}</span>}
            {fetchedAt && <span>Fetch lúc {fetchedAt.toLocaleString('vi-VN')}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void run(async () => {
              const message = await window.workspaceApi.fetchAllRemotes(summary.root, false)
              setFetchedAt(new Date())
              showToast(message, 'ok')
            })}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Fetch
            </button>
            <button type="button" className={buttonClass} disabled={busy || !summary.upstream} onClick={() => void run(async () => {
              const result = await window.workspaceApi.pullCurrentBranch(summary.root)
              if (!result.ok) throw new Error(result.message)
              showToast(result.message, 'ok')
            })}>
              <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" /> Pull
            </button>
            <select aria-label="Nhánh Git" className="max-w-52 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1" value={target} disabled={busy || !branches.length} onChange={(e) => setTarget(e.target.value)}>
              {!branches.includes(target) && <option value={target}>{target || 'Chọn nhánh'}</option>}
              {branches.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" className={buttonClass} disabled={busy || !branches.includes(target) || target === summary.branch} onClick={() => void run(async () => {
              showToast(await window.workspaceApi.switchBranch(summary.root, target, false), 'ok')
            })}>
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" /> Chuyển nhánh
            </button>
            <button type="button" className={buttonClass} onClick={() => void openInExplorerWithToast(summary.root)}>
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Thư mục
            </button>
          </div>
        </>
      )}
    </section>
  )
}
