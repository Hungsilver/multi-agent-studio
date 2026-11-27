import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, CheckCircle2, Workflow } from 'lucide-react'
import { PROVIDERS, PROVIDER_LIST } from '@shared/constants/providers'
import type { OrchestratorConfig, ProviderId } from '@shared/types/ai'
import { getDefaultModelForProvider, getModelsForProvider, useSettingsStore } from '../../stores/useSettingsStore'
import { CustomSelect } from '../common/CustomSelect'

const PRESETS: Array<{ label: string; config: Partial<OrchestratorConfig> }> = [
  {
    label: 'AGY Neon → Flash',
    config: {
      plannerProvider: 'agy',
      plannerModel: 'gemini-4-neon-high',
      executorProvider: 'agy',
      executorModel: 'gemini-3.8-flash-high'
    }
  },
  {
    label: 'Claude → Codex',
    config: {
      plannerProvider: 'claude',
      plannerModel: 'opus',
      executorProvider: 'codex',
      executorModel: ''
    }
  },
  {
    label: 'AGY → Claude',
    config: {
      plannerProvider: 'agy',
      plannerModel: 'gemini-pro-orchestrator-neon',
      executorProvider: 'claude',
      executorModel: 'sonnet'
    }
  }
]

export function OrchestratorWidget(): React.JSX.Element {
  const config = useSettingsStore((s) => s.orchestratorConfig)
  const updateConfig = useSettingsStore((s) => s.updateOrchestratorConfig)
  const cliStatuses = useSettingsStore((s) => s.cliStatuses)

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const updatePos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.min(392, window.innerWidth - 20)
    const margin = 10
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left))
    const estimatedHeight = 410
    let top = rect.top - estimatedHeight - 8
    if (top < margin) {
      top = Math.min(window.innerHeight - estimatedHeight - margin, rect.bottom + 8)
    }
    setCoords({ top: Math.max(margin, top), left, width })
  }, [])

  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('aict:close-selects', { detail: 'orchestrator-popover' }))
    updatePos()

    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      // Don't close if clicking an inner CustomSelect portal listbox
      const el = e.target as HTMLElement | null
      if (el?.closest?.('[role="listbox"]')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]')) {
        setOpen(false)
      }
    }
    const onOther = (e: Event): void => {
      const custom = e as CustomEvent<string>
      if (custom.detail !== 'orchestrator-popover' && !custom.detail?.startsWith('orch-select-')) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('aict:close-selects', onOther)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('aict:close-selects', onOther)
    }
  }, [open, updatePos])

  const plannerModels = useMemo(
    () => getModelsForProvider(cliStatuses, config.plannerProvider),
    [cliStatuses, config.plannerProvider]
  )
  const executorModels = useMemo(
    () => getModelsForProvider(cliStatuses, config.executorProvider),
    [cliStatuses, config.executorProvider]
  )
  const plannerDef = getDefaultModelForProvider(cliStatuses, config.plannerProvider)
  const executorDef = getDefaultModelForProvider(cliStatuses, config.executorProvider)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-orchestrator-trigger="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors btn-ghost cursor-pointer shrink-0"
        style={{
          backgroundColor: config.enabled ? 'var(--accent-soft)' : 'var(--bg)',
          borderColor: config.enabled || open ? 'var(--accent)' : 'var(--border)',
          color: config.enabled ? 'var(--accent)' : 'var(--text)'
        }}
        title="Cấu hình Orchestrator đa bước (Planner → Executor)"
      >
        <Workflow className="w-3.5 h-3.5 shrink-0" />
        <span>Orchestrator</span>
        {config.enabled && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--ok)' }} />
        )}
      </button>

      {open && coords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Cấu hình Orchestrator"
            data-orchestrator-popover="true"
            className="fixed z-[125] rounded-2xl border shadow-2xl p-4 space-y-3.5 text-xs"
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              backgroundColor: 'var(--surface-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {/* Header & Master Switch */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Workflow className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <div>
                  <div className="font-semibold text-[12.5px]">Chế độ Orchestrator</div>
                  <div className="text-[10.5px]" style={{ color: 'var(--muted)' }}>
                    Tự động điều phối Lập kế hoạch → Thực thi code
                  </div>
                </div>
              </div>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  data-orchestrator-toggle="true"
                  checked={config.enabled}
                  onChange={(e) => updateConfig({ enabled: e.target.checked })}
                />
                <span className="font-semibold" style={{ color: config.enabled ? 'var(--ok)' : 'var(--muted)' }}>
                  {config.enabled ? 'Đang bật' : 'Tắt'}
                </span>
              </label>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1">
              <div className="text-[10.5px] font-medium" style={{ color: 'var(--muted)' }}>
                Cấu hình nhanh:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => updateConfig({ ...p.config, enabled: true })}
                    className="px-2 py-1 rounded-md border text-[10.5px] btn-ghost cursor-pointer"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Role 1: Planner */}
            <div
              className="p-2.5 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span>1. Planner (Khảo sát &amp; Lập kế hoạch)</span>
                <span className="text-[10px] font-normal" style={{ color: 'var(--muted)' }}>Chế độ Plan</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {PROVIDER_LIST.map((p) => {
                  const sel = config.plannerProvider === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => updateConfig({ plannerProvider: p.id as ProviderId, plannerModel: '' })}
                      className="flex items-center justify-center gap-1 py-1 rounded-md border text-[11px] cursor-pointer"
                      style={{
                        borderColor: sel ? p.color : 'var(--border)',
                        backgroundColor: sel ? p.badgeBg : 'transparent',
                        color: sel ? 'var(--text)' : 'var(--muted)'
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                      <span>{p.shortName}</span>
                    </button>
                  )
                })}
              </div>
              <CustomSelect<string>
                eventId="orch-select-planner"
                value={config.plannerModel}
                onChange={(val) => updateConfig({ plannerModel: val })}
                preferredPlacement="bottom"
                className="w-full"
                menuMinWidth={240}
                options={[
                  {
                    value: '',
                    label: plannerDef.model ? `Mặc định (${plannerDef.model})` : 'Mặc định CLI'
                  },
                  ...plannerModels.map((m) => ({
                    value: m,
                    label: m,
                    badge: m.includes('orchestrator') ? 'Orchestrator' : undefined
                  }))
                ]}
              />
            </div>

            {/* Arrow Divider */}
            <div className="flex items-center justify-center -my-1.5">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px]"
                style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                <ArrowRight className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                <span>Chuyển ngữ cảnh sang Executor</span>
              </span>
            </div>

            {/* Role 2: Executor */}
            <div
              className="p-2.5 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span>2. Executor (Triển khai code)</span>
                <span className="text-[10px] font-normal" style={{ color: 'var(--muted)' }}>Cho sửa file</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {PROVIDER_LIST.map((p) => {
                  const sel = config.executorProvider === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => updateConfig({ executorProvider: p.id as ProviderId, executorModel: '' })}
                      className="flex items-center justify-center gap-1 py-1 rounded-md border text-[11px] cursor-pointer"
                      style={{
                        borderColor: sel ? p.color : 'var(--border)',
                        backgroundColor: sel ? p.badgeBg : 'transparent',
                        color: sel ? 'var(--text)' : 'var(--muted)'
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                      <span>{p.shortName}</span>
                    </button>
                  )
                })}
              </div>
              <CustomSelect<string>
                eventId="orch-select-executor"
                value={config.executorModel}
                onChange={(val) => updateConfig({ executorModel: val })}
                preferredPlacement="bottom"
                className="w-full"
                menuMinWidth={240}
                options={[
                  {
                    value: '',
                    label: executorDef.model ? `Mặc định (${executorDef.model})` : 'Mặc định CLI'
                  },
                  ...executorModels.map((m) => ({
                    value: m,
                    label: m,
                    badge: m.includes('orchestrator') ? 'Orchestrator' : undefined
                  }))
                ]}
              />
            </div>

            {/* Workflow flags */}
            <div className="space-y-1.5 text-[11px]">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Tự động thực thi ngay sau khi Planner lập kế hoạch</span>
                <input
                  type="checkbox"
                  checked={config.autoExecute}
                  onChange={(e) => updateConfig({ autoExecute: e.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Kiểm duyệt lại kết quả bằng Planner sau khi xong</span>
                <input
                  type="checkbox"
                  checked={config.verifyAfterExecute}
                  onChange={(e) => updateConfig({ verifyAfterExecute: e.target.checked })}
                />
              </label>
            </div>

            {config.enabled && (
              <div
                className="flex items-center gap-1.5 text-[10.5px] pt-1 border-t"
                style={{ borderColor: 'var(--border)', color: 'var(--ok)' }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Lượt gửi tiếp theo sẽ chạy qua Orchestrator ({PROVIDERS[config.plannerProvider].shortName} →{' '}
                  {PROVIDERS[config.executorProvider].shortName}).
                </span>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
