import { memo, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import { highlightCodeBlock } from '../../lib/shiki-highlighter'
import { useSettingsStore } from '../../stores/useSettingsStore'

function CodeBlock({ className, children }: { className?: string; children: string }): React.JSX.Element {
  const themeName = useSettingsStore((s) => s.settings.theme)
  const isDark = THEMES[themeName]?.isDark ?? true
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const langMatch = /language-([\w-]+)/.exec(className || '')
  const lang = langMatch?.[1] || 'text'
  const code = children.replace(/\n$/, '')

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

export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="prose-ai">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
