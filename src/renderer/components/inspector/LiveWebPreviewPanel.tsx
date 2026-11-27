import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Maximize2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react'
import { useAiStore } from '../../stores/useAiStore'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'
import type { WebViewElement } from '../../types/webview'

interface LiveWebPreviewPanelProps {
  initialUrl?: string
  inspTabId?: string
  fullTab?: boolean
}

type ViewportPreset = 'desktop' | 'tablet' | 'mobile'

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'http://localhost:5173'
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

export function LiveWebPreviewPanel({
  initialUrl = 'http://localhost:5173',
  inspTabId,
  fullTab = false
}: LiveWebPreviewPanelProps): React.JSX.Element {
  const detail = useAiStore((s) => s.activeDetail)
  const terminalTabs = useTerminalStore((s) => s.tabs)
  const updateInspectorTab = useWorkspaceTabsStore((s) => s.updateInspectorTab)
  const openToolTab = useWorkspaceTabsStore((s) => s.openToolTab)

  const [currentUrl, setCurrentUrl] = useState(() => normalizeUrl(initialUrl))
  const [addressDraft, setAddressDraft] = useState(() => normalizeUrl(initialUrl))
  const [viewport, setViewport] = useState<ViewportPreset>('desktop')
  const [loadError, setLoadError] = useState<string | null>(null)
  const webviewRef = useRef<WebViewElement | null>(null)

  useEffect(() => {
    const next = normalizeUrl(initialUrl)
    setCurrentUrl(next)
    setAddressDraft(next)
    setLoadError(null)
  }, [initialUrl])

  // Tự phát hiện các URL localhost đang xuất hiện trong Terminal hoặc Chat gần nhất
  const detectedUrls = useMemo(() => {
    const found = new Set<string>(['http://localhost:5173', 'http://localhost:3000'])
    const urlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/[^\s)"'`<>]*)?/gi

    for (const t of terminalTabs) {
      const matches = t.buffer.match(urlRegex)
      if (matches) matches.forEach((m) => found.add(m))
    }
    const turns = detail?.turns ?? []
    for (const turn of turns.slice(-5)) {
      const fullTurnText = turn.events
        .filter((ev) => ev.event.type === 'text.delta')
        .map((ev) => (ev.event.type === 'text.delta' ? ev.event.text : ''))
        .join('')
      const matches = fullTurnText.match(urlRegex)
      if (matches) matches.forEach((m) => found.add(m))
    }
    return Array.from(found).slice(0, 5)
  }, [terminalTabs, detail?.turns])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const onFail = (ev: Event): void => {
      const custom = ev as Event & { errorDescription?: string; errorCode?: number }
      if (custom.errorCode === -3) return // ABORTED do điều hướng mới
      setLoadError(custom.errorDescription || 'Không kết nối được tới máy chủ')
    }
    const onDidFinish = (): void => {
      setLoadError(null)
      try {
        const u = wv.getURL()
        if (u) setAddressDraft(u)
      } catch {
        // ignore
      }
    }

    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('did-finish-load', onDidFinish)
    return () => {
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('did-finish-load', onDidFinish)
    }
  }, [currentUrl])

  const navigateTo = (targetRaw: string): void => {
    const normalized = normalizeUrl(targetRaw)
    setLoadError(null)
    setCurrentUrl(normalized)
    setAddressDraft(normalized)
    if (inspTabId) {
      updateInspectorTab(inspTabId, { previewUrl: normalized })
    }
  }

  const viewportWidth = viewport === 'mobile' ? '390px' : viewport === 'tablet' ? '768px' : '100%'

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Address & Viewport Toolbar */}
      <div
        className="p-2 border-b space-y-1.5 shrink-0"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              try {
                if (webviewRef.current?.canGoBack()) webviewRef.current.goBack()
              } catch {
                // ignore
              }
            }}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Quay lại"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                if (webviewRef.current?.canGoForward()) webviewRef.current.goForward()
              } catch {
                // ignore
              }
            }}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Tiến tới"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setLoadError(null)
              try {
                webviewRef.current?.reload()
              } catch {
                // ignore
              }
            }}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Tải lại"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <form
            className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            onSubmit={(e) => {
              e.preventDefault()
              navigateTo(addressDraft)
            }}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--info)' }} />
            <input
              value={addressDraft}
              onChange={(e) => setAddressDraft(e.target.value)}
              placeholder="http://localhost:5173"
              className="w-full bg-transparent outline-none font-mono text-[11.5px]"
              style={{ color: 'var(--text)' }}
            />
          </form>

          <div
            className="flex items-center rounded border p-0.5"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              className="p-1 rounded cursor-pointer"
              style={{
                backgroundColor: viewport === 'desktop' ? 'var(--sel)' : 'transparent',
                color: viewport === 'desktop' ? 'var(--text)' : 'var(--muted)'
              }}
              title="Desktop (100%)"
            >
              <Monitor className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewport('tablet')}
              className="p-1 rounded cursor-pointer"
              style={{
                backgroundColor: viewport === 'tablet' ? 'var(--sel)' : 'transparent',
                color: viewport === 'tablet' ? 'var(--text)' : 'var(--muted)'
              }}
              title="Tablet (768px)"
            >
              <Tablet className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              className="p-1 rounded cursor-pointer"
              style={{
                backgroundColor: viewport === 'mobile' ? 'var(--sel)' : 'transparent',
                color: viewport === 'mobile' ? 'var(--text)' : 'var(--muted)'
              }}
              title="Mobile (390px)"
            >
              <Smartphone className="w-3 h-3" />
            </button>
          </div>

          {!fullTab && (
            <button
              type="button"
              onClick={() =>
                openToolTab({
                  kind: 'preview',
                  title: currentUrl.replace(/^https?:\/\//i, ''),
                  previewUrl: currentUrl
                })
              }
              className="p-1 rounded btn-ghost cursor-pointer"
              style={{ color: 'var(--muted)' }}
              title="Mở ở Tab lớn"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void window.workspaceApi.openExternalUrl(currentUrl)}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Mở bằng trình duyệt ngoài"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Detected localhost shortcuts */}
        <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
          <span style={{ color: 'var(--muted)' }}>Nhanh:</span>
          {detectedUrls.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => navigateTo(u)}
              className="px-1.5 py-0.5 rounded border font-mono btn-ghost cursor-pointer"
              style={{
                borderColor: currentUrl === u ? 'var(--accent)' : 'var(--border)',
                color: currentUrl === u ? 'var(--accent)' : 'var(--muted)'
              }}
            >
              {u.replace(/^https?:\/\//i, '')}
            </button>
          ))}
        </div>
      </div>

      {/* Sandboxed WebView Body */}
      <div className="flex-1 min-h-0 relative flex justify-center overflow-auto" style={{ backgroundColor: 'var(--bg)' }}>
        <div
          className="h-full transition-all border-x"
          style={{
            width: viewportWidth,
            maxWidth: '100%',
            borderColor: viewport === 'desktop' ? 'transparent' : 'var(--border)'
          }}
        >
          <webview
            ref={webviewRef}
            src={currentUrl}
            className="w-full h-full bg-white"
          />
        </div>

        {loadError && (
          <div
            className="absolute inset-x-4 top-4 p-4 rounded-xl border shadow-xl text-xs space-y-2"
            style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
          >
            <div className="font-semibold" style={{ color: 'var(--warn)' }}>
              Không tải được {currentUrl}
            </div>
            <div style={{ color: 'var(--muted)' }}>
              Chi tiết: {loadError}. Hãy chắc chắn dev server đang chạy (bạn có thể mở tab <strong>Terminal</strong> ngay trong Inspector để chạy <code className="font-mono">npm run dev</code>).
            </div>
            <button
              type="button"
              onClick={() => navigateTo(currentUrl)}
              className="px-2.5 py-1 rounded-lg text-white font-medium cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
