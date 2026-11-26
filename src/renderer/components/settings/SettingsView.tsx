import { useEffect, useState } from 'react'
import { CheckCircle2, Download, ExternalLink, GitBranch, Package, RefreshCw, Settings, TerminalSquare, XCircle } from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import { ACCENTS, THEMES } from '@shared/constants/themes'
import type { ProviderId } from '@shared/types/ai'
import type { AccentName, AppUpdateInfo, AppVersionInfo, ThemeName } from '@shared/types/workspace'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'

export function SettingsView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const cliStatuses = useSettingsStore((s) => s.cliStatuses)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const refreshCliStatuses = useSettingsStore((s) => s.refreshCliStatuses)
  const showToast = useSettingsStore((s) => s.showToast)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  const loadSessions = useAiStore((s) => s.loadSessions)
  const setViewMode = useAiStore((s) => s.setViewMode)
  const attachExistingPty = useTerminalStore((s) => s.attachExistingPty)

  const [refreshing, setRefreshing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)

  useEffect(() => {
    void window.workspaceApi.getAppVersion().then(setVersionInfo).catch(() => {})
  }, [])

  const handleCheckUpdate = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const info = await window.workspaceApi.checkAppUpdate()
      setUpdateInfo(info)
      if (info.status === 'update-available') {
        showToast('Có bản cập nhật mới cho AI Coding Tool', 'info')
      } else if (info.status === 'up-to-date') {
        showToast('Bạn đang dùng phiên bản mới nhất', 'ok')
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleRunSourceUpdate = async (): Promise<void> => {
    const res = await window.workspaceApi.runSourceUpdate()
    attachExistingPty({ id: res.ptyId, title: 'Cập nhật AI Coding Tool', cwd: '', backend: 'conpty' })
    setViewMode('terminal')
    setActiveTab('ai')
  }

  const handleRefreshCli = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refreshCliStatuses(true)
      showToast('Đã kiểm tra lại đường dẫn CLI & fnm', 'ok')
    } finally {
      setRefreshing(false)
    }
  }

  const handleImportV1 = async (): Promise<void> => {
    setImporting(true)
    try {
      const res = await window.workspaceApi.importLegacyConfig()
      if (!res.found) {
        showToast('Không tìm thấy cấu hình PegasusPanel V1 trong %APPDATA%', 'info')
      } else {
        await useSettingsStore.getState().init()
        await loadSessions()
        showToast(
          `Đã nhập ${res.importedWorkspaces} workspace và ${res.importedSessions} phiên từ V1`,
          'ok'
        )
      }
    } finally {
      setImporting(false)
    }
  }

  const handleInstallCli = async (provider: ProviderId): Promise<void> => {
    const res = await window.workspaceApi.installOrUpdateCli(provider)
    attachExistingPty({ id: res.ptyId, title: `Cài ${PROVIDERS[provider].name}`, cwd: '', backend: 'conpty' })
    setViewMode('terminal')
    setActiveTab('ai')
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6 text-xs">
        <div className="flex items-center gap-2.5">
          <Settings className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h1 className="text-base font-semibold">AI Coding Tool — Cài đặt &amp; Chẩn đoán CLI</h1>
        </div>

        {/* Version & Updates */}
        <section
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Package className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <div>
                <div className="font-semibold text-sm flex items-center gap-2">
                  <span>Phiên bản &amp; Cập nhật (AI Coding Tool)</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-mono"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    v{versionInfo?.version ?? '1.0.0'}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    {versionInfo?.installMode === 'packaged' ? 'Bản cài đặt .exe' : 'Mã nguồn Git'}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)' }}>
                  Dữ liệu phiên AI &amp; cấu hình trong <code className="font-mono">%APPDATA%\AiCodingTool</code> được giữ nguyên khi cập nhật.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={() => void handleCheckUpdate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                <span>{checkingUpdate ? 'Đang kiểm tra…' : 'Kiểm tra cập nhật'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void window.workspaceApi.openExternalUrl(
                    updateInfo?.releaseUrl || versionInfo?.releasesUrl || 'https://github.com/Hungsilver/ai-coding-tool/releases'
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Mở GitHub Releases</span>
              </button>

              {updateInfo?.installMode === 'source' && updateInfo.status === 'update-available' && (
                <button
                  type="button"
                  onClick={() => void handleRunSourceUpdate()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Cập nhật từ Git</span>
                </button>
              )}
            </div>
          </div>

          {updateInfo && (
            <div
              className="p-3 rounded-lg border space-y-1.5"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor:
                  updateInfo.status === 'update-available'
                    ? 'var(--accent)'
                    : updateInfo.status === 'up-to-date'
                      ? 'var(--ok)'
                      : 'var(--border)'
              }}
            >
              <div
                className="font-medium"
                style={{
                  color:
                    updateInfo.status === 'update-available'
                      ? 'var(--accent)'
                      : updateInfo.status === 'up-to-date'
                        ? 'var(--ok)'
                        : updateInfo.status === 'error'
                          ? 'var(--err)'
                          : 'var(--info)'
                }}
              >
                {updateInfo.message}
              </div>
              {updateInfo.releaseNotes && (
                <pre className="whitespace-pre-wrap font-sans text-[11px]" style={{ color: 'var(--muted)' }}>
                  {updateInfo.releaseNotes}
                </pre>
              )}
            </div>
          )}
        </section>

        {/* Themes & Accents */}
        <section
          className="p-4 rounded-xl border space-y-4"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="font-semibold text-sm">Giao diện &amp; Màu nhấn</div>

          <div className="space-y-1.5">
            <div style={{ color: 'var(--muted)' }}>Chế độ Theme</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(Object.keys(THEMES) as ThemeName[]).map((tKey) => {
                const t = THEMES[tKey]
                const selected = settings.theme === tKey
                return (
                  <button
                    key={tKey}
                    type="button"
                    onClick={() => void updateSettings({ theme: tKey })}
                    className="p-2.5 rounded-xl border text-left space-y-1.5 cursor-pointer"
                    style={{
                      backgroundColor: t.bg,
                      color: t.text,
                      borderColor: selected ? 'var(--accent)' : t.border
                    }}
                  >
                    <div className="font-semibold">{t.name}</div>
                    <div className="flex gap-1">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.surface }} />
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.sel }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <div style={{ color: 'var(--muted)' }}>Màu nhấn (Accent)</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACCENTS) as AccentName[]).map((aKey) => {
                const a = ACCENTS[aKey]
                const selected = settings.accent === aKey
                return (
                  <button
                    key={aKey}
                    type="button"
                    onClick={() => void updateSettings({ accent: aKey })}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer"
                    style={{
                      borderColor: selected ? a.color : 'var(--border)',
                      backgroundColor: selected ? a.soft : 'var(--bg)'
                    }}
                  >
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: a.color }} />
                    <span>{a.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* AI Preferences & Legacy Import */}
        <section
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="font-semibold text-sm">Cấu hình AI &amp; Dữ liệu cũ</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
              <span>Claude Code: dùng tài khoản /login (bỏ qua ANTHROPIC_API_KEY)</span>
              <input
                type="checkbox"
                checked={settings.claudeAuthMode === 'account'}
                onChange={(e) => void updateSettings({ claudeAuthMode: e.target.checked ? 'account' : 'env' })}
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer" style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}>
              <span>Thông báo Windows khi AI chạy nền hoàn tất</span>
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) => void updateSettings({ notifications: e.target.checked })}
              />
            </label>
          </div>

          <div className="pt-1 flex items-center justify-between">
            <span style={{ color: 'var(--muted)' }}>
              Nhập workspace &amp; phiên cũ từ Develop Workspace (tùy chọn, %APPDATA%\PegasusPanel)
            </span>
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImportV1()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{importing ? 'Đang nhập…' : 'Nhập dữ liệu cũ'}</span>
            </button>
          </div>
        </section>

        {/* CLI Diagnostics */}
        <section
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">Chẩn đoán AI CLI (fnm-safe &amp; Windows Registry)</div>
              <div style={{ color: 'var(--muted)' }}>
                Tự động bỏ qua đường dẫn tạm `fnm_multishells`, ưu tiên đường dẫn bền vững và `node.exe + codex.js`
              </div>
            </div>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefreshCli()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Quét lại CLI</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {cliStatuses.map((cli) => {
              const meta = PROVIDERS[cli.provider]
              return (
                <div
                  key={cli.provider}
                  className="p-3 rounded-xl border space-y-2"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                      <span className="font-semibold text-sm">{cli.name}</span>
                      {cli.installed ? (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--ok)' }}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {cli.version || 'Sẵn sàng'} · ({cli.resolvedVia})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--err)' }}>
                          <XCircle className="w-3.5 h-3.5" />
                          Chưa cài đặt
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleInstallCli(cli.provider)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border btn-ghost cursor-pointer"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <TerminalSquare className="w-3.5 h-3.5" />
                      <span>{cli.installed ? 'Cập nhật' : 'Cài đặt'}</span>
                    </button>
                  </div>

                  {cli.executablePath && (
                    <div className="font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                      Exe: {cli.executablePath}
                      {cli.entryScriptPath ? ` → ${cli.entryScriptPath}` : ''}
                    </div>
                  )}
                  {cli.defaultModel && (
                    <div className="text-[11px]" style={{ color: 'var(--info)' }}>
                      Model mặc định của CLI: <strong>{cli.defaultModel}</strong>
                    </div>
                  )}
                  {cli.notes && (
                    <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      {cli.notes}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
