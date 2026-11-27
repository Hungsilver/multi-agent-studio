import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  description?: string
  badge?: string
  disabled?: boolean
}

interface CustomSelectProps<T extends string = string> {
  value: T
  options: Array<SelectOption<T>>
  onChange: (value: T) => void
  icon?: React.ReactNode
  placeholder?: string
  disabled?: boolean
  title?: string
  className?: string
  triggerBg?: string
  menuMinWidth?: number
  preferredPlacement?: 'auto' | 'top' | 'bottom'
  align?: 'left' | 'right'
  searchable?: boolean
  ariaLabel?: string
  eventId?: string
}

interface MenuCoords {
  left: number
  top?: number
  bottom?: number
  minWidth: number
  maxHeight: number
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  icon,
  placeholder = 'Chọn...',
  disabled = false,
  title,
  className = '',
  triggerBg = 'var(--bg)',
  menuMinWidth = 180,
  preferredPlacement = 'auto',
  align = 'left',
  searchable,
  ariaLabel,
  eventId
}: CustomSelectProps<T>): React.JSX.Element {
  const instanceId = useId()
  const selectEventId = eventId || instanceId
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [coords, setCoords] = useState<MenuCoords | null>(null)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value])
  const showSearch = searchable ?? options.length >= 8

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q)) ||
        o.value.toLowerCase().includes(q)
    )
  }, [options, query])

  const computePosition = useCallback((): void => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const spaceAbove = rect.top - 10
    const spaceBelow = window.innerHeight - rect.bottom - 10

    let openUp: boolean
    if (preferredPlacement === 'top') {
      openUp = spaceAbove >= 140 || spaceAbove > spaceBelow
    } else if (preferredPlacement === 'bottom') {
      openUp = spaceBelow < 140 && spaceAbove > spaceBelow
    } else {
      openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    }

    const menuWidth = Math.min(window.innerWidth - 16, Math.max(rect.width, menuMinWidth))
    let left = align === 'right' ? rect.right - menuWidth : rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))

    const maxHeight = Math.max(120, Math.min(280, openUp ? spaceAbove : spaceBelow))
    if (openUp) {
      setCoords({
        left,
        bottom: window.innerHeight - rect.top + 6,
        minWidth: menuWidth,
        maxHeight
      })
    } else {
      setCoords({
        left,
        top: rect.bottom + 6,
        minWidth: menuWidth,
        maxHeight
      })
    }
  }, [align, menuMinWidth, preferredPlacement])

  useEffect(() => {
    const onOtherOpen = (e: Event): void => {
      const custom = e as CustomEvent<string>
      if (custom.detail !== selectEventId) {
        setOpen(false)
      }
    }
    window.addEventListener('aict:close-selects', onOtherOpen)
    return () => window.removeEventListener('aict:close-selects', onOtherOpen)
  }, [selectEventId])

  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('aict:close-selects', { detail: selectEventId }))
    computePosition()
    setQuery('')
    const selectedIdx = Math.max(
      0,
      options.findIndex((o) => o.value === value && !o.disabled)
    )
    setHighlightIdx(selectedIdx)

    const timer = setTimeout(() => {
      if (showSearch) searchInputRef.current?.focus()
    }, 20)

    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onResize = (): void => computePosition()
    const onScroll = (e: Event): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      computePosition()
    }

    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, selectEventId, computePosition, options, value, showSearch])

  const commitOption = (opt: SelectOption<T>): void => {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => Math.min(filteredOptions.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filteredOptions[highlightIdx]
      if (opt && !opt.disabled) commitOption(opt)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel || title || selected?.label || placeholder}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed btn-ghost min-w-0 max-w-full ${className}`}
        style={{
          backgroundColor: triggerBg,
          borderColor: open ? 'var(--accent)' : 'var(--border)',
          color: 'var(--text)'
        }}
      >
        <span className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
          {icon && <span className="shrink-0 flex items-center">{icon}</span>}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          style={{ color: open ? 'var(--accent)' : 'var(--muted)' }}
        />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            data-select-menu={selectEventId}
            onKeyDown={handleKeyDown}
            className="fixed z-[160] rounded-xl border shadow-2xl p-1.5 flex flex-col"
            style={{
              left: `${coords.left}px`,
              ...(coords.top !== undefined ? { top: `${coords.top}px` } : {}),
              ...(coords.bottom !== undefined ? { bottom: `${coords.bottom}px` } : {}),
              minWidth: `${coords.minWidth}px`,
              maxWidth: 'min(380px, calc(100vw - 16px))',
              maxHeight: `${coords.maxHeight}px`,
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {showSearch && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 mb-1 rounded-lg border text-xs shrink-0"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setHighlightIdx(0)
                  }}
                  placeholder="Lọc nhanh..."
                  className="w-full bg-transparent outline-none text-xs"
                  style={{ color: 'var(--text)' }}
                />
              </div>
            )}

            <div className="overflow-y-auto space-y-0.5 flex-1">
              {filteredOptions.length === 0 ? (
                <div className="py-3 text-center text-[11px]" style={{ color: 'var(--muted)' }}>
                  Không có lựa chọn phù hợp.
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value
                  const isHighlighted = idx === highlightIdx
                  return (
                    <button
                      key={`${opt.value}-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      onClick={() => commitOption(opt)}
                      className="w-full flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: isSelected
                          ? 'var(--accent-soft)'
                          : isHighlighted
                            ? 'color-mix(in srgb, var(--text) 7%, transparent)'
                            : 'transparent',
                        color: isSelected ? 'var(--accent)' : 'var(--text)'
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`flex items-center gap-1.5 truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                          <span className="truncate">{opt.label}</span>
                          {opt.badge && (
                            <span
                              className="px-1.5 py-0.2 rounded text-[10px] font-mono shrink-0"
                              style={{ backgroundColor: 'var(--bg)', color: 'var(--muted)' }}
                            >
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        {opt.description && (
                          <div className="text-[10.5px] truncate mt-0.5" style={{ color: 'var(--muted)' }}>
                            {opt.description}
                          </div>
                        )}
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
