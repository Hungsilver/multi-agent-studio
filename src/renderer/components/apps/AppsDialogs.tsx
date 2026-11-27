import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderPlus,
  Globe,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Share2,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type {
  AppsCatalogConfig,
  AppShareInfo,
  DevAppConfig,
  DevAppType,
  IisSiteInfo
} from '@shared/types/apps'
import { CustomSelect } from '../common/CustomSelect'

function DialogShell({
  title,
  maxWidth = 'max-w-lg',
  onClose,
  children
}: {
  title: string
  maxWidth?: string
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]')) onClose()
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
        className={`w-full ${maxWidth} rounded-2xl border shadow-2xl p-5 space-y-4 text-xs`}
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            aria-label="Đóng"
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

export function ScanAndCatalogModal({
  config,
  onClose,
  onSaveAndScan,
  onRestoreApps,
  onExportJson,
  onImportJson
}: {
  config: AppsCatalogConfig
  onClose: () => void
  onSaveAndScan: (scanRoots: string[], scanRanges: Array<[number, number]>, showStats: boolean) => Promise<void>
  onRestoreApps: (ids: string[]) => Promise<void>
  onExportJson: () => Promise<void>
  onImportJson: () => Promise<void>
}): React.JSX.Element {
  const [roots, setRoots] = useState<string[]>(config.scanRoots)
  const [rangesText, setRangesText] = useState(
    config.scanRanges.map(([a, b]) => `${a}-${b}`).join(', ')
  )
  const [showStats, setShowStats] = useState(config.showStats)
  const [selectedRestore, setSelectedRestore] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRoots(config.scanRoots)
    setRangesText(config.scanRanges.map(([a, b]) => `${a}-${b}`).join(', '))
    setShowStats(config.showStats)
  }, [config])

  const parseRanges = (): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    for (const part of rangesText.split(/[,;\s]+/)) {
      const m = part.trim().match(/^(\d+)-(\d+)$/)
      if (m) {
        const lo = parseInt(m[1], 10)
        const hi = parseInt(m[2], 10)
        if (lo > 0 && hi >= lo && hi <= 65535) out.push([lo, hi])
      }
    }
    return out.length > 0 ? out : config.scanRanges
  }

  return (
    <DialogShell title="Cấu hình Quét Project & Danh mục Ứng dụng" maxWidth="max-w-2xl" onClose={onClose}>
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Scan Roots */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-semibold">Thư mục gốc để quét project (.NET Web/Worker/Exe &amp; Vite)</label>
            <button
              type="button"
              onClick={() => {
                void window.workspaceApi.pickFolder().then((dir) => {
                  if (dir && !roots.some((r) => r.toLowerCase() === dir.toLowerCase())) {
                    setRoots((prev) => [...prev, dir])
                  }
                })
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border btn-ghost cursor-pointer font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Thêm thư mục…</span>
            </button>
          </div>
          <div
            className="rounded-xl border divide-y max-h-36 overflow-y-auto"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            {roots.length === 0 ? (
              <div className="p-3 text-center" style={{ color: 'var(--muted)' }}>
                Chưa có thư mục quét. Bấm &quot;Thêm thư mục…&quot; để chọn thư mục chứa project.
              </div>
            ) : (
              roots.map((r) => (
                <div key={r} className="flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-[11px]">
                  <span className="truncate">{r}</span>
                  <button
                    type="button"
                    onClick={() => setRoots((prev) => prev.filter((x) => x !== r))}
                    className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 cursor-pointer shrink-0"
                    title="Xóa thư mục quét"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Port Ranges & Stats Toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Dải port tự phát hiện tiến trình lạ
            </label>
            <input
              value={rangesText}
              onChange={(e) => setRangesText(e.target.value)}
              placeholder="5000-5099, 7000-7199"
              className="w-full px-3 py-1.5 rounded-lg border font-mono outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <label className="flex items-center gap-2 pt-5 cursor-pointer">
            <input type="checkbox" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} />
            <span>Hiện cột CPU / RAM / Phản hồi HTTP</span>
          </label>
        </div>

        {/* Import / Export Catalog */}
        <div
          className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <span style={{ color: 'var(--muted)' }}>Chia sẻ &amp; Đồng bộ danh mục</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onExportJson()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Xuất JSON…</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onImportJson()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Nhập JSON…</span>
            </button>
          </div>
        </div>

        {/* Removed Apps Restore */}
        {config.removed.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold">App đã gỡ ({config.removed.length})</span>
              <button
                type="button"
                disabled={busy || selectedRestore.size === 0}
                onClick={() => {
                  setBusy(true)
                  void onRestoreApps(Array.from(selectedRestore))
                    .then(() => setSelectedRestore(new Set()))
                    .finally(() => setBusy(false))
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border btn-ghost cursor-pointer disabled:opacity-40"
                style={{ borderColor: 'var(--border)', color: 'var(--ok)' }}
              >
                <RotateCcw className="w-3 h-3" />
                <span>Khôi phục đã chọn ({selectedRestore.size})</span>
              </button>
            </div>
            <div
              className="rounded-xl border divide-y max-h-36 overflow-y-auto"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              {config.removed.map((rem) => {
                const checked = selectedRestore.has(rem.id)
                return (
                  <label
                    key={rem.id}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:opacity-90"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedRestore((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(rem.id)
                          else next.delete(rem.id)
                          return next
                        })
                      }}
                    />
                    <span className="font-semibold shrink-0">{rem.group}</span>
                    <span className="font-medium shrink-0">{rem.name}</span>
                    <span className="font-mono text-[10.5px] truncate" style={{ color: 'var(--muted)' }}>
                      {rem.dir}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)' }}
        >
          Đóng
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onSaveAndScan(roots, parseRanges(), showStats).finally(() => setBusy(false))
          }}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          <span>{busy ? 'Đang quét…' : 'Lưu và Quét project ngay'}</span>
        </button>
      </div>
    </DialogShell>
  )
}

export function AddEditAppModal({
  initial,
  onClose,
  onSubmit
}: {
  initial?: DevAppConfig
  onClose: () => void
  onSubmit: (data: Omit<DevAppConfig, 'id'>) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [group, setGroup] = useState(initial?.group ?? 'PROJECT')
  const [type, setType] = useState<DevAppType>(initial?.type ?? 'backend')
  const [port, setPort] = useState(String(initial?.port ?? 5173))
  const [url, setUrl] = useState(initial?.url ?? 'http://localhost:5173')
  const [dir, setDir] = useState(initial?.dir ?? '')
  const [start, setStart] = useState(initial?.start ?? 'npm run dev')
  const [autoRestart, setAutoRestart] = useState(Boolean(initial?.autoRestart))
  const [busy, setBusy] = useState(false)
  const isNew = !initial
  const handleTypeChange = (nextType: DevAppType): void => {
    setType(nextType)
    if (isNew && nextType === 'tool') {
      setPort('0')
      setUrl('')
    } else if (isNew && nextType !== 'tool' && port === '0') {
      setPort('5173')
      if (!url.trim()) setUrl('http://localhost:5173')
    }
  }
  const handlePortChange = (nextPort: string): void => {
    setPort(nextPort)
    if (isNew && /^\d+$/.test(nextPort.trim()) && Number(nextPort.trim()) > 0 && /^https?:\/\/localhost:\d+\/?$/i.test(url.trim())) {
      setUrl(url.trim().replace(/:(\d+)(\/?)$/, `:${nextPort.trim()}$2`))
    }
  }

  return (
    <DialogShell title={initial ? `Sửa cấu hình "${initial.name}"` : 'Thêm ứng dụng mới'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Tên ứng dụng
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: order-api"
              className="w-full px-3 py-1.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Nhóm (Group)
            </label>
            <input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="PROJECT / CORE / WEB"
              className="w-full px-3 py-1.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Loại
            </label>
            <CustomSelect<DevAppType>
              eventId="app-type-select"
              value={type}
              onChange={handleTypeChange}
              className="w-full"
              options={[
                { value: 'backend', label: 'Backend' },
                { value: 'bff', label: 'BFF' },
                { value: 'frontend', label: 'Frontend' },
                { value: 'tool', label: 'Tool / Console' }
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              Port (0 = tool)
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => handlePortChange(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border font-mono outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>
              URL Mở web
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:5173"
              className="w-full px-3 py-1.5 rounded-lg border outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Thư mục Project
          </label>
          <div className="flex gap-1.5">
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="D:\Projects\my-app"
              className="flex-1 px-3 py-1.5 rounded-lg border font-mono outline-none"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
            />
            <button
              type="button"
              onClick={() => void window.workspaceApi.pickFolder().then((p) => p && setDir(p))}
              className="px-2.5 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              Chọn…
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Lệnh Start
          </label>
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="npm run dev  hoặc  dotnet run --launch-profile https"
            className="w-full px-3 py-1.5 rounded-lg border font-mono outline-none"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={autoRestart} onChange={(e) => setAutoRestart(e.target.checked)} />
          <span>Tự khởi động lại khi app bị sập (tối đa 3 lần / 10 phút)</span>
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !dir.trim() || (!initial?.iis && !start.trim())}
          onClick={() => {
            setBusy(true)
            void onSubmit({
              group: group.trim() || 'PROJECT',
              name: name.trim(),
              type,
              port: Math.max(0, parseInt(port, 10) || 0),
              url: url.trim(),
              dir: dir.trim(),
              start: start.trim(),
              autoRestart,
              ...(!initial?.iis ? { manual: true } : {}),
              ...(initial?.iis ? { iis: initial.iis } : {})
            }).finally(() => setBusy(false))
          }}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Save className="w-3.5 h-3.5" />
          <span>{initial ? 'Lưu thay đổi' : 'Thêm ứng dụng'}</span>
        </button>
      </div>
    </DialogShell>
  )
}

export function IisSitesModal({
  existingIisNames,
  onClose,
  onAddSites
}: {
  existingIisNames: string[]
  onClose: () => void
  onAddSites: (names: string[]) => Promise<void>
}): React.JSX.Element {
  const [sites, setSites] = useState<IisSiteInfo[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set(existingIisNames))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.workspaceApi
      .listIisSites()
      .then((list) => setSites(list.filter((s) => s.port > 0)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <DialogShell title="Thêm site IIS vào Apps Studio" maxWidth="max-w-2xl" onClose={onClose}>
      <p style={{ color: 'var(--muted)' }}>
        Chọn site IIS muốn theo dõi (cổng HTTP/HTTPS + Windows Event Log). Thao tác Start / Stop / Recycle sẽ gọi hộp UAC một lần cho tất cả site đã chọn.
      </p>
      <div
        className="rounded-xl border divide-y max-h-72 overflow-y-auto"
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        {loading ? (
          <div className="p-4 text-center" style={{ color: 'var(--muted)' }}>
            Đang đọc cấu hình IIS…
          </div>
        ) : sites.length === 0 ? (
          <div className="p-4 text-center" style={{ color: 'var(--muted)' }}>
            Không tìm thấy site IIS nào có binding http/https.
          </div>
        ) : (
          sites.map((s) => (
            <label key={s.name} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:opacity-90">
              <input
                type="checkbox"
                checked={picked.has(s.name)}
                onChange={(e) => {
                  setPicked((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(s.name)
                    else next.delete(s.name)
                    return next
                  })
                }}
              />
              <Server className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
              <span className="font-semibold w-40 truncate">{s.name}</span>
              <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--accent)' }}>
                :{s.port}
              </span>
              <span className="font-mono text-[10.5px] truncate flex-1" style={{ color: 'var(--muted)' }}>
                {s.physicalPath}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          Hủy
        </button>
        <button
          type="button"
          disabled={busy || picked.size === 0}
          onClick={() => {
            setBusy(true)
            void onAddSites(Array.from(picked)).finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Thêm / Cập nhật ({picked.size})
        </button>
      </div>
    </DialogShell>
  )
}

export function SaveProfileModal({
  defaultName,
  appNames,
  onClose,
  onSave
}: {
  defaultName: string
  appNames: string[]
  onClose: () => void
  onSave: (name: string) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)

  return (
    <DialogShell title={`Lưu Bộ app (${appNames.length} ứng dụng)`} onClose={onClose}>
      <div className="space-y-3">
        <div
          className="p-2.5 rounded-lg border text-[11px] max-h-24 overflow-y-auto"
          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          {appNames.join(', ')}
        </div>
        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Tên Bộ app (Profile)
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy && name.trim()) {
                e.preventDefault()
                setBusy(true)
                void onSave(name.trim()).finally(() => setBusy(false))
              }
            }}
            placeholder="vd: HRM Full Stack"
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
            void onSave(name.trim()).finally(() => setBusy(false))
          }}
          className="px-4 py-1.5 rounded-lg text-white font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Lưu Bộ app
        </button>
      </div>
    </DialogShell>
  )
}

export function ShareTesterModal({
  info,
  onClose,
  onCopied
}: {
  info: AppShareInfo
  onClose: () => void
  onCopied: (label: string) => void
}): React.JSX.Element {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copy = (text: string, key: string, label: string): void => {
    void navigator.clipboard.writeText(text)
    setCopiedKey(key)
    onCopied(label)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  return (
    <DialogShell title={`Chia sẻ môi trường Test cho Tester — ${info.group}`} maxWidth="max-w-xl" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
            <Share2 className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} />
            <span>Link mạng nội bộ (Wi-Fi / LAN)</span>
          </label>
          <div className="flex gap-1.5">
            <input
              readOnly
              value={info.lanUrl}
              className="flex-1 px-3 py-1.5 rounded-lg border font-mono font-semibold"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ok)' }}
            />
            <button
              type="button"
              onClick={() => copy(info.lanUrl, 'lan', 'Đã copy link LAN')}
              className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer flex items-center gap-1"
              style={{ borderColor: 'var(--border)' }}
            >
              {copiedKey === 'lan' ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} /> : <Copy className="w-3.5 h-3.5" />}
              <span>Copy</span>
            </button>
          </div>
        </div>

        {info.tailscaleUrl && (
          <div className="space-y-1">
            <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <Globe className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
              <span>Link từ xa (Tailscale VPN)</span>
            </label>
            <div className="flex gap-1.5">
              <input
                readOnly
                value={info.tailscaleUrl}
                className="flex-1 px-3 py-1.5 rounded-lg border font-mono"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--info)' }}
              />
              <button
                type="button"
                onClick={() => copy(info.tailscaleUrl!, 'ts', 'Đã copy link Tailscale')}
                className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer flex items-center gap-1"
                style={{ borderColor: 'var(--border)' }}
              >
                {copiedKey === 'ts' ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--ok)' }} /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy</span>
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="font-medium" style={{ color: 'var(--muted)' }}>
            Tin nhắn mẫu gửi Tester (Zalo / Slack / Teams)
          </label>
          <textarea
            readOnly
            rows={5}
            value={info.messageTemplate}
            className="w-full p-2.5 rounded-xl border text-[11.5px] leading-relaxed"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => void window.workspaceApi.openExternalUrl(info.lanUrl)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
          style={{ borderColor: 'var(--border)' }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Mở thử trên trình duyệt</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copy(info.messageTemplate, 'msg', 'Đã copy toàn bộ tin nhắn gửi Tester')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy tin nhắn mẫu</span>
          </button>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--border)' }}>
            Đóng
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
