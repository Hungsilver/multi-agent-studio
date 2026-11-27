import { useState } from 'react'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitMerge,
  Globe,
  History,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Tag,
  Trash2
} from 'lucide-react'
import type { BranchInfo, StashEntry, WorktreeInfo } from '@shared/types/git'

export type GitMainTab = 'status' | 'history'

interface GitSidebarProps {
  activeTab: GitMainTab
  onChangeTab: (tab: GitMainTab) => void
  changesCount: number
  branches: BranchInfo[]
  stashes: StashEntry[]
  worktrees: WorktreeInfo[]
  selectedStashRef: string | null
  onCheckoutBranch: (name: string, isRemote: boolean) => void
  onCreateBranch: () => void
  onRenameBranch: (oldName: string) => void
  onDeleteBranch: (name: string) => void
  onMergeBranch: (sourceRef: string) => void
  onRebaseBranch: (targetRef: string) => void
  onSelectStash: (ref: string) => void
  onApplyStash: (ref: string, pop: boolean) => void
  onDropStash: (ref: string) => void
  onCreateTag: () => void
  onDeleteTag: (name: string) => void
  onRemoveWorktree: (worktreePath: string) => void
}

function SectionHeader({
  title,
  count,
  open,
  onToggle,
  onAdd,
  addTitle
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  onAdd?: () => void
  addTitle?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-1.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
      <button type="button" onClick={onToggle} className="flex items-center gap-1 flex-1 text-left cursor-pointer hover:opacity-80">
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span>{title}</span>
        {typeof count === 'number' && <span className="opacity-70 font-normal">({count})</span>}
      </button>
      {onAdd && (
        <button type="button" onClick={onAdd} title={addTitle} className="p-0.5 rounded btn-ghost cursor-pointer">
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

export function GitSidebar({
  activeTab,
  onChangeTab,
  changesCount,
  branches,
  stashes,
  worktrees,
  selectedStashRef,
  onCheckoutBranch,
  onCreateBranch,
  onRenameBranch,
  onDeleteBranch,
  onMergeBranch,
  onRebaseBranch,
  onSelectStash,
  onApplyStash,
  onDropStash,
  onCreateTag,
  onDeleteTag,
  onRemoveWorktree
}: GitSidebarProps): React.JSX.Element {
  const [openBranches, setOpenBranches] = useState(true)
  const [openRemotes, setOpenRemotes] = useState(false)
  const [openTags, setOpenTags] = useState(true)
  const [openStashes, setOpenStashes] = useState(true)
  const [openWorktrees, setOpenWorktrees] = useState(false)

  const localBranches = branches.filter((b) => b.kind === 'local')
  const remoteBranches = branches.filter((b) => b.kind === 'remote')
  const tags = branches.filter((b) => b.kind === 'tag')

  return (
    <aside
      aria-label="SourceTree Sidebar"
      className="w-64 shrink-0 border-r flex flex-col min-h-0 overflow-y-auto p-2 space-y-3 text-xs select-none"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* WORKSPACE VIEWS */}
      <div className="space-y-1">
        <div className="px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Workspace
        </div>
        <button
          type="button"
          data-git-tab="status"
          onClick={() => onChangeTab('status')}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: activeTab === 'status' ? 'var(--sel)' : 'transparent',
            color: activeTab === 'status' ? 'var(--accent)' : 'var(--text)'
          }}
        >
          <span className="flex items-center gap-2">
            <FileDiff className="w-3.5 h-3.5" />
            <span>File Status</span>
          </span>
          {changesCount > 0 && (
            <span
              className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-semibold"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {changesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          data-git-tab="history"
          onClick={() => onChangeTab('history')}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: activeTab === 'history' ? 'var(--sel)' : 'transparent',
            color: activeTab === 'history' ? 'var(--accent)' : 'var(--text)'
          }}
        >
          <span className="flex items-center gap-2">
            <History className="w-3.5 h-3.5" />
            <span>History (Graph)</span>
          </span>
        </button>
      </div>

      {/* LOCAL BRANCHES */}
      <div className="space-y-0.5">
        <SectionHeader
          title="Branches"
          count={localBranches.length}
          open={openBranches}
          onToggle={() => setOpenBranches((o) => !o)}
          onAdd={onCreateBranch}
          addTitle="Tạo nhánh mới"
        />
        {openBranches &&
          localBranches.map((b) => (
            <div
              key={b.name}
              onDoubleClick={() => {
                if (!b.current) onCheckoutBranch(b.name, false)
              }}
              className="group relative flex items-center justify-between gap-1 px-2 py-1 rounded-md cursor-pointer btn-ghost"
              style={{
                backgroundColor: b.current ? 'var(--sel)' : 'transparent',
                color: b.current ? 'var(--accent)' : 'var(--text)'
              }}
              title={`${b.name}${b.track ? ` (${b.track})` : ''} — Double-click để Checkout`}
            >
              <span className="flex items-center gap-1.5 truncate flex-1">
                <GitBranch className="w-3 h-3 shrink-0" />
                <span className={`truncate ${b.current ? 'font-semibold' : ''}`}>{b.name}</span>
              </span>
              {b.track && (
                <span className="text-[9.5px] font-mono opacity-75 group-hover:opacity-0 shrink-0">
                  {b.track.replace(/[\[\]]/g, '')}
                </span>
              )}

              {!b.current && (
                <div
                  className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity absolute right-1 flex items-center gap-0.5 px-1 py-0.5 rounded border shadow"
                  style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
                >
                  <button
                    type="button"
                    onClick={() => onCheckoutBranch(b.name, false)}
                    className="p-0.5 rounded btn-ghost cursor-pointer"
                    title="Checkout nhánh này"
                  >
                    <Play className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMergeBranch(b.name)}
                    className="p-0.5 rounded btn-ghost cursor-pointer"
                    title={`Merge ${b.name} vào nhánh hiện tại`}
                  >
                    <GitMerge className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRebaseBranch(b.name)}
                    className="p-0.5 rounded btn-ghost cursor-pointer"
                    title={`Rebase nhánh hiện tại lên ${b.name}`}
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRenameBranch(b.name)}
                    className="p-0.5 rounded btn-ghost cursor-pointer"
                    title="Đổi tên nhánh"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteBranch(b.name)}
                    className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                    title="Xóa nhánh"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>

      {/* REMOTES */}
      <div className="space-y-0.5">
        <SectionHeader
          title="Remotes"
          count={remoteBranches.length}
          open={openRemotes}
          onToggle={() => setOpenRemotes((o) => !o)}
        />
        {openRemotes &&
          remoteBranches.map((b) => (
            <div
              key={b.name}
              onDoubleClick={() => onCheckoutBranch(b.name, true)}
              className="group relative flex items-center justify-between gap-1 px-2 py-1 rounded-md cursor-pointer btn-ghost"
              title={`${b.name} — Double-click để Checkout local`}
            >
              <span className="flex items-center gap-1.5 truncate flex-1" style={{ color: 'var(--muted)' }}>
                <Globe className="w-3 h-3 shrink-0" />
                <span className="truncate">{b.name}</span>
              </span>
              <div
                className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity flex items-center gap-0.5"
              >
                <button
                  type="button"
                  onClick={() => onMergeBranch(b.name)}
                  className="p-0.5 rounded btn-ghost cursor-pointer"
                  title={`Merge ${b.name} vào nhánh hiện tại`}
                >
                  <GitMerge className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* TAGS */}
      <div className="space-y-0.5">
        <SectionHeader
          title="Tags"
          count={tags.length}
          open={openTags}
          onToggle={() => setOpenTags((o) => !o)}
          onAdd={onCreateTag}
          addTitle="Tạo Tag mới"
        />
        {openTags &&
          (tags.length === 0 ? (
            <div className="px-2 py-1 text-[10.5px]" style={{ color: 'var(--muted)' }}>
              Chưa có tag nào
            </div>
          ) : (
            tags.map((t) => (
              <div
                key={t.name}
                className="group flex items-center justify-between gap-1 px-2 py-1 rounded-md btn-ghost"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Tag className="w-3 h-3 shrink-0" style={{ color: 'var(--warn)' }} />
                  <span className="truncate font-mono text-[11px]">{t.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteTag(t.name)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                  title="Xóa Tag"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            ))
          ))}
      </div>

      {/* STASHES */}
      <div className="space-y-0.5">
        <SectionHeader
          title="Stashes"
          count={stashes.length}
          open={openStashes}
          onToggle={() => setOpenStashes((o) => !o)}
        />
        {openStashes &&
          (stashes.length === 0 ? (
            <div className="px-2 py-1 text-[10.5px]" style={{ color: 'var(--muted)' }}>
              Không có stash nào
            </div>
          ) : (
            stashes.map((st) => {
              const sel = selectedStashRef === st.ref
              return (
                <div
                  key={st.ref}
                  onClick={() => onSelectStash(st.ref)}
                  className="group relative flex flex-col gap-0.5 px-2 py-1.5 rounded-md cursor-pointer btn-ghost"
                  style={{ backgroundColor: sel ? 'var(--sel)' : 'transparent' }}
                  title={`${st.ref}: ${st.message}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Archive className="w-3 h-3 shrink-0" style={{ color: 'var(--info)' }} />
                    <span className="truncate font-medium">{st.message}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--muted)' }}>
                    <span className="font-mono">{st.ref}</span>
                    <span>{st.date}</span>
                  </div>
                  <div
                    className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity absolute right-1 top-1 flex items-center gap-0.5 px-1 py-0.5 rounded border shadow"
                    style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onApplyStash(st.ref, false)
                      }}
                      className="px-1 py-0.5 rounded text-[9.5px] btn-ghost cursor-pointer"
                      title="Apply (giữ lại Stash)"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onApplyStash(st.ref, true)
                      }}
                      className="px-1 py-0.5 rounded text-[9.5px] btn-ghost cursor-pointer"
                      style={{ color: 'var(--ok)' }}
                      title="Pop (Apply và xóa Stash)"
                    >
                      Pop
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDropStash(st.ref)
                      }}
                      className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer"
                      title="Xóa Stash"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              )
            })
          ))}
      </div>

      {/* WORKTREES */}
      <div className="space-y-0.5">
        <SectionHeader
          title="Worktrees"
          count={worktrees.length}
          open={openWorktrees}
          onToggle={() => setOpenWorktrees((o) => !o)}
        />
        {openWorktrees &&
          worktrees.map((w) => (
            <div
              key={w.path}
              className="p-1.5 rounded-md border flex items-center justify-between gap-1 text-[11px]"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-1">
                  <FolderGit2 className="w-3 h-3 shrink-0" style={{ color: 'var(--accent)' }} />
                  <span className="truncate">{w.branch}</span>
                </div>
                <div className="text-[9.5px] truncate" style={{ color: 'var(--muted)' }}>
                  {w.path}
                </div>
              </div>
              {!w.isMain && (
                <button
                  type="button"
                  onClick={() => onRemoveWorktree(w.path)}
                  className="text-red-400 hover:opacity-75 cursor-pointer shrink-0"
                  title="Xóa Worktree"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
      </div>
    </aside>
  )
}
