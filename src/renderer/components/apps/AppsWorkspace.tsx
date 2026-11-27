import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Bot,
  ChevronDown,
  Code2,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Hammer,
  Layers,
  PackageCheck,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCw,
  Search,
  Server,
  Settings2,
  Share2,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { AppsBatchAction, AppShareInfo, DevAppConfig, DevAppRuntime } from '@shared/types/apps'
import { formatIpcError, openInExplorerWithToast, openInVsCodeWithToast } from '../../lib/os-actions'
import { useAiStore } from '../../stores/useAiStore'
import { useAppsStore, type AppsSortCol, type AppsTypeFilter } from '../../stores/useAppsStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'
import {
  AddEditAppModal,
  IisSitesModal,
  SaveProfileModal,
  ScanAndCatalogModal,
  ShareTesterModal
} from './AppsDialogs'

function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

const FILTER_TABS: Array<{ id: AppsTypeFilter; label: string }> = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'backend', label: 'Backend' },
  { id: 'bff', label: 'BFF' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'tool', label: 'Tool' },
  { id: 'storybook', label: 'Storybook' },
  { id: 'running', label: 'Đang chạy' }
]

const SPIN_FRAMES = ['◐', '◓', '◑', '◒']

export function AppsWorkspace(): React.JSX.Element {
  const showToast = useSettingsStore((s) => s.showToast)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)
  const addWorkspace = useSettingsStore((s) => s.addWorkspace)
  const defaultProvider = useSettingsStore((s) => s.settings.defaultProvider)
  const defaultMode = useSettingsStore((s) => s.settings.defaultMode)
  const createSession = useAiStore((s) => s.createSession)
  const openShellTab = useTerminalStore((s) => s.openShellTab)
  const openToolTab = useWorkspaceTabsStore((s) => s.openToolTab)

  const apps = useAppsStore((s) => s.apps)
  const config = useAppsStore((s) => s.config)
  const iisInstalled = useAppsStore((s) => s.iisInstalled)
  const loading = useAppsStore((s) => s.loading)
  const batchBusy = useAppsStore((s) => s.batchBusy)
  const selectedIds = useAppsStore((s) => s.selectedIds)
  const search = useAppsStore((s) => s.search)
  const typeFilter = useAppsStore((s) => s.typeFilter)
  const sortCol = useAppsStore((s) => s.sortCol)
  const sortDesc = useAppsStore((s) => s.sortDesc)
  const pendingMap = useAppsStore((s) => s.pendingMap)
  const failedMap = useAppsStore((s) => s.failedMap)
  const logAppId = useAppsStore((s) => s.logAppId)
  const logContent = useAppsStore((s) => s.logContent)
  const logLoading = useAppsStore((s) => s.logLoading)

  const initApps = useAppsStore((s) => s.initApps)
  const loadConfig = useAppsStore((s) => s.loadConfig)
  const refreshApps = useAppsStore((s) => s.refreshApps)
  const setSearch = useAppsStore((s) => s.setSearch)
  const setTypeFilter = useAppsStore((s) => s.setTypeFilter)
  const setSort = useAppsStore((s) => s.setSort)
  const setSelection = useAppsStore((s) => s.setSelection)
  const selectRange = useAppsStore((s) => s.selectRange)
  const toggleSelectRow = useAppsStore((s) => s.toggleSelectRow)
  const clearFailed = useAppsStore((s) => s.clearFailed)
  const markPending = useAppsStore((s) => s.markPending)
  const clearPending = useAppsStore((s) => s.clearPending)
  const setFailed = useAppsStore((s) => s.setFailed)
  const setBatchBusy = useAppsStore((s) => s.setBatchBusy)
  const openLog = useAppsStore((s) => s.openLog)
  const refreshLog = useAppsStore((s) => s.refreshLog)
  const clearLog = useAppsStore((s) => s.clearLog)
  const closeLog = useAppsStore((s) => s.closeLog)

  const [spinTick, setSpinTick] = useState(0)
  const [logHeight, setLogHeight] = useState(230)
  const [logSearch, setLogSearch] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<DevAppConfig | 'new' | null>(null)
  const [iisModalOpen, setIisModalOpen] = useState(false)
  const [profileModalApps, setProfileModalApps] = useState<DevAppRuntime[] | null>(null)
  const [shareInfo, setShareInfo] = useState<AppShareInfo | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ app: DevAppRuntime | null; top: number; left: number } | null>(null)

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const profileBtnRef = useRef<HTMLButtonElement | null>(null)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement | null>(null)
  const logPreRef = useRef<HTMLPreElement | null>(null)
  const logStickBottomRef = useRef(true)

  // Initial load + 5s poll (2s when pending ops active)
  useEffect(() => {
    void initApps()
  }, [initApps])

  const hasPending = Object.keys(pendingMap).length > 0
  useEffect(() => {
    const intervalMs = hasPending ? 2000 : 5000
    const timer = setInterval(() => {
      void refreshApps(undefined, true)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [hasPending, refreshApps])

  useEffect(() => {
    if (!hasPending) return
    const t = setInterval(() => setSpinTick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [hasPending])

  // Auto-poll live log drawer every 2s when open
  useEffect(() => {
    if (!logAppId) return
    logStickBottomRef.current = true
    setLogSearch('')
    const t = setInterval(() => void refreshLog(), 2000)
    return () => clearInterval(t)
  }, [logAppId, refreshLog])

  useEffect(() => {
    if (!logAppId || !logStickBottomRef.current || !logPreRef.current) return
    logPreRef.current.scrollTop = logPreRef.current.scrollHeight
  }, [logAppId, logContent, logSearch])

  useLayoutEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return
    const rect = ctxMenuRef.current.getBoundingClientRect()
    const nextLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, ctxMenu.left))
    const nextTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, ctxMenu.top))
    if (nextLeft !== ctxMenu.left || nextTop !== ctxMenu.top) {
      ctxMenuRef.current.style.left = `${nextLeft}px`
      ctxMenuRef.current.style.top = `${nextTop}px`
    }
  }, [ctxMenu])

  useLayoutEffect(() => {
    if (!profileMenuOpen || !profileMenuRef.current || !profileBtnRef.current) return
    const menuRect = profileMenuRef.current.getBoundingClientRect()
    const btnRect = profileBtnRef.current.getBoundingClientRect()
    const nextLeft = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, btnRect.right - menuRect.width))
    const nextTop = Math.max(8, Math.min(window.innerHeight - menuRect.height - 8, btnRect.bottom + 6))
    profileMenuRef.current.style.left = `${nextLeft}px`
    profileMenuRef.current.style.top = `${nextTop}px`
  }, [profileMenuOpen, config?.profiles.length])

  // Close menus on outside click / Escape
  useEffect(() => {
    if (!profileMenuOpen && !ctxMenu) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (profileMenuOpen && !profileBtnRef.current?.contains(target) && !profileMenuRef.current?.contains(target)) {
        setProfileMenuOpen(false)
      }
      if (ctxMenu && !ctxMenuRef.current?.contains(target)) {
        setCtxMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setProfileMenuOpen(false)
        setCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileMenuOpen, ctxMenu])

  const showStats = Boolean(config?.showStats)

  const filteredApps = useMemo(() => {
    let list = apps
    if (typeFilter === 'running') {
      list = list.filter((a) => a.running)
    } else if (typeFilter === 'storybook') {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes('storybook') ||
          a.id.toLowerCase().includes('storybook') ||
          a.group.toLowerCase() === 'storybook'
      )
    } else if (typeFilter !== 'ALL') {
      list = list.filter((a) => a.type === typeFilter)
    }

    const q = normalizeSearch(search.trim())
    if (q) {
      const words = q.split(/\s+/).filter(Boolean)
      list = list.filter((a) => {
        const statusStr = pendingMap[a.id]
          ? 'dang khoi dong dang dung'
          : failedMap[a.id]
            ? 'loi'
            : a.running
              ? 'dang chay'
              : a.busy
                ? `port bi ${a.processName} chiem`
                : 'da dung'
        const hay = normalizeSearch(`${a.group} ${a.name} ${a.type} ${a.port || ''} ${statusStr} ${a.processName}`)
        return words.every((w) => hay.includes(w))
      })
    }

    const statusRank = (a: DevAppRuntime): number => {
      if (pendingMap[a.id]) return 0
      if (a.running) return 1
      if (a.busy) return 2
      if (failedMap[a.id]) return 3
      return 4
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'group':
          cmp = a.group.localeCompare(b.group)
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'type':
          cmp = a.type.localeCompare(b.type)
          break
        case 'port':
          cmp = a.port - b.port
          break
        case 'pid':
          cmp = a.pid - b.pid
          break
        case 'cpu':
          cmp = (a.cpuPct ?? -1) - (b.cpuPct ?? -1)
          break
        case 'ram':
          cmp = (a.ramMb ?? -1) - (b.ramMb ?? -1)
          break
        case 'health':
          cmp = (a.healthMs ?? -1) - (b.healthMs ?? -1)
          break
        case 'status':
        default:
          cmp = statusRank(a) - statusRank(b)
      }
      if (cmp === 0) cmp = a.group.localeCompare(b.group) || a.name.localeCompare(b.name)
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [apps, typeFilter, search, sortCol, sortDesc, pendingMap, failedMap])

  const selectedApps = useMemo(
    () => apps.filter((a) => selectedIds.includes(a.id)),
    [apps, selectedIds]
  )

  const runningCount = useMemo(() => apps.filter((a) => a.running).length, [apps])

  const handleRemoveSelected = useCallback(
    async (targets = selectedApps): Promise<void> => {
      const known = targets.filter((a) => a.known)
      if (known.length === 0) {
        showToast('Chỉ gỡ được app trong danh mục (app "Khác" tự mất khi dừng).', 'info')
        return
      }
      const running = known.filter((a) => a.running)
      const msg = `Gỡ ${known.length} ứng dụng khỏi danh mục (không xóa code)?`
      if (!window.confirm(running.length > 0 ? `${msg}\n\nCó ${running.length} app đang chạy sẽ bị dừng.` : msg)) {
        return
      }
      try {
        const res = await window.workspaceApi.removeDevApps(
          known.map((a) => a.id),
          running.length > 0
        )
        await loadConfig()
        await refreshApps()
        setSelection([])
        showToast(res.message, 'ok')
      } catch (err) {
        showToast(formatIpcError(err), 'err')
      }
    },
    [selectedApps, showToast, loadConfig, refreshApps, setSelection]
  )

  // Keyboard shortcuts (Ctrl+F, Ctrl+A, F5, Delete)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('[role="dialog"]')) return
      const tag = (e.target as HTMLElement | null)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (inInput) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelection(filteredApps.map((a) => a.id))
      } else if (e.key === 'F5') {
        e.preventDefault()
        void refreshApps()
      } else if (e.key === 'Delete' && selectedIds.length > 0) {
        e.preventDefault()
        void handleRemoveSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredApps, selectedIds, setSelection, refreshApps, handleRemoveSelected])

  const executeBatch = async (act: AppsBatchAction, targets: DevAppRuntime[]): Promise<void> => {
    if (targets.length === 0) {
      showToast('Hãy chọn ít nhất 1 ứng dụng trong danh sách.', 'info')
      return
    }
    if (batchBusy) {
      showToast('Tác vụ trước đang chạy, chờ một chút.', 'info')
      return
    }
    let picked = targets
    if (act !== 'stop') {
      picked = targets.filter((a) => a.known)
      if (picked.length === 0) {
        showToast('App ngoài danh mục — chưa có lệnh khởi chạy.', 'err')
        return
      }
      if (act === 'start' || act === 'startseq') {
        picked = picked.filter((a) => !a.running && !pendingMap[a.id])
        if (picked.length === 0) {
          showToast('Các app đã chọn đều đang chạy hoặc đang khởi động.', 'info')
          return
        }
      }
    } else {
      picked = targets.filter((a) => a.running || a.known)
      if (picked.length === 0) {
        showToast('Không có app nào đang chạy để dừng.', 'info')
        return
      }
      if (picked.length > 1 && !window.confirm(`Dừng ${picked.length} ứng dụng đang chọn?`)) return
    }

    if (act === 'restart' && !window.confirm(`Khởi động lại ${picked.length} ứng dụng?`)) return

    const ids = picked.map((a) => a.id)
    clearFailed(ids)
    markPending(ids, act, false)
    setBatchBusy(true)
    try {
      const res = await window.workspaceApi.runAppsBatch(act, ids)
      markPending(ids, act, true)
      for (const errMsg of res.errors) {
        const m = errMsg.match(/^([a-z0-9-]+): (.*)$/)
        if (m) {
          clearPending([m[1]])
          setFailed(m[1], m[2])
        }
      }
      if (res.errors.length > 0) {
        showToast(res.errors[0], 'err')
      } else if (res.messages.length === 1) {
        showToast(res.messages[0], 'ok')
      } else {
        showToast(`Hoàn tất thao tác cho ${picked.length} ứng dụng.`, 'ok')
      }
      await refreshApps()
    } catch (err) {
      clearPending(ids)
      showToast(formatIpcError(err), 'err')
    } finally {
      setBatchBusy(false)
    }
  }

  const handleMaintenance = async (app: DevAppRuntime, task: 'npm-install' | 'dotnet-build'): Promise<void> => {
    if (!app.known || !app.dir) return
    const label = task === 'npm-install' ? 'npm install' : 'dotnet build'
    const stopFirst = task === 'dotnet-build' && app.running
    const msg = stopFirst
      ? `Chạy "${label}" cho ${app.name}?\nApp đang chạy sẽ được Dừng -> Build -> Khởi động lại tự động.`
      : `Chạy "${label}" cho ${app.name} trong "${app.dir}"?`
    if (!window.confirm(msg)) return

    setBatchBusy(true)
    showToast(`Đang chạy ${label} cho ${app.name}…`, 'info')
    try {
      const result = await window.workspaceApi.runAppMaintenance(app.id, task, stopFirst)
      showToast(result, 'ok')
      await refreshApps()
    } catch (err) {
      showToast(formatIpcError(err), 'err')
    } finally {
      setBatchBusy(false)
    }
  }

  const handleOpenGitForApp = async (app: DevAppRuntime): Promise<void> => {
    if (!app.dir) return
    try {
      await addWorkspace(app.dir)
      openToolTab({ kind: 'git', title: `Git · ${app.name}`, workspacePath: app.dir })
      setActiveTab('ai')
    } catch (err) {
      showToast(formatIpcError(err), 'err')
    }
  }

  const handleChatAiForApp = async (app: DevAppRuntime): Promise<void> => {
    if (!app.dir) return
    try {
      await addWorkspace(app.dir)
      const session = await createSession({
        workspacePath: app.dir,
        provider: defaultProvider,
        permissionMode: defaultMode,
        title: `App: ${app.name}`
      })
      useWorkspaceTabsStore.getState().openSessionTab(session)
      setActiveTab('ai')
    } catch (err) {
      showToast(formatIpcError(err), 'err')
    }
  }

  const handleStopPort = async (app: DevAppRuntime): Promise<void> => {
    const ownerInfo = app.busy
      ? `port ${app.port} đang bị ${app.processName} (PID ${app.busyPid}) chiếm`
      : `tiến trình ${app.processName || app.name} (port ${app.port})`
    if (!window.confirm(`Dừng ${ownerInfo}?`)) return
    try {
      const msg = await window.workspaceApi.stopPortOwner(app.port)
      showToast(msg, 'ok')
      await refreshApps()
    } catch (err) {
      showToast(formatIpcError(err), 'err')
    }
  }

  const renderStatusCell = (a: DevAppRuntime): React.JSX.Element => {
    const pd = pendingMap[a.id]
    if (pd) {
      const sec = Math.max(0, Math.floor((Date.now() - pd.since) / 1000))
      const text =
        pd.act === 'stop'
          ? 'Đang dừng'
          : pd.act === 'restart'
            ? 'Đang khởi động lại'
            : 'Đang khởi động'
      return (
        <span className="font-medium inline-flex items-center gap-1" style={{ color: pd.act === 'stop' ? 'var(--warn)' : 'var(--info)' }}>
          <span>{SPIN_FRAMES[spinTick % 4]}</span>
          <span>
            {text}… {sec}s
          </span>
        </span>
      )
    }
    if (failedMap[a.id] && !a.running) {
      return (
        <span className="font-medium" style={{ color: 'var(--err)' }} title={failedMap[a.id]}>
          ✗ Lỗi — xem log
        </span>
      )
    }
    if (a.running) {
      return (
        <span className="font-medium inline-flex items-center gap-1.5" style={{ color: 'var(--ok)' }}>
          <span>● Đang chạy</span>
          {a.autoRestart && <span title="Tự khởi động lại khi sập">↻</span>}
          {a.tunnelUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard.writeText(a.tunnelUrl!)
                showToast(`Đã copy tunnel URL: ${a.tunnelUrl}`, 'ok')
              }}
              className="px-1 rounded text-[10px] cursor-pointer hover:opacity-80"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              title={`Click để copy: ${a.tunnelUrl}`}
            >
              Tunnel
            </button>
          )}
          {!a.tunnelUrl && a.tunnelPending && (
            <span
              className="px-1 rounded text-[10px]"
              style={{ backgroundColor: 'var(--bg)', color: 'var(--info)' }}
              title="Đang khởi tạo DevTunnel…"
            >
              Tunnel…
            </span>
          )}
        </span>
      )
    }
    if (a.busy) {
      return (
        <span className="font-medium" style={{ color: 'var(--warn)' }}>
          ⚠ Port bị {a.processName || '?'} chiếm
        </span>
      )
    }
    return <span style={{ color: 'var(--muted)' }}>○ Đã dừng</span>
  }

  const thSort = (col: AppsSortCol, label: string, extraCls = ''): React.JSX.Element => (
    <th
      onClick={() => setSort(col)}
      className={`py-2 px-2.5 cursor-pointer select-none hover:opacity-80 whitespace-nowrap ${extraCls}`}
    >
      <span>{label}</span>
      {sortCol === col && <span className="ml-1 text-[10px]">{sortDesc ? '▼' : '▲'}</span>}
    </th>
  )

  const activeLogApp = apps.find((a) => a.id === logAppId) ?? null

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" data-apps-studio="true">
      {/* Top Action Toolbar */}
      <div
        className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Rocket className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-semibold">Ứng dụng Dev</span>
            <span
              className="px-2 py-0.5 rounded-full text-[10.5px] font-mono border"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: runningCount > 0 ? 'var(--ok)' : 'var(--muted)' }}
            >
              {runningCount}/{apps.length} chạy
            </span>
          </div>

          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs w-64"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm app, nhóm, port, trạng thái... (Ctrl+F)"
              className="w-full bg-transparent outline-none text-xs"
              style={{ color: 'var(--text)' }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="opacity-60 hover:opacity-100 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 rounded-lg border p-0.5 text-[11px]" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
            {FILTER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeFilter(t.id)}
                className="px-2 py-1 rounded-md cursor-pointer transition-colors"
                style={{
                  backgroundColor: typeFilter === t.id ? 'var(--sel)' : 'transparent',
                  color: typeFilter === t.id ? 'var(--accent)' : 'var(--muted)',
                  fontWeight: typeFilter === t.id ? 600 : 500
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Batch & Catalog Actions */}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <button
            type="button"
            disabled={batchBusy || selectedApps.length === 0}
            onClick={() => void executeBatch('start', selectedApps)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white font-medium cursor-pointer disabled:opacity-45"
            style={{ backgroundColor: 'var(--ok)' }}
            title="Khởi động các app đã chọn"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Start{selectedApps.length > 1 ? ` (${selectedApps.length})` : ''}</span>
          </button>

          {selectedApps.filter((a) => a.known).length >= 2 && (
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => void executeBatch('startseq', selectedApps)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-45"
              style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
              title="Khởi động lần lượt theo thứ tự: Tool → Backend → BFF → Frontend"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Start tuần tự</span>
            </button>
          )}

          <button
            type="button"
            disabled={batchBusy || selectedApps.length === 0}
            onClick={() => void executeBatch('stop', selectedApps)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-45"
            style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
            title="Dừng các app đã chọn"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Stop{selectedApps.length > 1 ? ` (${selectedApps.length})` : ''}</span>
          </button>

          <button
            type="button"
            disabled={batchBusy || selectedApps.length === 0}
            onClick={() => void executeBatch('restart', selectedApps)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer disabled:opacity-45"
            style={{ borderColor: 'var(--border)' }}
            title="Khởi động lại các app đã chọn"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Restart{selectedApps.length > 1 ? ` (${selectedApps.length})` : ''}</span>
          </button>

          {/* Profiles Menu */}
          <div className="relative">
            <button
              ref={profileBtnRef}
              type="button"
              data-apps-profiles-btn="true"
              onClick={() => setProfileMenuOpen((o) => !o)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Bộ app</span>
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            data-apps-scan-btn="true"
            onClick={() => setScanOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
            title="Quét thư mục project & quản lý danh mục"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Quét / Danh mục</span>
          </button>

          <button
            type="button"
            data-apps-add-btn="true"
            onClick={() => setEditTarget('new')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm app</span>
          </button>

          {iisInstalled && (
            <button
              type="button"
              onClick={() => setIisModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              title="Thêm site IIS vào Apps Studio"
            >
              <Server className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">IIS</span>
            </button>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void refreshApps()}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            title="Làm mới trạng thái port & tiến trình (F5)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Apps Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--surface)' }}>
            <tr className="text-left border-b text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
              <th className="py-2 px-2.5 w-9 text-center">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả"
                  checked={filteredApps.length > 0 && filteredApps.every((a) => selectedIds.includes(a.id))}
                  onChange={(e) => setSelection(e.target.checked ? filteredApps.map((a) => a.id) : [])}
                />
              </th>
              {thSort('group', 'Nhóm', 'w-28')}
              {thSort('name', 'Ứng dụng')}
              {thSort('type', 'Loại', 'w-24')}
              {thSort('port', 'Port', 'w-20')}
              {thSort('status', 'Trạng thái', 'w-52')}
              {thSort('pid', 'PID', 'w-20')}
              {showStats && thSort('cpu', 'CPU', 'w-20')}
              {showStats && thSort('ram', 'RAM', 'w-20')}
              {showStats && thSort('health', 'Phản hồi', 'w-28')}
              <th className="py-2 px-2.5 w-36 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredApps.map((app) => {
              const isSelected = selectedIds.includes(app.id)
              return (
                <tr
                  key={app.id}
                  data-app-row={app.id}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      selectRange(
                        filteredApps.map((a) => a.id),
                        app.id
                      )
                    } else {
                      toggleSelectRow(app.id, e.ctrlKey || e.metaKey)
                    }
                  }}
                  onDoubleClick={() => {
                    if (app.url) void window.workspaceApi.openExternalUrl(app.url)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!selectedIds.includes(app.id)) setSelection([app.id])
                    const width = 264
                    const height = 420
                    const left = Math.max(8, Math.min(window.innerWidth - width - 8, e.clientX))
                    const top = Math.max(8, Math.min(window.innerHeight - height - 8, e.clientY))
                    setCtxMenu({ app, top, left })
                  }}
                  className="group border-b cursor-pointer transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    backgroundColor: isSelected ? 'var(--sel)' : 'transparent'
                  }}
                >
                  <td className="py-2 px-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${app.name}`}
                      checked={isSelected}
                      onChange={() => toggleSelectRow(app.id, true)}
                    />
                  </td>
                  <td className="py-2 px-2.5 font-mono text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                    {app.group}
                  </td>
                  <td className="py-2 px-2.5">
                    <div className="font-medium flex items-center gap-1.5">
                      <span>{app.name}</span>
                      {app.iis && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono border" style={{ borderColor: 'var(--border)', color: 'var(--info)' }}>
                          IIS
                        </span>
                      )}
                    </div>
                    {app.dir && (
                      <div className="text-[10.5px] font-mono truncate max-w-[340px]" style={{ color: 'var(--muted)' }} title={app.dir}>
                        {app.dir}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10.5px] font-medium border"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: 'var(--bg)',
                        color:
                          app.type === 'frontend'
                            ? 'var(--info)'
                            : app.type === 'bff'
                              ? 'var(--accent)'
                              : app.type === 'tool'
                                ? 'var(--muted)'
                                : 'var(--ok)'
                      }}
                    >
                      {app.type}
                    </span>
                  </td>
                  <td className="py-2 px-2.5 font-mono text-[11.5px]">
                    {app.port > 0 ? app.port : '—'}
                  </td>
                  <td className="py-2 px-2.5 text-[11.5px]">{renderStatusCell(app)}</td>
                  <td className="py-2 px-2.5 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                    {app.pid > 0 ? app.pid : '—'}
                  </td>
                  {showStats && (
                    <td className="py-2 px-2.5 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                      {app.running && app.cpuPct != null ? `${app.cpuPct}%` : '—'}
                    </td>
                  )}
                  {showStats && (
                    <td className="py-2 px-2.5 font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                      {app.running && app.ramMb != null ? `${app.ramMb} MB` : '—'}
                    </td>
                  )}
                  {showStats && (
                    <td className="py-2 px-2.5 font-mono text-[11px]">
                      {app.running && app.healthCode ? (
                        <span style={{ color: app.healthOk ? 'var(--ok)' : 'var(--err)' }}>
                          HTTP {app.healthCode} · {app.healthMs}ms
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </td>
                  )}
                  <td className="py-2 px-2.5 text-right">
                    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {app.known && !app.running && (
                        <button
                          type="button"
                          disabled={batchBusy}
                          onClick={() => void executeBatch('start', [app])}
                          className="p-1 rounded border btn-ghost cursor-pointer"
                          style={{ borderColor: 'var(--border)', color: 'var(--ok)' }}
                          title="Start app"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                      )}
                      {app.known && app.running && (
                        <button
                          type="button"
                          disabled={batchBusy}
                          onClick={() => void executeBatch('stop', [app])}
                          className="p-1 rounded border btn-ghost cursor-pointer"
                          style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
                          title="Stop app"
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      )}
                      {!app.known && app.running && app.port > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleStopPort(app)}
                          className="p-1 rounded border btn-ghost cursor-pointer"
                          style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
                          title={`Dừng tiến trình trên port ${app.port}`}
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      )}
                      {app.url && (
                        <button
                          type="button"
                          onClick={() => void window.workspaceApi.openExternalUrl(app.url)}
                          className="p-1 rounded border btn-ghost cursor-pointer"
                          style={{ borderColor: 'var(--border)', color: 'var(--info)' }}
                          title={`Mở trình duyệt: ${app.url}`}
                        >
                          <Globe className="w-3 h-3" />
                        </button>
                      )}
                      {app.known && (
                        <button
                          type="button"
                          onClick={() => void openLog(app.id)}
                          className="p-1 rounded border btn-ghost cursor-pointer"
                          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                          title="Xem Log"
                        >
                          <FileText className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filteredApps.length === 0 && (
              <tr>
                <td colSpan={showStats ? 11 : 8} className="py-12 text-center space-y-2" style={{ color: 'var(--muted)' }}>
                  <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {apps.length === 0 ? 'Chưa có ứng dụng nào trong danh mục.' : 'Không có ứng dụng nào khớp bộ lọc.'}
                  </div>
                  {apps.length === 0 && (
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setScanOpen(true)}
                        className="px-3 py-1.5 rounded-lg text-white font-semibold cursor-pointer"
                        style={{ backgroundColor: 'var(--accent)' }}
                      >
                        Cấu hình &amp; Quét project
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditTarget('new')}
                        className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        + Thêm app thủ công
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Resizable Bottom Live Log Drawer */}
      {logAppId && (
        <div
          data-apps-log-drawer="true"
          className="border-t flex flex-col shrink-0"
          style={{ height: `${logHeight}px`, borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <div
            onMouseDown={(e) => {
              e.preventDefault()
              const startY = e.clientY
              const startH = logHeight
              const onMove = (mv: MouseEvent): void => {
                setLogHeight(Math.max(140, Math.min(window.innerHeight - 220, startH + (startY - mv.clientY))))
              }
              const onUp = (): void => {
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
            className="h-1.5 shrink-0 cursor-row-resize hover:bg-indigo-500/40"
            style={{ backgroundColor: 'var(--border)' }}
          />
          <div
            className="px-3 py-1.5 border-b flex items-center justify-between text-xs shrink-0"
            style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2 font-semibold">
              <FileText className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>Log: {activeLogApp?.name ?? logAppId}</span>
              {activeLogApp?.port ? (
                <span className="font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                  :{activeLogApp.port}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--muted)' }} />
                <input
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Lọc log…"
                  className="w-32 bg-transparent outline-none text-[11px]"
                  style={{ color: 'var(--text)' }}
                />
                {logSearch && (
                  <button type="button" onClick={() => setLogSearch('')} className="opacity-60 hover:opacity-100 cursor-pointer">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => void refreshLog()}
                className="px-2 py-0.5 rounded border btn-ghost cursor-pointer flex items-center gap-1"
                style={{ borderColor: 'var(--border)' }}
              >
                <RefreshCw className={`w-3 h-3 ${logLoading ? 'animate-spin' : ''}`} />
                <span>Làm mới</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(logContent)
                  showToast('Đã copy log.', 'ok')
                }}
                className="px-2 py-0.5 rounded border btn-ghost cursor-pointer flex items-center gap-1"
                style={{ borderColor: 'var(--border)' }}
              >
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </button>
              {!activeLogApp?.iis && (
                <button
                  type="button"
                  onClick={() => void clearLog().catch((e) => showToast(formatIpcError(e), 'err'))}
                  className="px-2 py-0.5 rounded border btn-ghost cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--warn)' }}
                >
                  Xóa log
                </button>
              )}
              <button type="button" onClick={closeLog} className="p-1 rounded btn-ghost cursor-pointer" title="Đóng log">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <pre
            ref={logPreRef}
            onScroll={(e) => {
              const el = e.currentTarget
              logStickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36
            }}
            className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
            style={{ backgroundColor: 'var(--bg)' }}
          >
            {(() => {
              if (!logContent) return '(Log trống)'
              const q = logSearch.trim().toLowerCase()
              if (!q) return logContent
              const matched = logContent.split('\n').filter((line) => line.toLowerCase().includes(q))
              return matched.length > 0 ? matched.join('\n') : `(Không có dòng log nào chứa "${logSearch}")`
            })()}
          </pre>
        </div>
      )}

      {/* Profiles Portal Dropdown */}
      {profileMenuOpen &&
        profileBtnRef.current &&
        createPortal(
          <div
            ref={profileMenuRef}
            data-apps-profiles-menu="true"
            className="fixed z-[130] w-72 rounded-xl border shadow-2xl p-1.5 space-y-1 text-xs"
            style={{
              top: `${profileBtnRef.current.getBoundingClientRect().bottom + 6}px`,
              left: `${Math.max(8, profileBtnRef.current.getBoundingClientRect().right - 288)}px`,
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <div className="px-2 py-1 text-[10.5px] font-semibold" style={{ color: 'var(--muted)' }}>
              Bộ app (Profiles)
            </div>
            {(config?.profiles ?? []).length === 0 ? (
              <div className="px-2.5 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                Chưa có bộ app nào. Chọn nhiều app rồi bấm lưu bên dưới.
              </div>
            ) : (
              (config?.profiles ?? []).map((prof) => {
                const profApps = apps.filter((a) => prof.ids.includes(a.id))
                const runningN = profApps.filter((a) => a.running).length
                return (
                  <div
                    key={prof.name}
                    className="p-2 rounded-lg border space-y-1.5"
                    style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold truncate">{prof.name}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                        {runningN}/{profApps.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false)
                          void executeBatch('startseq', profApps)
                        }}
                        className="px-2 py-0.5 rounded text-white text-[10.5px] cursor-pointer"
                        style={{ backgroundColor: 'var(--accent)' }}
                      >
                        Start theo thứ tự
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false)
                          void executeBatch('start', profApps)
                        }}
                        className="px-2 py-0.5 rounded border text-[10.5px] btn-ghost cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        Start tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false)
                          void executeBatch('stop', profApps.filter((x) => x.running))
                        }}
                        className="px-2 py-0.5 rounded border text-[10.5px] btn-ghost cursor-pointer"
                        style={{ borderColor: 'var(--border)', color: 'var(--err)' }}
                      >
                        Stop
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelection(prof.ids)
                          setProfileMenuOpen(false)
                        }}
                        className="px-2 py-0.5 rounded border text-[10.5px] btn-ghost cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        Chọn
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Xóa bộ app "${prof.name}"?`)) return
                          void window.workspaceApi
                            .removeAppsProfile(prof.name)
                            .then(() => loadConfig())
                            .catch((e) => showToast(formatIpcError(e), 'err'))
                        }}
                        className="px-1.5 py-0.5 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer ml-auto"
                        title="Xóa bộ này"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
            <button
              type="button"
              onClick={() => {
                const known = selectedApps.filter((a) => a.known)
                setProfileMenuOpen(false)
                if (known.length === 0) {
                  showToast('Hãy chọn ít nhất 1 app trong bảng để lưu thành Bộ app.', 'info')
                  return
                }
                setProfileModalApps(known)
              }}
              className="w-full px-2.5 py-1.5 rounded-lg text-left font-semibold btn-ghost cursor-pointer border-t mt-1 pt-2"
              style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              + Lưu các app đang chọn thành Bộ mới…
            </button>
          </div>,
          document.body
        )}

      {/* Row Context Menu Portal */}
      {ctxMenu &&
        ctxMenu.app &&
        createPortal(
          <div
            ref={ctxMenuRef}
            role="menu"
            data-apps-context-menu="true"
            className="fixed z-[130] w-64 rounded-xl border shadow-2xl p-1.5 space-y-0.5 text-xs max-h-[82vh] overflow-y-auto"
            style={{
              top: `${ctxMenu.top}px`,
              left: `${ctxMenu.left}px`,
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {(() => {
              const app = ctxMenu.app!
              const targets = selectedApps.length > 1 ? selectedApps : [app]
              const itemCls = 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left btn-ghost cursor-pointer'
              return (
                <>
                  <div className="px-2.5 py-1 text-[10.5px] font-semibold border-b mb-1 truncate" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    {targets.length > 1 ? `${targets.length} ứng dụng đang chọn` : `${app.name} (${app.group})`}
                  </div>
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setCtxMenu(null)
                      void executeBatch('start', targets)
                    }}
                  >
                    <Play className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
                    <span>Start{targets.length > 1 ? ` (${targets.length})` : ''}</span>
                  </button>
                  {targets.length > 1 && (
                    <button
                      type="button"
                      className={itemCls}
                      onClick={() => {
                        setCtxMenu(null)
                        void executeBatch('startseq', targets)
                      }}
                    >
                      <Layers className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                      <span>Start theo thứ tự (tool → BE → BFF → FE)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setCtxMenu(null)
                      void executeBatch('stop', targets)
                    }}
                  >
                    <Square className="w-3.5 h-3.5" style={{ color: 'var(--err)' }} />
                    <span>Stop</span>
                  </button>
                  <button
                    type="button"
                    className={itemCls}
                    onClick={() => {
                      setCtxMenu(null)
                      void executeBatch('restart', targets)
                    }}
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Restart</span>
                  </button>

                  <div className="border-t my-1" style={{ borderColor: 'var(--border)' }} />

                  {app.url && (
                    <>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void window.workspaceApi.openExternalUrl(app.url)
                        }}
                      >
                        <Globe className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
                        <span>Mở web trên trình duyệt</span>
                      </button>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          openToolTab({ kind: 'preview', title: app.name, previewUrl: app.url })
                          setActiveTab('ai')
                        }}
                      >
                        <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                        <span>Mở trong Live Preview</span>
                      </button>
                    </>
                  )}
                  {app.known && (
                    <button
                      type="button"
                      className={itemCls}
                      onClick={() => {
                        setCtxMenu(null)
                        void openLog(app.id)
                      }}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Xem Log trực tiếp</span>
                    </button>
                  )}
                  {app.dir && (
                    <>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void handleMaintenance(app, 'npm-install')
                        }}
                      >
                        <PackageCheck className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
                        <span>Install package (npm install)</span>
                      </button>
                      {(app.iis || app.type === 'backend' || app.type === 'bff') && (
                        <button
                          type="button"
                          className={itemCls}
                          onClick={() => {
                            setCtxMenu(null)
                            void handleMaintenance(app, 'dotnet-build')
                          }}
                        >
                          <Hammer className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} />
                          <span>Build .NET (dotnet build)</span>
                        </button>
                      )}
                    </>
                  )}

                  {app.port > 0 && app.running && (
                    <>
                      {!app.tunnelUrl && !app.tunnelPending ? (
                        <button
                          type="button"
                          className={itemCls}
                          onClick={() => {
                            setCtxMenu(null)
                            void window.workspaceApi
                              .startAppTunnel(app.port, app.name)
                              .then((m) => {
                                showToast(m, 'ok')
                                return refreshApps()
                              })
                              .catch((e) => showToast(formatIpcError(e), 'err'))
                          }}
                        >
                          <Globe className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                          <span>Public port ra Internet (Tunnel)</span>
                        </button>
                      ) : (
                        <>
                          {app.tunnelUrl && (
                            <>
                              <button
                                type="button"
                                className={itemCls}
                                onClick={() => {
                                  setCtxMenu(null)
                                  void navigator.clipboard.writeText(app.tunnelUrl!)
                                  showToast(`Đã copy link Tunnel: ${app.tunnelUrl}`, 'ok')
                                }}
                              >
                                <Copy className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                                <span>Copy link Tunnel</span>
                              </button>
                              <button
                                type="button"
                                className={itemCls}
                                onClick={() => {
                                  setCtxMenu(null)
                                  void window.workspaceApi.openExternalUrl(app.tunnelUrl!)
                                }}
                              >
                                <Globe className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
                                <span>Mở link Tunnel</span>
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className={itemCls}
                            onClick={() => {
                              setCtxMenu(null)
                              void window.workspaceApi
                                .stopAppTunnel(app.port)
                                .then((m) => showToast(m, 'info'))
                                .then(() => refreshApps())
                                .catch((e) => showToast(formatIpcError(e), 'err'))
                            }}
                          >
                            <Square className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} />
                            <span>Dừng Public Tunnel</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void window.workspaceApi
                            .getAppShareInfo(app.name, app.group, app.port, app.url)
                            .then((res) => setShareInfo(res))
                            .catch((e) => showToast(formatIpcError(e), 'err'))
                        }}
                      >
                        <Share2 className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
                        <span>Chia sẻ link cho Tester</span>
                      </button>
                    </>
                  )}

                  {app.busy && (
                    <button
                      type="button"
                      className={itemCls}
                      style={{ color: 'var(--warn)' }}
                      onClick={() => {
                        setCtxMenu(null)
                        void handleStopPort(app)
                      }}
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>Giải phóng port {app.port}</span>
                    </button>
                  )}

                  {app.dir && (
                    <>
                      <div className="border-t my-1" style={{ borderColor: 'var(--border)' }} />
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void handleOpenGitForApp(app)
                        }}
                      >
                        <GitBranch className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                        <span>Mở trong Git Studio</span>
                      </button>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void handleChatAiForApp(app)
                        }}
                      >
                        <Bot className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
                        <span>Chat AI với project này</span>
                      </button>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void openShellTab(app.dir, app.name)
                            .then((info) => {
                              openToolTab({ kind: 'terminal', title: info.title, workspacePath: app.dir, ptyId: info.id })
                              setActiveTab('ai')
                            })
                            .catch((e) => showToast(formatIpcError(e), 'err'))
                        }}
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Mở Terminal tại thư mục</span>
                      </button>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void openInExplorerWithToast(app.dir)
                        }}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Mở Explorer</span>
                      </button>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          void openInVsCodeWithToast(app.dir)
                        }}
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Mở bằng VS Code</span>
                      </button>
                    </>
                  )}

                  {app.known && !app.iis && (
                    <>
                      <div className="border-t my-1" style={{ borderColor: 'var(--border)' }} />
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          const nextVal = !app.autoRestart
                          void window.workspaceApi
                            .setDevAppsAutoRestart(targets.filter((x) => x.known && !x.iis).map((x) => x.id), nextVal)
                            .then(() => refreshApps())
                            .then(() => showToast(`Tự khởi động lại khi sập: ${nextVal ? 'BẬT' : 'TẮT'}`, 'ok'))
                            .catch((e) => showToast(formatIpcError(e), 'err'))
                        }}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>{app.autoRestart ? 'Tắt Tự khởi động lại khi sập' : 'Bật Tự khởi động lại khi sập'}</span>
                      </button>
                      <button
                        type="button"
                        className={itemCls}
                        onClick={() => {
                          setCtxMenu(null)
                          setEditTarget(app)
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Sửa cấu hình…</span>
                      </button>
                    </>
                  )}

                  {app.known && (
                    <button
                      type="button"
                      className={itemCls}
                      style={{ color: 'var(--err)' }}
                      onClick={() => {
                        setCtxMenu(null)
                        void handleRemoveSelected(targets)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Gỡ khỏi danh mục</span>
                    </button>
                  )}
                </>
              )
            })()}
          </div>,
          document.body
        )}

      {/* Dialogs */}
      {scanOpen && config && (
        <ScanAndCatalogModal
          config={config}
          onClose={() => setScanOpen(false)}
          onSaveAndScan={async (scanRoots, scanRanges, nextStats) => {
            try {
              await window.workspaceApi.updateAppsConfig({ scanRoots, scanRanges, showStats: nextStats })
              const res = await window.workspaceApi.scanAppsProjects(scanRoots)
              await loadConfig()
              await refreshApps(nextStats)
              showToast(`Đã quét xong: tìm thấy ${res.scannedCount} project (tổng ${res.totalCount} app).`, 'ok')
              setScanOpen(false)
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
          onRestoreApps={async (ids) => {
            try {
              const res = await window.workspaceApi.restoreDevApps(ids)
              await loadConfig()
              await refreshApps()
              if (res.conflicts.length > 0) {
                const names = res.conflicts.map((c) => `${c.name} (${c.id})`).join(', ')
                showToast(
                  `Đã khôi phục ${res.restoredCount} app; ${res.conflicts.length} mục trùng ID giữ nguyên ở danh sách đã gỡ: ${names}`,
                  res.restoredCount > 0 ? 'info' : 'err'
                )
              } else {
                showToast(`Đã khôi phục ${res.restoredCount} ứng dụng.`, 'ok')
              }
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
          onExportJson={async () => {
            try {
              const msg = await window.workspaceApi.exportAppsCatalogDialog()
              if (msg) showToast(msg, 'ok')
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
          onImportJson={async () => {
            try {
              const res = await window.workspaceApi.importAppsCatalogDialog()
              if (!res) return
              await loadConfig()
              await refreshApps()
              showToast(`Đã nhập ${res.addedApps} app mới, ${res.addedProfiles} bộ.`, 'ok')
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
        />
      )}

      {editTarget && (
        <AddEditAppModal
          initial={editTarget === 'new' ? undefined : editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={async (data) => {
            try {
              if (editTarget === 'new') {
                await window.workspaceApi.addDevApp(data)
                showToast(`Đã thêm ứng dụng "${data.name}".`, 'ok')
              } else {
                await window.workspaceApi.updateDevApp(editTarget.id, data)
                showToast(`Đã cập nhật "${data.name}".`, 'ok')
              }
              await loadConfig()
              await refreshApps()
              setEditTarget(null)
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
        />
      )}

      {iisModalOpen && (
        <IisSitesModal
          existingIisNames={apps.filter((a) => Boolean(a.iis)).map((a) => a.iis!)}
          onClose={() => setIisModalOpen(false)}
          onAddSites={async (names) => {
            try {
              const res = await window.workspaceApi.addIisApps(names)
              await loadConfig()
              await refreshApps()
              showToast(`IIS: Đã thêm ${res.added}, cập nhật ${res.updated} site.`, 'ok')
              setIisModalOpen(false)
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
        />
      )}

      {profileModalApps && (
        <SaveProfileModal
          defaultName={profileModalApps[0]?.group ? `${profileModalApps[0].group} Full` : 'Bộ app mới'}
          appNames={profileModalApps.map((a) => a.name)}
          onClose={() => setProfileModalApps(null)}
          onSave={async (name) => {
            try {
              await window.workspaceApi.saveAppsProfile(name, profileModalApps.map((a) => a.id))
              await loadConfig()
              showToast(`Đã lưu Bộ app "${name}" (${profileModalApps.length} app).`, 'ok')
              setProfileModalApps(null)
            } catch (e) {
              showToast(formatIpcError(e), 'err')
            }
          }}
        />
      )}

      {shareInfo && (
        <ShareTesterModal
          info={shareInfo}
          onClose={() => setShareInfo(null)}
          onCopied={(label) => showToast(label, 'ok')}
        />
      )}
    </div>
  )
}
