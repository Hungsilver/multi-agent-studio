import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Plus, TerminalSquare, X } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useTerminalStore } from '../../stores/useTerminalStore'

function XTermInstance({ ptyId }: { ptyId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const themeName = useSettingsStore((s) => s.settings.theme)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const palette = THEMES[themeName] ?? THEMES.dark
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: 13,
      theme: {
        background: palette.bg,
        foreground: palette.text,
        cursor: palette.text,
        selectionBackground: palette.sel
      }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(el)
    fitAddon.fit()
    window.workspaceApi.resizePty(ptyId, term.cols, term.rows)

    const initialBuf = useTerminalStore.getState().tabs.find((t) => t.id === ptyId)?.buffer ?? ''
    if (initialBuf) {
      term.write(initialBuf)
    }

    // Subscribe directly to PTY stream so buffer truncation never breaks rendering
    const unsubData = window.workspaceApi.onPtyData((p) => {
      if (p.ptyId === ptyId) {
        term.write(p.data)
      }
    })

    const unsubExit = window.workspaceApi.onPtyExit((p) => {
      if (p.ptyId === ptyId) {
        term.write(`\r\n\x1b[90m[Tiến trình đã thoát với mã ${p.exitCode}]\x1b[0m\r\n`)
      }
    })

    const disp = term.onData((data) => {
      window.workspaceApi.writePty(ptyId, data)
    })

    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.workspaceApi.resizePty(ptyId, term.cols, term.rows)
      } catch {
        // ignore
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      disp.dispose()
      unsubData()
      unsubExit()
      term.dispose()
    }
  }, [ptyId, themeName])

  return <div ref={containerRef} className="w-full h-full p-1" />
}

export function EmbeddedTerminalPane({ defaultCwd }: { defaultCwd: string }): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activePtyId = useTerminalStore((s) => s.activePtyId)
  const openShellTab = useTerminalStore((s) => s.openShellTab)
  const setActivePty = useTerminalStore((s) => s.setActivePty)
  const closeTab = useTerminalStore((s) => s.closeTab)

  return (
    <div className="flex flex-col h-full min-h-0 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}>
      {/* Terminal Tab Bar */}
      <div
        className="h-9 shrink-0 px-2 border-b flex items-center gap-1 overflow-x-auto"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        {tabs.map((t) => {
          const active = t.id === activePtyId
          return (
            <div
              key={t.id}
              onClick={() => setActivePty(t.id)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs cursor-pointer shrink-0 btn-ghost"
              style={{
                backgroundColor: active ? 'var(--sel)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)'
              }}
            >
              <TerminalSquare className="w-3.5 h-3.5" />
              <span>{t.title}</span>
              <span className="text-[10px] opacity-60">({t.backend})</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(t.id)
                }}
                className="p-0.5 rounded btn-ghost"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => void openShellTab(defaultCwd, 'PowerShell')}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs btn-ghost cursor-pointer shrink-0"
          style={{ color: 'var(--accent)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Mở PowerShell</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {activePtyId ? (
          <XTermInstance key={activePtyId} ptyId={activePtyId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <p>Chưa có terminal nào đang mở.</p>
            <button
              type="button"
              onClick={() => void openShellTab(defaultCwd, 'PowerShell')}
              className="px-3 py-1.5 rounded-lg text-white font-medium cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              + Khởi chạy PowerShell tại thư mục dự án
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
