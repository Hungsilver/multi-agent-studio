import { useState } from 'react'
import { ChevronDown, ChevronRight, FileEdit, FolderSearch, Terminal, Wrench, CheckCircle2, XCircle, Bot } from 'lucide-react'
import type { ToolCategory } from '@shared/types/ai'

export interface ToolActivityItem {
  callId: string
  name: string
  category: ToolCategory
  summary: string
  ok?: boolean
  output?: string
}

function CategoryIcon({ cat }: { cat: ToolCategory }): React.JSX.Element {
  switch (cat) {
    case 'edit':
      return <FileEdit className="w-3.5 h-3.5" style={{ color: 'var(--warn)' }} />
    case 'bash':
      return <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--info)' }} />
    case 'read':
    case 'search':
      return <FolderSearch className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
    case 'agent':
      return <Bot className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
    default:
      return <Wrench className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
  }
}

export function ToolActivityGroup({ items }: { items: ToolActivityItem[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const counts = items.reduce(
    (acc, it) => {
      acc[it.category] = (acc[it.category] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const parts: string[] = []
  if (counts.read) parts.push(`đọc ${counts.read} file`)
  if (counts.search) parts.push(`tìm ${counts.search} lần`)
  if (counts.edit) parts.push(`sửa ${counts.edit} file`)
  if (counts.bash) parts.push(`chạy ${counts.bash} lệnh`)
  if (counts.agent) parts.push(`${counts.agent} subagent`)
  if (counts.mcp) parts.push(`${counts.mcp} MCP`)
  if (counts.other) parts.push(`${counts.other} thao tác`)

  const summaryTitle =
    items.length === 1 && items[0].summary
      ? `${items[0].name}: ${items[0].summary}`
      : parts.join(', ') || `${items.length} thao tác`

  return (
    <div
      className="my-1.5 rounded-lg border text-xs overflow-hidden"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left btn-ghost transition-colors cursor-pointer"
        style={{ color: 'var(--muted)' }}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate font-medium" style={{ color: 'var(--text)' }}>
          {summaryTitle}
        </span>
        <span className="ml-auto text-[11px] shrink-0">{items.length} bước</span>
      </button>

      {open && (
        <div className="border-t divide-y" style={{ borderColor: 'var(--border)' }}>
          {items.map((it, idx) => (
            <div key={`${it.callId}-${idx}`} className="px-3 py-2 space-y-1" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <CategoryIcon cat={it.category} />
                <span className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--text)' }}>
                  {it.name}
                </span>
                {it.summary && (
                  <span className="font-mono text-[11px] truncate" style={{ color: 'var(--muted)' }}>
                    {it.summary}
                  </span>
                )}
                {it.ok === true && <CheckCircle2 className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: 'var(--ok)' }} />}
                {it.ok === false && <XCircle className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: 'var(--err)' }} />}
              </div>
              {it.output && (
                <pre
                  className="text-[11px] font-mono whitespace-pre-wrap break-all p-2 rounded max-h-40 overflow-y-auto"
                  style={{ backgroundColor: 'var(--bg)', color: 'var(--muted)' }}
                >
                  {it.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
