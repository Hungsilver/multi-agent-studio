import { useEffect, useMemo, useState } from 'react'
import { Check, Code2, Copy, Download, Eye, Moon, Sun, ZoomIn, ZoomOut } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import { detectMonacoLanguage } from '../../lib/monaco-setup'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { InspectorArtifactPayload } from '../../stores/useWorkspaceTabsStore'
import { MessageMarkdown } from '../ai/MessageMarkdown'
import { MonacoCodeView } from '../common/MonacoCodeView'

interface ArtifactPreviewPanelProps {
  artifact: InspectorArtifactPayload
}

const PREVIEWABLE_LANGS = new Set(['html', 'htm', 'svg', 'mermaid', 'markdown', 'md'])

export function ArtifactPreviewPanel({ artifact }: ArtifactPreviewPanelProps): React.JSX.Element {
  const themeName = useSettingsStore((s) => s.settings.theme)
  const isDark = THEMES[themeName]?.isDark ?? true
  const lang = (artifact.language || 'text').toLowerCase()
  const canPreview = PREVIEWABLE_LANGS.has(lang)

  const [mode, setMode] = useState<'preview' | 'code'>(canPreview ? 'preview' : 'code')
  const [copied, setCopied] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [htmlDarkBg, setHtmlDarkBg] = useState(isDark)
  const [mermaidSvg, setMermaidSvg] = useState<string>('')
  const [mermaidErr, setMermaidErr] = useState<string | null>(null)

  useEffect(() => {
    setMode(PREVIEWABLE_LANGS.has(lang) ? 'preview' : 'code')
    setZoom(100)
  }, [artifact.code, lang])

  useEffect(() => {
    setHtmlDarkBg(isDark)
  }, [isDark])

  const htmlSrcDoc = useMemo(() => {
    if (lang !== 'html' && lang !== 'htm') return ''
    const hasDocShell = /<html[\s>]|<body[\s>]/i.test(artifact.code)
    if (hasDocShell) return artifact.code
    const bg = htmlDarkBg ? '#0E1117' : '#FFFFFF'
    const fg = htmlDarkBg ? '#E6EDF3' : '#0F172A'
    return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:16px;font-family:'Segoe UI',system-ui,sans-serif;background:${bg};color:${fg};}</style></head><body>${artifact.code}</body></html>`
  }, [artifact.code, htmlDarkBg, lang])

  useEffect(() => {
    if (lang !== 'mermaid' || mode !== 'preview') return
    let cancelled = false
    setMermaidErr(null)

    void import('mermaid')
      .then(async (m) => {
        const mermaid = m.default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default'
        })
        const uid = `aict-mmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const res = await mermaid.render(uid, artifact.code)
        if (!cancelled) {
          setMermaidSvg(res.svg)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMermaidErr(err instanceof Error ? err.message : 'Lỗi cú pháp sơ đồ Mermaid')
        }
      })

    return () => {
      cancelled = true
    }
  }, [artifact.code, isDark, lang, mode])

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(artifact.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = (): void => {
    const extMap: Record<string, string> = {
      html: 'html',
      htm: 'html',
      svg: 'svg',
      mermaid: 'mmd',
      markdown: 'md',
      md: 'md',
      typescript: 'ts',
      tsx: 'tsx',
      javascript: 'js',
      jsx: 'jsx',
      python: 'py',
      json: 'json',
      css: 'css'
    }
    const ext = extMap[lang] || 'txt'
    const blob = new Blob([artifact.code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artifact.title.replace(/[^\w.-]+/g, '_')}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="px-2.5 py-1.5 border-b flex items-center justify-between gap-2 text-xs shrink-0 overflow-hidden"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          <span className="font-semibold truncate">{artifact.title}</span>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase shrink-0"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {lang}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canPreview && (
            <div
              className="flex items-center rounded border p-0.5 mr-1"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <button
                type="button"
                onClick={() => setMode('preview')}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer"
                style={{
                  backgroundColor: mode === 'preview' ? 'var(--sel)' : 'transparent',
                  color: mode === 'preview' ? 'var(--text)' : 'var(--muted)'
                }}
              >
                <Eye className="w-3 h-3" />
                <span>Xem trước</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('code')}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer"
                style={{
                  backgroundColor: mode === 'code' ? 'var(--sel)' : 'transparent',
                  color: mode === 'code' ? 'var(--text)' : 'var(--muted)'
                }}
              >
                <Code2 className="w-3 h-3" />
                <span>Code</span>
              </button>
            </div>
          )}

          {(lang === 'html' || lang === 'htm') && mode === 'preview' && (
            <button
              type="button"
              onClick={() => setHtmlDarkBg((d) => !d)}
              className="p-1 rounded btn-ghost cursor-pointer"
              style={{ color: 'var(--muted)' }}
              title={htmlDarkBg ? 'Đổi nền Preview sang Sáng' : 'Đổi nền Preview sang Tối'}
            >
              {htmlDarkBg ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          )}

          {(lang === 'svg' || lang === 'mermaid') && mode === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                className="p-1 rounded btn-ghost cursor-pointer"
                title="Thu nhỏ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10.5px] font-mono w-9 text-center" style={{ color: 'var(--muted)' }}>
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
                className="p-1 rounded btn-ghost cursor-pointer"
                title="Phóng to"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: copied ? 'var(--ok)' : 'var(--muted)' }}
            title="Sao chép mã nguồn"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Tải xuống file"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {mode === 'code' || !canPreview ? (
          <MonacoCodeView
            value={artifact.code}
            language={detectMonacoLanguage(`file.${lang}`)}
            theme={isDark ? 'vs-dark' : 'light'}
            readOnly={true}
            fontSize={12}
          />
        ) : lang === 'html' || lang === 'htm' ? (
          <iframe
            title={artifact.title}
            sandbox="allow-scripts"
            srcDoc={htmlSrcDoc}
            className="w-full h-full border-0"
            style={{ backgroundColor: htmlDarkBg ? '#0E1117' : '#FFFFFF' }}
          />
        ) : lang === 'svg' ? (
          <div className="w-full h-full overflow-auto p-4 flex items-center justify-center">
            <div
              className="w-full flex items-center justify-center"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center' }}
            >
              <iframe
                title={artifact.title}
                sandbox=""
                srcDoc={`<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent;">${artifact.code}</body></html>`}
                className="w-full h-[380px] border-0 bg-transparent"
              />
            </div>
          </div>
        ) : lang === 'mermaid' ? (
          <div className="w-full h-full overflow-auto p-4">
            {mermaidErr ? (
              <div className="p-3 rounded-lg border text-xs" style={{ borderColor: 'var(--err)', color: 'var(--err)' }}>
                {mermaidErr}
              </div>
            ) : (
              <div className="w-full min-h-full flex items-center justify-center">
                <div
                  className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center' }}
                  dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            <MessageMarkdown content={artifact.code} />
          </div>
        )}
      </div>
    </div>
  )
}
