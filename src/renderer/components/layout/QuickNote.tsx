import { Children, createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bold, Eye, Italic, List, ListChecks, Pencil, Pin, PinOff, StickyNote, WrapText, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { continueNoteList, formatNote, insertNoteList, loadNoteEditor, readNoteEditor, taskPrefix } from './note-editor'

const storageKey = 'multi-agent-studio.quick-note'
const iconButton = 'app-no-drag btn-ghost inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent)]'
const taskContext = createContext<{ lines: string[]; toggleTask: (line: number, checked: boolean) => void } | null>(null)

interface Note {
  text: string
  wrap: boolean
}

const emptyNote: Note = { text: '', wrap: true }
const defaultSize = { width: 280, height: 420 }

function readNote(): Note {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<Note> | null
    if (saved && typeof saved.text === 'string') {
      return {
        text: saved.text,
        wrap: saved.wrap !== false
      }
    }
  } catch {
    // The editor can still be used if local storage is unavailable.
  }
  return emptyNote
}

function NoteButton({ label, pressed, keepSelection, onClick, children }: {
  label: string
  pressed?: boolean
  keepSelection?: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={iconButton}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onPointerDown={keepSelection ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function NoteListItem({ node, children, ...props }: ComponentPropsWithoutRef<'li'> & ExtraProps): React.JSX.Element {
  const tasks = useContext(taskContext)
  const line = node?.position?.start.line ?? 0
  const task = props.className?.includes('task-list-item') ? tasks?.lines[line - 1]?.match(taskPrefix) : null
  if (!task || !tasks) return <li {...props}>{children}</li>
  const done = task[2].toLowerCase() === 'x'
  const content = Children.toArray(children).filter((child) => typeof child !== 'string' || child.trim())
  return (
    <li className="list-none">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label={`Hoàn thành mục ở dòng ${line}`}
          className="mt-[3px] size-3.5 shrink-0 accent-[var(--ok)]"
          checked={done}
          onChange={(event) => tasks.toggleTask(line, event.target.checked)}
        />
        <div className={`quick-note-line min-w-0 ${done ? 'text-[var(--ok)] line-through' : ''}`}>{content}</div>
      </div>
    </li>
  )
}

export function QuickNote({ desktop = false }: { desktop?: boolean }): React.JSX.Element {
  const [note, setNote] = useState(readNote)
  const [open, setOpen] = useState(() => desktop || location.hash === '#dock-note')
  const [size, setSize] = useState(defaultSize)
  const [editing, setEditing] = useState(true)
  const [saveFailed, setSaveFailed] = useState(false)
  const [desktopError, setDesktopError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const resizeOrigin = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const { wrap, text } = note
  const update = (patch: Partial<Note>): void => setNote((current) => ({ ...current, ...patch }))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(note))
      setSaveFailed(false)
    } catch {
      setSaveFailed(true)
    }
  }, [note])

  useEffect(() => {
    if (!open || desktop) return
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open, desktop])

  useEffect(() => {
    if (desktop || typeof window.workspaceApi.onNoteDocked !== 'function') return
    return window.workspaceApi.onNoteDocked(() => {
      setNote(readNote())
      setOpen(true)
    })
  }, [desktop])

  useEffect(() => {
    const input = editor.current
    if (!open || !editing || !input) return
    if (!input.hasChildNodes()) {
      loadNoteEditor(input, text)
      input.focus()
    }
  }, [open, editing, text])

  function close(): void {
    if (desktop) {
      void setDesktop('close')
      return
    }
    setOpen(false)
    trigger.current?.focus()
  }

  function saveEditor(): void {
    const input = editor.current
    if (input) update({ text: readNoteEditor(input) })
  }

  function format(style: 'bold' | 'italic'): void {
    const input = editor.current
    if (!input) return
    formatNote(input, style)
    saveEditor()
  }

  function insertList(prefix: string): void {
    const input = editor.current
    if (!input) return
    insertNoteList(input, prefix)
    saveEditor()
  }

  function toggleTask(lineNumber: number, checked: boolean): void {
    setNote((current) => {
      const lines = current.text.split('\n')
      const i = lineNumber - 1
      if (!taskPrefix.test(lines[i] ?? '')) return current
      lines[i] = lines[i].replace(taskPrefix, (_match, before) => before + (checked ? '[x]' : '[ ]'))
      return { ...current, text: lines.join('\n') }
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
    const key = event.key.toLowerCase()
    const input = editor.current
    if (!input || !input.contains(event.target as Node) || event.nativeEvent.isComposing) return
    if ((event.ctrlKey || event.metaKey) && (key === 'b' || key === 'i')) {
      event.preventDefault()
      format(key === 'b' ? 'bold' : 'italic')
    }
    if (key === 'enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && continueNoteList(input)) {
      event.preventDefault()
      saveEditor()
    }
  }

  async function setDesktop(action: 'open' | 'focus' | 'close' | 'dock'): Promise<boolean> {
    setDesktopError('')
    const restartMessage = 'Hãy khởi động lại Multi-Agent Studio để dùng tính năng ghim trên desktop.'
    if (typeof window.workspaceApi.desktopNote !== 'function') {
      if (action !== 'focus') setDesktopError(restartMessage)
      return false
    }
    try {
      return await window.workspaceApi.desktopNote(action)
    } catch (error) {
      if (error instanceof Error && /no handler registered for ['"]note:desktop['"]/i.test(error.message)) {
        if (action !== 'focus') setDesktopError(restartMessage)
      } else {
        console.error('Không thể chuyển cửa sổ ghi chú.', error)
        setDesktopError('Không thể mở hoặc chuyển cửa sổ ghi chú.')
      }
      return false
    }
  }

  function resize(width: number, height: number): void {
    setSize({
      width: Math.max(245, Math.min(window.innerWidth - 24, width)),
      height: Math.max(200, Math.min(window.innerHeight - 60, height))
    })
  }

  return (
    <>
      {!desktop && <button
        ref={trigger}
        type="button"
        className="app-no-drag btn-ghost mr-1 inline-flex h-8 w-9 items-center justify-center rounded text-[var(--muted)] aria-expanded:bg-[var(--accent-soft)] aria-expanded:text-[var(--accent)]"
        aria-label="Ghi chú nhanh"
        aria-controls={open ? 'quick-note' : undefined}
        aria-expanded={open}
        title="Ghi chú nhanh"
        onClick={async () => {
          if (open) {
            close()
          } else if (!(await setDesktop('focus'))) {
            if (!saveFailed) setNote(readNote())
            setOpen(true)
          }
        }}
      >
        <StickyNote className="h-4 w-4" aria-hidden="true" />
      </button>}
      {open && createPortal(
        <section
          ref={panel}
          id="quick-note"
          aria-label="Ghi chú nhanh"
          onKeyDown={handleKeyDown}
          className={`fixed z-[125] flex flex-col overflow-hidden border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text)] ${desktop ? 'inset-0' : 'app-no-drag right-3 top-12 max-h-[calc(100vh-3.75rem)] max-w-[calc(100vw-1.5rem)] rounded-xl shadow-2xl'}`}
          style={desktop ? undefined : size}
        >
          <header className={`flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-2 py-1 ${desktop ? 'app-drag select-none' : ''}`}>
            <StickyNote className="ml-1 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <h2 className="mr-auto truncate text-xs font-semibold">Ghi chú nhanh</h2>
            <NoteButton
              label={desktop ? 'Đưa ghi chú về app' : 'Ghim ghi chú trên desktop'}
              pressed={desktop}
              onClick={() => {
                if (desktop) void setDesktop('dock')
                else void setDesktop('open').then((shown) => { if (shown) setOpen(false) })
              }}
            >
              {desktop ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
            </NoteButton>
            <NoteButton label="Đóng ghi chú" onClick={close}><X className="h-4 w-4" aria-hidden="true" /></NoteButton>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
            {editing && (
              <>
                <NoteButton label="In đậm (Ctrl+B)" keepSelection onClick={() => format('bold')}><Bold className="h-4 w-4" aria-hidden="true" /></NoteButton>
                <NoteButton label="In nghiêng (Ctrl+I)" keepSelection onClick={() => format('italic')}><Italic className="h-4 w-4" aria-hidden="true" /></NoteButton>
                <NoteButton label="Gạch đầu dòng" keepSelection onClick={() => insertList('- ')}><List className="h-4 w-4" aria-hidden="true" /></NoteButton>
                <NoteButton label="Thêm mục checklist" keepSelection onClick={() => insertList('☐ ')}><ListChecks className="h-4 w-4" aria-hidden="true" /></NoteButton>
              </>
            )}
            <NoteButton label={wrap ? 'Tắt xuống dòng tự động' : 'Bật xuống dòng tự động'} pressed={wrap} onClick={() => update({ wrap: !wrap })}>
              <WrapText className="h-4 w-4" aria-hidden="true" />
            </NoteButton>
            <div role="group" aria-label="Chế độ ghi chú" className="ml-auto flex rounded border border-[var(--border)] p-0.5">
              <NoteButton label="Sửa" pressed={editing} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </NoteButton>
              <NoteButton label="Xem" pressed={!editing} onClick={() => setEditing(false)}>
                <Eye className="h-4 w-4" aria-hidden="true" />
              </NoteButton>
            </div>
          </div>
          {editing ? (
            <div
              key="editor"
              ref={editor}
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label="Nội dung ghi chú"
              data-empty={!text}
              className={`relative min-h-0 flex-1 overflow-auto p-3 text-sm leading-relaxed outline-none data-[empty=true]:before:pointer-events-none data-[empty=true]:before:absolute data-[empty=true]:before:text-[var(--muted)] data-[empty=true]:before:content-['Nhập_ghi_chú…'] ${wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'}`}
              onInput={saveEditor}
              onPaste={(event) => {
                event.preventDefault()
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
              }}
              onDrop={(event) => event.preventDefault()}
            />
          ) : (
            <div key="preview" data-wrap={wrap} className="quick-note-preview min-h-0 flex-1 overflow-auto px-3 py-2 text-sm leading-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul:has(>.list-none)]:pl-0">
              {!text.trim() && <p className="text-[var(--muted)]">Chưa có ghi chú.</p>}
              <taskContext.Provider value={{ lines: text.split('\n'), toggleTask }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  allowedElements={['p', 'strong', 'em', 's', 'ul', 'ol', 'li', 'input', 'br', 'code', 'pre']}
                  unwrapDisallowed
                  components={{ input: () => null, li: NoteListItem }}
                >{text}</ReactMarkdown>
              </taskContext.Provider>
            </div>
          )}
          {saveFailed && <p role="status" className="px-3 pb-2 pl-6 text-xs text-[var(--warn)]">Không thể lưu ghi chú trên thiết bị.</p>}
          {desktopError && <p role="alert" className="px-3 pb-2 pl-6 text-xs text-[var(--err)]">{desktopError}</p>}
          {!desktop && (
            <button
              type="button"
              aria-label="Đổi kích thước ghi chú"
              title="Kéo hoặc dùng phím mũi tên để đổi kích thước"
              className="absolute bottom-0 left-0 grid size-5 cursor-nesw-resize touch-none place-items-center text-[var(--muted)]"
              onPointerDown={(event) => {
                if (event.button !== 0 || !panel.current) return
                const { width, height } = panel.current.getBoundingClientRect()
                resizeOrigin.current = { x: event.clientX, y: event.clientY, width, height }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const origin = resizeOrigin.current
                if (!origin) return
                resize(origin.width + origin.x - event.clientX, origin.height + event.clientY - origin.y)
              }}
              onLostPointerCapture={() => { resizeOrigin.current = null }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                const width = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
                const height = event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0
                resize(size.width + width, size.height + height)
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4 8 10M2 7 5 10" fill="none" stroke="currentColor" strokeLinecap="round" /></svg>
            </button>
          )}
        </section>,
        document.body
      )}
    </>
  )
}
