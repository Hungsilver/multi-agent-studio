import { useEffect, useState } from 'react'
import { AlertTriangle, Archive, ArrowDownToLine, ArrowUpFromLine, GitBranch, RotateCcw, Tag, X } from 'lucide-react'
import type { BranchInfo, ResetMode } from '@shared/types/git'
import { CustomSelect } from '../common/CustomSelect'

function ModalShell({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 text-xs"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function CreateBranchModal({
  defaultStartPoint,
  branches,
  onClose,
  onCreateStandard,
  onCreateFlow
}: {
  defaultStartPoint?: string
  branches: BranchInfo[]
  onClose: () => void
  onCreateStandard: (name: string, startPoint: string, checkout: boolean) => Promise<void>
  onCreateFlow: (type: 'feature' | 'fix' | 'bugfix' | 'hotfix', name: string, carry: boolean) => Promise<void>
}): React.JSX.Element {
  const [tab, setTab] = useState<'standard' | 'flow'>('standard')
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState(defaultStartPoint || 'HEAD')
  const [checkout, setCheckout] = useState(true)
  const [flowType, setFlowType] = useState<'feature' | 'fix' | 'bugfix' | 'hotfix'>('feature')
  const [carry, setCarry] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    try {
      if (tab === 'standard') {
        await onCreateStandard(name.trim(), startPoint, checkout)
      } else {
        await onCreateFlow(flowType, name.trim(), carry)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell title="Tạo nhánh Git mới" onClose={onClose}>
      <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg border" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setTab('standard')}
          className="py-1.5 rounded-md font-medium cursor-pointer"
          style={{
            backgroundColor: tab === 'standard' ? 'var(--surface-elevated)' : 'transparent',
            color: tab === 'standard' ? 'var(--text)' : 'var(--muted)'
          }}
        >
          Nhánh tiêu chuẩn
        </button>
        <button
          type="button"
          onClick={() => setTab('flow')}
          className="py-1.5 rounded-md font-medium cursor-pointer"
          style={{
            backgroundColor: tab === 'flow' ? 'var(--surface-elevated)' : 'transparent',
            color: tab === 'flow' ? 'var(--text)' : 'var(--muted)'
          }}
        >
          Git-Flow (origin)
        </button>
      </div>

      {tab === 'standard' ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Tên nhánh mới
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: feat/checkout-flow"
              className="w-full px-3 py-1.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Xuất phát từ (Branch / Commit)
            </label>
            <CustomSelect<string>
              value={startPoint}
              onChange={setStartPoint}
              className="w-full"
              menuMinWidth={320}
              options={[
                { value: 'HEAD', label: 'HEAD hiện tại' },
                ...(defaultStartPoint && defaultStartPoint !== 'HEAD'
                  ? [{ value: defaultStartPoint, label: `Commit ${defaultStartPoint.slice(0, 8)}` }]
                  : []),
                ...branches
                  .filter((b) => b.kind === 'local' || b.kind === 'remote')
                  .map((b) => ({
                    value: b.name,
                    label: b.name,
                    badge: b.kind === 'remote' ? 'remote' : b.current ? 'HEAD' : undefined
                  }))
              ]}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
            <span>Tự động Checkout sau khi tạo nhánh</span>
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Loại nhánh Git-Flow
            </label>
            <div className="grid grid-cols-4 gap-1">
              {(['feature', 'fix', 'bugfix', 'hotfix'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFlowType(t)}
                  className="py-1.5 rounded-md border font-mono cursor-pointer"
                  style={{
                    borderColor: flowType === t ? 'var(--accent)' : 'var(--border)',
                    backgroundColor: flowType === t ? 'var(--accent-soft)' : 'var(--bg)',
                    color: flowType === t ? 'var(--accent)' : 'var(--muted)'
                  }}
                >
                  {t}/
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Tên nhánh (chữ thường, gạch ngang)
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: payment-webhook"
              className="w-full px-3 py-1.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
            <span>Mang theo thay đổi đang dở</span>
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
          className="px-4 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>{busy ? 'Đang tạo…' : 'Tạo nhánh'}</span>
        </button>
      </div>
    </ModalShell>
  )
}

export function RenameBranchModal({
  oldName,
  onClose,
  onSubmit
}: {
  oldName: string
  onClose: () => void
  onSubmit: (newName: string) => Promise<void>
}): React.JSX.Element {
  const [newName, setNewName] = useState(oldName)
  const [busy, setBusy] = useState(false)

  return (
    <ModalShell title={`Đổi tên nhánh "${oldName}"`} onClose={onClose}>
      <div className="space-y-2">
        <label className="font-medium" style={{ color: 'var(--muted)' }}>
          Tên nhánh mới
        </label>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border outline-none"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy || !newName.trim() || newName.trim() === oldName}
          onClick={() => {
            setBusy(true)
            void onSubmit(newName.trim()).finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Đổi tên
        </button>
      </div>
    </ModalShell>
  )
}

export function SaveStashModal({
  onClose,
  onSubmit
}: {
  onClose: () => void
  onSubmit: (message: string, includeUntracked: boolean) => Promise<void>
}): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [busy, setBusy] = useState(false)

  return (
    <ModalShell title="Lưu Stash (Cất tạm thay đổi)" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Mô tả Stash (tùy chọn)
          </label>
          <input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="vd: WIP fix payment parser"
            className="w-full px-3 py-1.5 rounded-lg border outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
          />
          <span>Bao gồm các file mới chưa track (untracked `-u`)</span>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onSubmit(message, includeUntracked).finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>{busy ? 'Đang lưu…' : 'Lưu Stash'}</span>
        </button>
      </div>
    </ModalShell>
  )
}

export function CreateTagModal({
  defaultTarget,
  onClose,
  onSubmit
}: {
  defaultTarget?: string
  onClose: () => void
  onSubmit: (name: string, target: string, message: string) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [target, setTarget] = useState(defaultTarget || 'HEAD')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <ModalShell title="Tạo Tag mới" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Tên Tag
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd: v1.2.0"
            className="w-full px-3 py-1.5 rounded-lg border outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Gắn vào Commit / Branch
          </label>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg border font-mono outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Ghi chú Tag (Annotated — để trống nếu Lightweight)
          </label>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="vd: Release candidate v1.2.0"
            className="w-full px-3 py-1.5 rounded-lg border outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => {
            setBusy(true)
            void onSubmit(name.trim(), target.trim() || 'HEAD', message.trim()).finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Tạo Tag</span>
        </button>
      </div>
    </ModalShell>
  )
}

export function ResetCommitModal({
  commitHash,
  commitSubject,
  onClose,
  onSubmit
}: {
  commitHash: string
  commitSubject: string
  onClose: () => void
  onSubmit: (mode: ResetMode) => Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [busy, setBusy] = useState(false)

  return (
    <ModalShell title={`Reset nhánh về ${commitHash.slice(0, 7)}`} onClose={onClose}>
      <div className="p-2.5 rounded-lg border font-mono text-[11px]" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
        {commitHash.slice(0, 7)} — {commitSubject}
      </div>

      <div className="space-y-2">
        {(
          [
            {
              id: 'soft' as const,
              title: 'Soft (--soft)',
              desc: 'Giữ nguyên toàn bộ thay đổi ở trạng thái Staged để commit lại.'
            },
            {
              id: 'mixed' as const,
              title: 'Mixed (--mixed · Khuyên dùng)',
              desc: 'Giữ file đã sửa trên đĩa nhưng đưa về Unstaged.'
            },
            {
              id: 'hard' as const,
              title: 'Hard (--hard · Nguy hiểm)',
              desc: 'Xóa sạch mọi thay đổi chưa commit trên working copy & index!'
            }
          ]
        ).map((opt) => (
          <label
            key={opt.id}
            className="flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer"
            style={{
              borderColor: mode === opt.id ? (opt.id === 'hard' ? 'var(--err)' : 'var(--accent)') : 'var(--border)',
              backgroundColor: mode === opt.id ? (opt.id === 'hard' ? 'var(--err-bg)' : 'var(--accent-soft)') : 'var(--bg)'
            }}
          >
            <input
              type="radio"
              name="reset-mode"
              checked={mode === opt.id}
              onChange={() => setMode(opt.id)}
              className="mt-0.5"
            />
            <div>
              <div className="font-semibold" style={{ color: opt.id === 'hard' ? 'var(--err)' : 'var(--text)' }}>
                {opt.title}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {opt.desc}
              </div>
            </div>
          </label>
        ))}
      </div>

      {mode === 'hard' && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--err)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Hành động `--hard` không thể hoàn tác nếu thay đổi chưa được Stash/Commit!</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onSubmit(mode).finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: mode === 'hard' ? 'var(--err)' : 'var(--accent)' }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Thực hiện Reset</span>
        </button>
      </div>
    </ModalShell>
  )
}

export function PullPushModal({
  mode,
  branch,
  onClose,
  onPull,
  onPush
}: {
  mode: 'pull' | 'push'
  branch: string
  onClose: () => void
  onPull: (rebase: boolean) => Promise<void>
  onPush: (forceWithLease: boolean, pushTags: boolean) => Promise<void>
}): React.JSX.Element {
  const [rebase, setRebase] = useState(false)
  const [forceWithLease, setForceWithLease] = useState(false)
  const [pushTags, setPushTags] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <ModalShell title={mode === 'pull' ? `Pull nhánh "${branch}"` : `Push nhánh "${branch}"`} onClose={onClose}>
      {mode === 'pull' ? (
        <label className="flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
          <input type="checkbox" checked={rebase} onChange={(e) => setRebase(e.target.checked)} />
          <span>Dùng Rebase thay vì Merge (`git pull --rebase`)</span>
        </label>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
            <input type="checkbox" checked={pushTags} onChange={(e) => setPushTags(e.target.checked)} />
            <span>Push kèm tất cả Tags (`--tags`)</span>
          </label>
          <label className="flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
            <input type="checkbox" checked={forceWithLease} onChange={(e) => setForceWithLease(e.target.checked)} />
            <span style={{ color: forceWithLease ? 'var(--warn)' : 'var(--text)' }}>
              Force Push an toàn (`--force-with-lease`)
            </span>
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            const p = mode === 'pull' ? onPull(rebase) : onPush(forceWithLease, pushTags)
            void p.finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {mode === 'pull' ? <ArrowDownToLine className="w-3.5 h-3.5" /> : <ArrowUpFromLine className="w-3.5 h-3.5" />}
          <span>{busy ? 'Đang xử lý…' : mode === 'pull' ? 'Pull ngay' : 'Push ngay'}</span>
        </button>
      </div>
    </ModalShell>
  )
}
