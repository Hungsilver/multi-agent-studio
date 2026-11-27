import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react'
import type { FileTreeEntry } from '@shared/types/workspace'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'

interface FileExplorerPanelProps {
  workDir: string
}

function TreeBranch({
  workDir,
  relDir,
  depth,
  onOpenFile,
  onAttachFile
}: {
  workDir: string
  relDir: string
  depth: number
  onOpenFile: (relPath: string, name: string) => void
  onAttachFile: (relPath: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<FileTreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let active = true
    setLoading(true)
    void window.workspaceApi
      .listWorkspaceDir(workDir, relDir)
      .then((res) => {
        if (active) setEntries(res)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [workDir, relDir])

  if (loading && entries.length === 0) {
    return (
      <div className="py-1 text-[11px]" style={{ paddingLeft: `${depth * 14 + 12}px`, color: 'var(--muted)' }}>
        Đang tải…
      </div>
    )
  }

  return (
    <div>
      {entries.map((entry) => {
        const isExp = Boolean(expanded[entry.relPath])
        return (
          <div key={entry.relPath}>
            <div
              onClick={() => {
                if (entry.isDir) {
                  setExpanded((prev) => ({ ...prev, [entry.relPath]: !prev[entry.relPath] }))
                } else {
                  onOpenFile(entry.relPath, entry.name)
                }
              }}
              className="group flex items-center justify-between gap-1 pr-1.5 py-1 rounded-md text-xs cursor-pointer btn-ghost"
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
              title={entry.relPath}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {entry.isDir ? (
                  <>
                    {isExp ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                    )}
                    {isExp ? (
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                    ) : (
                      <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warn)' }} />
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-3.5 shrink-0" />
                    <FileCode2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
                  </>
                )}
                <span className="truncate font-mono text-[11.5px]">{entry.name}</span>
              </div>

              {!entry.isDir && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAttachFile(entry.relPath)
                  }}
                  className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] font-mono btn-ghost shrink-0"
                  style={{ color: 'var(--accent)' }}
                  title="Đính kèm @file vào ô chat"
                >
                  +@
                </button>
              )}
            </div>

            {entry.isDir && isExp && (
              <TreeBranch
                workDir={workDir}
                relDir={entry.relPath}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                onAttachFile={onAttachFile}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function FileExplorerPanel({ workDir }: FileExplorerPanelProps): React.JSX.Element {
  const activeSessionId = useAiStore((s) => s.activeSessionId)
  const appendToDraft = useAiStore((s) => s.appendToDraft)
  const showToast = useSettingsStore((s) => s.showToast)
  const openInspectorTab = useWorkspaceTabsStore((s) => s.openInspectorTab)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<string[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!workDir || !query.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(() => {
      void window.workspaceApi.searchWorkspaceFiles(workDir, query).then(setSearchResults)
    }, 120)
    return () => clearTimeout(timer)
  }, [workDir, query])

  const handleOpenFile = useCallback(
    (relPath: string, name: string) => {
      openInspectorTab({
        kind: 'file-viewer',
        title: name,
        filePath: relPath,
        workspacePath: workDir
      })
    },
    [openInspectorTab, workDir]
  )

  const handleAttachFile = useCallback(
    (relPath: string) => {
      if (!activeSessionId) return
      appendToDraft(activeSessionId, `@${relPath} `)
      showToast(`Đã chèn @${relPath} vào ô nhập lệnh`, 'ok')
    },
    [activeSessionId, appendToDraft, showToast]
  )

  if (!workDir) {
    return (
      <div className="p-4 text-xs text-center" style={{ color: 'var(--muted)' }}>
        Chưa chọn thư mục workspace.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b flex items-center gap-1.5" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm file trong workspace..."
            className="w-full bg-transparent outline-none text-xs"
            style={{ color: 'var(--text)' }}
          />
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          title="Làm mới cây thư mục"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {query.trim() ? (
          searchResults.length === 0 ? (
            <div className="py-6 text-center text-xs" style={{ color: 'var(--muted)' }}>
              Không tìm thấy file khớp &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((relPath) => {
                const name = relPath.split('/').pop() || relPath
                return (
                  <div
                    key={relPath}
                    onClick={() => handleOpenFile(relPath, name)}
                    className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer btn-ghost"
                    title={relPath}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileCode2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
                      <span className="truncate font-mono text-[11.5px]">{relPath}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAttachFile(relPath)
                      }}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono btn-ghost shrink-0"
                      style={{ color: 'var(--accent)' }}
                      title="Đính kèm @file"
                    >
                      <Plus className="w-3 h-3" />@
                    </button>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <TreeBranch
            key={`${workDir}-${refreshKey}`}
            workDir={workDir}
            relDir=""
            depth={0}
            onOpenFile={handleOpenFile}
            onAttachFile={handleAttachFile}
          />
        )}
      </div>
    </div>
  )
}
