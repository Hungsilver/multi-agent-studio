import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Copy,
  GitBranch,
  GitCommit,
  MoreHorizontal,
  RotateCcw,
  Search,
  Tag,
  Undo2,
  X
} from 'lucide-react'
import type { BranchInfo, CommitDetail, CommitNode, DiffResult, GitGraphQuery } from '@shared/types/git'
import { detectMonacoLanguage } from '../../lib/monaco-setup'
import { CustomSelect } from '../common/CustomSelect'
import { MonacoDiffView } from '../common/MonacoDiffView'

const LANE_COLORS = ['#6366F1', '#10A37F', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6']

interface GitHistoryViewProps {
  commits: CommitNode[]
  branches: BranchInfo[]
  query: GitGraphQuery
  selectedCommit: CommitNode | null
  commitDetail: CommitDetail | null
  commitFileDiff: DiffResult | null
  selectedStashDiff: { ref: string; diff: string } | null
  isDark: boolean
  onChangeQuery: (patch: Partial<GitGraphQuery>) => void
  onSelectCommit: (commit: CommitNode) => void
  onSelectCommitFile: (hash: string, filePath: string) => void
  onCloseStashDiff: () => void
  onApplyStash: (ref: string, pop: boolean) => void
  onDropStash: (ref: string) => void
  onCreateBranchAt: (hash: string) => void
  onCreateTagAt: (hash: string) => void
  onCherryPick: (hash: string) => void
  onRevertCommit: (hash: string) => void
  onCheckoutCommit: (hash: string) => void
  onResetCommit: (commit: CommitNode) => void
  onCopySha: (hash: string) => void
}

function parseRefPills(refsStr: string): Array<{ label: string; kind: 'head' | 'tag' | 'remote' | 'local' }> {
  if (!refsStr.trim()) return []
  return refsStr
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith('HEAD -> ')) {
        return { label: r.replace('HEAD -> ', 'HEAD: '), kind: 'head' as const }
      }
      if (r.startsWith('tag: ')) {
        return { label: r.replace('tag: ', ''), kind: 'tag' as const }
      }
      if (r.includes('/')) {
        return { label: r, kind: 'remote' as const }
      }
      return { label: r, kind: 'local' as const }
    })
}

