import { memo, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Globe, Sparkles } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import { highlightCodeBlock } from '../../lib/shiki-highlighter'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'

const ARTIFACT_PREVIEW_LANGS = new Set(['html', 'htm', 'svg', 'mermaid', 'markdown', 'md', 'jsx', 'tsx'])

function CodeBlock({ className, children }: { className?: string; children: string }): React.JSX.Element {
  const themeName = useSettingsStore((s) => s.settings.theme)
  const isDark = THEMES[themeName]?.isDark ?? true
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const langMatch = /language-([\w-]+)/.exec(className || '')
  const lang = langMatch?.[1] || 'text'
  const code = children.replace(/\n$/, '')
  const lineCount = code.split('\n').length
  const showArtifactBtn = ARTIFACT_PREVIEW_LANGS.has(lang.toLowerCase()) || lineCount >= 8
  const localhostMatch = code.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/[^\s)"'`<>]*)?/i)

  const handleOpenArtifact = (): void => {
    const title =
      lang.toLowerCase() === 'mermaid'
        ? 'Sơ đồ Mermaid'
        : lang.toLowerCase() === 'svg'
          ? 'Hình SVG'
          : lang.toLowerCase() === 'html' || lang.toLowerCase() === 'htm'
            ? 'HTML Artifact'
            : `Artifact (${lang})`
    useWorkspaceTabsStore.getState().openInspectorTab({
      kind: 'artifact',
      title,
      artifact: { language: lang, code, title }
    })
  }

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void highlightCodeBlock(code, lang, isDark)
        .then((res) => {
          if (!cancelled) setHtml(res)
        })
        .catch(() => {
          if (!cancelled) setHtml(null)
        })
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, lang, isDark])

  const onCopy = (): void => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      className="my-2.5 rounded-lg border overflow-hidden text-xs"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b text-[11px]"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--header)', color: 'var(--muted)' }}
      >
        <span className="font-mono uppercase tracking-wider">{lang}</span>
        <div className="flex items-center gap-2.5">
          {localhostMatch && (
            <button
              type="button"
              onClick={() =>
                useWorkspaceTabsStore.getState().openInspectorTab({
                  kind: 'preview',
                  title: 'Live Preview',
                  previewUrl: localhostMatch[0]
                })
              }
              className="flex items-center gap-1 hover:opacity-80 cursor-pointer"
              style={{ color: 'var(--info)' }}
              title={`Mở ${localhostMatch[0]} trong Live Web Preview`}
            >
              <Globe className="w-3 h-3" />
              <span>Preview</span>
            </button>
          )}
          {showArtifactBtn && (
            <button
              type="button"
              onClick={handleOpenArtifact}
              className="flex items-center gap-1 hover:opacity-80 cursor-pointer"
              style={{ color: 'var(--accent)' }}
              title="Mở trong tab Artifact của Inspector"
            >
              <Sparkles className="w-3 h-3" />
              <span>Xem Artifact</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 hover:opacity-80 cursor-pointer"
            style={{ color: copied ? 'var(--ok)' : 'var(--muted)' }}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
          </button>
        </div>
      </div>
      {html ? (
        <div
          className="p-3 overflow-x-auto [&>pre]:!bg-transparent [&>pre]:!m-0 [&>pre]:!p-0 [&_code]:font-mono [&_code]:text-[12.5px]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="p-3 overflow-x-auto font-mono text-[12.5px]" style={{ color: 'var(--text)' }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}

export function openLinkInInspector(href: string | undefined, workspacePath?: string): void {
  if (!href) return
  let decoded = href.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // keep raw href
  }
  if (!decoded || decoded.startsWith('#')) return

  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(decoded)) {
    useWorkspaceTabsStore.getState().openInspectorTab({
      kind: 'preview',
      title: 'Live Preview',
      previewUrl: decoded,
      workspacePath
    })
    return
  }

  if (/^(?:https?:\/\/|mailto:)/i.test(decoded)) {
    void window.workspaceApi.openExternalUrl(decoded)
    return
  }

  // Strip file:// scheme and line anchors (#L10, #L10-L20, :12, :12:4)
  const cleanPath = decoded
    .replace(/^file:\/\//i, '')
    .replace(/^\/([a-zA-Z]:[\\/])/, '$1')
    .replace(/#L?\d+(?:-L?\d+)?$/i, '')
    .replace(/:\d+(?::\d+)?$/, '')

  const normalizedSlash = cleanPath.replace(/\\/g, '/')
  const isAbsWin = /^[a-zA-Z]:\//.test(normalizedSlash) || normalizedSlash.startsWith('//')

  let targetWs = workspacePath || '__external__'
  let targetFile = normalizedSlash

  if (isAbsWin) {
    const wsNorm = workspacePath ? workspacePath.replace(/\\/g, '/').replace(/\/+$/, '') : ''
    if (wsNorm && normalizedSlash.toLowerCase().startsWith(`${wsNorm.toLowerCase()}/`)) {
      targetWs = workspacePath!
      targetFile = normalizedSlash.slice(wsNorm.length + 1)
    } else {
      targetWs = '__external__'
      targetFile = normalizedSlash
    }
  } else {
    targetFile = normalizedSlash.replace(/^\.\//, '').replace(/^\/+/, '')
    if (!targetWs) targetWs = '__external__'
  }

  const fileName = targetFile.split('/').pop() || targetFile
  useWorkspaceTabsStore.getState().openInspectorTab({
    kind: 'file-viewer',
    title: fileName,
    filePath: targetFile,
    workspacePath: targetWs
  })
}

export function safeMarkdownUrlTransform(url: string): string {
  const trimmed = url.trim()
  if (/^(?:javascript|vbscript|data):/i.test(trimmed)) return ''
  return trimmed
}

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  workspacePath
}: {
  content: string
  workspacePath?: string
}): React.JSX.Element {
  return (
    <div className="prose-ai">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeMarkdownUrlTransform}
        components={{
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault()
                  openLinkInInspector(href, workspacePath)
                }}
                className="cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-80"
                style={{ color: 'var(--accent)' }}
                title={href}
                {...props}
              >
                {children}
              </a>
            )
          },
          code({ className, children, ...props }) {
            const text = String(children ?? '')
            const isBlock = Boolean(className) || text.includes('\n')
            if (isBlock) {
              return <CodeBlock className={className}>{text}</CodeBlock>
            }
            return (
              <code
                {...props}
                className="px-1.5 py-0.5 rounded font-mono text-[12px]"
                style={{ backgroundColor: 'var(--surface-elevated)', color: 'var(--info)' }}
              >
                {children}
              </code>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