export function GitHistoryView({
  commits,
  branches,
  query,
  selectedCommit,
  commitDetail,
  commitFileDiff,
  selectedStashDiff,
  isDark,
  onChangeQuery,
  onSelectCommit,
  onSelectCommitFile,
  onCloseStashDiff,
  onApplyStash,
  onDropStash,
  onCreateBranchAt,
  onCreateTagAt,
  onCherryPick,
  onRevertCommit,
  onCheckoutCommit,
  onResetCommit,
  onCopySha
}: GitHistoryViewProps): React.JSX.Element {
  const [searchInput, setSearchInput] = useState(query.search ?? '')
  const [authorInput, setAuthorInput] = useState(query.author ?? '')
  const [selectedCommitFile, setSelectedCommitFile] = useState<string>('')
  const [detailHeight, setDetailHeight] = useState(280)

  const [menuCommit, setMenuCommit] = useState<CommitNode | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const first = commitDetail?.files[0]?.path ?? ''
    setSelectedCommitFile(first)
  }, [commitDetail])

  useEffect(() => {
    if (!menuCommit) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuCommit(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuCommit(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuCommit])

  const openContextMenu = (commit: CommitNode, x: number, y: number): void => {
    const width = 236
    const height = 270
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, x))
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, y))
    setMenuCommit(commit)
    setMenuPos({ top, left })
  }

  const startResizeDetail = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = detailHeight
    const onMove = (mv: MouseEvent): void => {
      const next = Math.max(180, Math.min(window.innerHeight - 240, startH + (startY - mv.clientY)))
      setDetailHeight(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const branchOptions = useMemo(
    () => [
      { value: '__all__', label: 'Tất cả nhánh (--all)' },
      { value: '__head__', label: 'Nhánh hiện tại (HEAD)' },
      ...branches
        .filter((b) => b.kind === 'local' || b.kind === 'remote')
        .map((b) => ({
          value: b.name,
          label: b.name,
          badge: b.kind === 'remote' ? 'remote' : b.current ? 'HEAD' : undefined
        }))
    ],
    [branches]
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Filter / Search Bar */}
      <div
        className="px-3 py-2 border-b flex flex-wrap items-center gap-2 text-xs shrink-0"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <CustomSelect<string>
          value={query.branch || '__all__'}
          onChange={(val) => onChangeQuery({ branch: val })}
          className="w-52"
          menuMinWidth={240}
          options={branchOptions}
        />

        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border flex-1 min-w-[180px]"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onChangeQuery({ search: searchInput })
            }}
            placeholder="Tìm commit message hoặc SHA (Enter)..."
            className="w-full bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)' }}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                onChangeQuery({ search: '' })
              }}
              className="opacity-60 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <input
          value={authorInput}
          onChange={(e) => setAuthorInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onChangeQuery({ author: authorInput })
          }}
          placeholder="Tác giả..."
          className="px-2.5 py-1 rounded-lg border w-36 outline-none text-xs"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />

        <label className="inline-flex items-center gap-1.5 cursor-pointer px-1.5" style={{ color: 'var(--muted)' }}>
          <input
            type="checkbox"
            checked={Boolean(query.firstParent)}
            onChange={(e) => onChangeQuery({ firstParent: e.target.checked })}
          />
          <span>First-parent</span>
        </label>

        <button
          type="button"
          onClick={() => onChangeQuery({ search: searchInput, author: authorInput })}
          className="px-2.5 py-1 rounded-lg border btn-ghost cursor-pointer font-medium"
          style={{ borderColor: 'var(--border)' }}
        >
          Lọc
        </button>

        <button
          type="button"
          onClick={() => onChangeQuery({ count: (query.count ?? 150) + 150 })}
          className="px-2 py-1 rounded-lg border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Tải thêm 150 commit nữa"
        >
          Tải thêm ({commits.length})
        </button>
      </div>

      {/* Commit Graph Table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--header)' }}>
            <tr className="text-left border-b" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              <th className="py-1.5 px-3 w-28">Graph</th>
              <th className="py-1.5 px-2">Nội dung Commit</th>
              <th className="py-1.5 px-2 w-36">Tác giả</th>
              <th className="py-1.5 px-2 w-32">Thời gian</th>
              <th className="py-1.5 px-2 w-10 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {commits.map((c) => {
              const rowH = 30
              const laneW = 14
              const svgW = Math.max(26, c.lanes * laneW + 10)
              const isSelected = selectedCommit?.hash === c.hash
              const pills = parseRefPills(c.refs)
              const nodeColor = LANE_COLORS[c.colorIndex % LANE_COLORS.length]

              return (
                <tr
                  key={c.hash}
                  data-git-commit-row={c.shortHash}
                  onClick={() => onSelectCommit(c)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onSelectCommit(c)
                    openContextMenu(c, e.clientX, e.clientY)
                  }}
                  className="group border-b cursor-pointer transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    backgroundColor: isSelected ? 'var(--sel)' : 'transparent'
                  }}
                >
                  <td className="px-3 py-0 align-middle">
                    <svg width={svgW} height={rowH} className="block">
                      {c.segments.map((s, idx) => {
                        const x1 = 8 + s.fromCol * laneW
                        const x2 = 8 + s.toCol * laneW
                        const y1 = s.kind === 2 ? rowH / 2 : 0
                        const y2 = s.kind === 1 ? rowH / 2 : rowH
                        const col = LANE_COLORS[s.colorIndex % LANE_COLORS.length]
                        if (x1 === x2) {
                          return <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={2} />
                        }
                        const midY = (y1 + y2) / 2
                        return (
                          <path
                            key={idx}
                            d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                            fill="none"
                            stroke={col}
                            strokeWidth={2}
                          />
                        )
                      })}
                      <circle
                        cx={8 + c.col * laneW}
                        cy={rowH / 2}
                        r={c.isMerge ? 4.5 : 4}
                        fill={c.isMerge ? 'var(--bg)' : nodeColor}
                        stroke={nodeColor}
                        strokeWidth={c.isMerge ? 2 : 0}
                      />
                    </svg>
                  </td>
                  <td className="px-2 py-1 truncate max-w-[460px]">
                    <span className="font-mono text-[11px] mr-2 opacity-75">{c.shortHash}</span>
                    {pills.map((p, idx) => (
                      <span
                        key={idx}
                        className="mr-1.5 px-1.5 py-0.2 rounded text-[10px] font-semibold border"
                        style={{
                          backgroundColor:
                            p.kind === 'head'
                              ? 'var(--accent-soft)'
                              : p.kind === 'tag'
                                ? 'rgba(245, 158, 11, 0.16)'
                                : p.kind === 'remote'
                                  ? 'rgba(16, 163, 127, 0.14)'
                                  : 'var(--surface-elevated)',
                          borderColor:
                            p.kind === 'head'
                              ? 'var(--accent)'
                              : p.kind === 'tag'
                                ? 'rgba(245, 158, 11, 0.45)'
                                : p.kind === 'remote'
                                  ? 'rgba(16, 163, 127, 0.4)'
                                  : 'var(--border)',
                          color:
                            p.kind === 'head'
                              ? 'var(--accent)'
                              : p.kind === 'tag'
                                ? 'var(--warn)'
                                : p.kind === 'remote'
                                  ? 'var(--ok)'
                                  : 'var(--text)'
                        }}
                      >
                        {p.label}
                      </span>
                    ))}
                    <span className={isSelected ? 'font-medium' : ''}>{c.subject}</span>
                  </td>
                  <td className="px-2 py-1 truncate" style={{ color: 'var(--muted)' }}>
                    {c.author}
                  </td>
                  <td className="px-2 py-1 font-mono text-[11px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                    {c.date}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      data-commit-menu-btn={c.shortHash}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectCommit(c)
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        openContextMenu(c, rect.right - 220, rect.bottom + 4)
                      }}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded btn-ghost cursor-pointer"
                      title="Thao tác với Commit này"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
            {commits.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center" style={{ color: 'var(--muted)' }}>
                  Không tìm thấy commit nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Stash Preview OR Resizable Commit Detail Inspector */}
      {selectedStashDiff ? (
        <div
          className="border-t flex flex-col shrink-0"
          style={{ height: `${detailHeight}px`, borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <div
            onMouseDown={startResizeDetail}
            className="h-1.5 shrink-0 cursor-row-resize hover:bg-indigo-500/40"
            style={{ backgroundColor: 'var(--border)' }}
          />
          <div className="px-3 py-1.5 border-b flex items-center justify-between text-xs" style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}>
            <span className="font-semibold flex items-center gap-1.5">
              <Archive className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
              <span>Stash Patch: {selectedStashDiff.ref}</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onApplyStash(selectedStashDiff.ref, false)}
                className="px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => onApplyStash(selectedStashDiff.ref, true)}
                className="px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--ok)' }}
              >
                Pop
              </button>
              <button
                type="button"
                onClick={() => onDropStash(selectedStashDiff.ref)}
                className="px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
              >
                Drop
              </button>
              <button type="button" onClick={onCloseStashDiff} className="p-1 rounded btn-ghost cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap" style={{ backgroundColor: 'var(--bg)' }}>
            {selectedStashDiff.diff || '(Stash trống)'}
          </pre>
        </div>
      ) : (
        selectedCommit && (
          <div
            data-git-commit-inspector="true"
            className="border-t flex flex-col shrink-0"
            style={{ height: `${detailHeight}px`, borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <div
              onMouseDown={startResizeDetail}
              className="h-1.5 shrink-0 cursor-row-resize hover:bg-indigo-500/40"
              style={{ backgroundColor: 'var(--border)' }}
              title="Kéo để chỉnh chiều cao khung Commit Inspector"
            />
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Left: Metadata & Files */}
              <div className="w-80 shrink-0 border-r flex flex-col min-h-0" style={{ borderColor: 'var(--border)' }}>
                <div className="p-2.5 border-b text-[11px] space-y-1 overflow-y-auto max-h-40 shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--header)' }}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                      {selectedCommit.hash.slice(0, 12)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCopySha(selectedCommit.hash)}
                      className="p-0.5 rounded btn-ghost cursor-pointer"
                      title="Sao chép SHA đầy đủ"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap font-mono text-[10.5px] leading-snug" style={{ color: 'var(--muted)' }}>
                    {commitDetail?.info || 'Đang tải thông tin commit…'}
                  </div>
                </div>
                <div className="px-2.5 py-1 text-[10.5px] font-semibold border-b" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  File thay đổi ({commitDetail?.files.length ?? 0})
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                  {(commitDetail?.files ?? []).map((f) => {
                    const active = selectedCommitFile === f.path
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => {
                          setSelectedCommitFile(f.path)
                          onSelectCommitFile(selectedCommit.hash, f.path)
                        }}
                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] font-mono cursor-pointer btn-ghost"
                        style={{ backgroundColor: active ? 'var(--sel)' : 'transparent' }}
                      >
                        <span
                          className="font-bold shrink-0"
                          style={{
                            color: f.code === 'D' ? 'var(--err)' : f.code === 'A' ? 'var(--ok)' : 'var(--warn)'
                          }}
                        >
                          {f.code}
                        </span>
                        <span className="truncate">{f.path}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Right: Commit File Diff */}
              <div className="flex-1 min-w-0 min-h-0" style={{ backgroundColor: 'var(--bg)' }}>
                {commitFileDiff ? (
                  <MonacoDiffView
                    original={commitFileDiff.original}
                    modified={commitFileDiff.modified}
                    language={detectMonacoLanguage(commitFileDiff.path)}
                    theme={isDark ? 'vs-dark' : 'light'}
                    sideBySide
                    fontSize={12}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
                    Chọn một file để xem nội dung thay đổi của commit
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* Commit Context Action Portal Menu */}
      {menuCommit && menuPos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-git-commit-menu="true"
            className="fixed z-[130] w-60 rounded-xl border shadow-2xl p-1.5 space-y-0.5 text-xs"
            style={{
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <div className="px-2.5 py-1 text-[10.5px] font-mono border-b mb-1" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              Commit {menuCommit.shortHash}
            </div>
            <button
              type="button"
              onClick={() => {
                const target = menuCommit.hash
                setMenuCommit(null)
                onCreateBranchAt(target)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
              <span>Tạo nhánh từ commit này…</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const target = menuCommit.hash
                setMenuCommit(null)
                onCreateTagAt(target)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <Tag className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} />
              <span>Tạo Tag tại commit này…</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const target = menuCommit.hash
                setMenuCommit(null)
                onCherryPick(target)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <GitCommit className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>Cherry-pick commit</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const target = menuCommit.hash
                setMenuCommit(null)
                onRevertCommit(target)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
              <span>Revert commit (tạo commit đảo)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const target = menuCommit.hash
                setMenuCommit(null)
                onCheckoutCommit(target)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
            >
              <GitBranch className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
              <span>Checkout commit (Detached HEAD)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const c = menuCommit
                setMenuCommit(null)
                onResetCommit(c)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer"
              style={{ color: 'var(--err)' }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset nhánh về commit này…</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const h = menuCommit.hash
                setMenuCommit(null)
                onCopySha(h)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer border-t mt-1 pt-1.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Sao chép SHA đầy đủ</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
