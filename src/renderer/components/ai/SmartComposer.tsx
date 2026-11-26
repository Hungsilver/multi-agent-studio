import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowUp,
  Brain,
  Cpu,
  FileText,
  GitBranch,
  GitCompare,
  Image as ImageIcon,
  Paperclip,
  Shield,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiAttachment, EffortLevel, PermissionMode } from '@shared/types/ai'
import { useAiStore } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useGovernanceStore } from '../../stores/useGovernanceStore'
import { getModelsForProvider, useSettingsStore } from '../../stores/useSettingsStore'

const MODE_LABELS: Record<PermissionMode, { label: string; desc: string }> = {
  plan: { label: 'Chỉ đọc (Plan)', desc: 'Phân tích & lập kế hoạch, không sửa file' },
  edit: { label: 'Cho sửa file', desc: 'Tự sửa code trong workspace, hỏi trước lệnh nguy hiểm' },
  full: { label: 'Toàn quyền', desc: 'Sửa file và chạy mọi lệnh không cần xác nhận' }
}

type AtOption = { id: string; kind: 'diff' | 'file'; label: string; value: string }
type SlashOption = { id: string; kind: 'template' | 'skill'; cmd: string; title: string; body: string }

export function SmartComposer(): React.JSX.Element | null {
  const detail = useAiStore((s) => s.activeDetail)
  const draftBySession = useAiStore((s) => s.draftBySession)
  const setDraft = useAiStore((s) => s.setDraft)
  const sendPrompt = useAiStore((s) => s.sendPrompt)
  const stopRun = useAiStore((s) => s.stopRun)
  const updateSessionMeta = useAiStore((s) => s.updateSessionMeta)
  const updateMemory = useAiStore((s) => s.updateMemory)
  const setInspectorOpen = useAiStore((s) => s.setInspectorOpen)
  const setInspectorTab = useAiStore((s) => s.setInspectorTab)

  const gitSummary = useGitStore((s) => s.summary)
  const cliStatuses = useSettingsStore((s) => s.cliStatuses)
  const showToast = useSettingsStore((s) => s.showToast)

  const skills = useGovernanceStore((s) => s.skills)
  const templates = useGovernanceStore((s) => s.templates)

  const [attachments, setAttachments] = useState<AiAttachment[]>([])
  const [atMenuOpen, setAtMenuOpen] = useState(false)
  const [atQuery, setAtQuery] = useState('')
  const [atFiles, setAtFiles] = useState<string[]>([])
  const [atSelectedIdx, setAtSelectedIdx] = useState(0)

  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0)

  const [sending, setSending] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const session = detail?.session
  const memory = detail?.memory
  const turns = detail?.turns ?? []
  const providerStates = detail?.providerStates ?? []
  const prompt = session ? draftBySession[session.id] ?? '' : ''
  const workDir = session ? session.worktreePath || session.workspacePath : ''

  const models = useMemo(
    () => (session ? getModelsForProvider(cliStatuses, session.provider) : []),
    [cliStatuses, session]
  )

  const unsyncedCount = useMemo(() => {
    if (!session || turns.length === 0) return 0
    const completed = turns.filter((t) => t.status === 'completed')
    const lastCompleted = completed[completed.length - 1]
    if (!lastCompleted || lastCompleted.provider === session.provider) return 0
    const synced = providerStates.find((x) => x.provider === session.provider)?.lastSyncedTurnIndex ?? 0
    return Math.max(0, lastCompleted.turnIndex - synced)
  }, [session, turns, providerStates])

  const modelLocksEffort = session ? /-(low|medium|high|xhigh|max)$/i.test(session.model.trim()) : false

  // Auto-resize textarea smoothly
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(180, Math.max(48, el.scrollHeight))}px`
  }, [prompt])

  // Close popovers on click outside
  useEffect(() => {
    const onDocDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAtMenuOpen(false)
        setSlashMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  useEffect(() => {
    if (!atMenuOpen || !workDir) return
    let cancelled = false
    void window.workspaceApi.searchWorkspaceFiles(workDir, atQuery).then((res) => {
      if (!cancelled) {
        setAtFiles(res)
        setAtSelectedIdx(0)
      }
    })
    return () => {
      cancelled = true
    }
  }, [atMenuOpen, atQuery, workDir])

  const atOptions = useMemo<AtOption[]>(() => {
    const opts: AtOption[] = []
    if (!atQuery || 'git-diff'.includes(atQuery.toLowerCase())) {
      opts.push({ id: 'diff', kind: 'diff', label: '@git-diff — Đính kèm thay đổi chưa commit', value: 'git-diff' })
    }
    for (const f of atFiles) {
      opts.push({ id: `file:${f}`, kind: 'file', label: f, value: f })
    }
    return opts
  }, [atQuery, atFiles])

  const slashOptions = useMemo<SlashOption[]>(() => {
    const tpls: SlashOption[] = templates
      .filter((t) => !slashQuery || t.slashCmd.toLowerCase().includes(slashQuery) || t.title.toLowerCase().includes(slashQuery))
      .map((t) => ({ id: t.id, kind: 'template', cmd: t.slashCmd, title: t.title, body: t.body }))
    const sks: SlashOption[] = skills
      .filter((s) => !slashQuery || s.name.toLowerCase().includes(slashQuery) || s.description.toLowerCase().includes(slashQuery))
      .map((s) => ({ id: s.id, kind: 'skill', cmd: `/${s.name}`, title: s.description, body: s.name }))
    return [...tpls, ...sks]
  }, [templates, skills, slashQuery])

  if (!session || !memory) return null

  const provMeta = PROVIDERS[session.provider]
  const isRunning = session.status === 'running'

  const handleTextChange = (val: string): void => {
    setDraft(session.id, val)

    const atMatch = val.match(/(?:^|\s)@([^\s@]*)$/)
    if (atMatch) {
      setAtQuery(atMatch[1])
      setAtMenuOpen(true)
      setSlashMenuOpen(false)
      setAtSelectedIdx(0)
      return
    }
    setAtMenuOpen(false)

    const slashMatch = val.match(/^\/([^\s]*)$/)
    if (slashMatch) {
      setSlashQuery(slashMatch[1].toLowerCase())
      setSlashMenuOpen(true)
      setSlashSelectedIdx(0)
    } else {
      setSlashMenuOpen(false)
    }
  }

  const pickAtOption = (opt: AtOption): void => {
    if (opt.kind === 'diff') {
      const cleaned = prompt.replace(/(?:^|\s)@([^\s@]*)$/, '')
      setDraft(session.id, cleaned)
      if (!attachments.some((a) => a.type === 'diff')) {
        setAttachments((prev) => [...prev, { id: 'git-diff', type: 'diff', label: 'git diff HEAD' }])
      }
    } else {
      const cleaned = prompt.replace(/(?:^|\s)@([^\s@]*)$/, (m) => (m.startsWith(' ') ? ' ' : ''))
      setDraft(session.id, `${cleaned}@${opt.value} `)
      if (!attachments.some((a) => a.type === 'file' && a.path === opt.value)) {
        setAttachments((prev) => [...prev, { id: `file-${opt.value}`, type: 'file', label: opt.value, path: opt.value }])
      }
    }
    setAtMenuOpen(false)
    textareaRef.current?.focus()
  }

  const pickSlashOption = async (opt: SlashOption): Promise<void> => {
    if (opt.kind === 'template') {
      setDraft(session.id, `${opt.body}\n\n`)
    } else {
      if (!memory.activeSkillIds.includes(opt.id)) {
        await updateMemory(session.id, { activeSkillIds: [...memory.activeSkillIds, opt.id] })
      }
      setDraft(session.id, '')
      showToast(`Đã bật Skill "${opt.body}" cho phiên này`, 'ok')
    }
    setSlashMenuOpen(false)
    textareaRef.current?.focus()
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((it) => it.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      if (typeof reader.result !== 'string') return
      try {
        const saved = await window.workspaceApi.saveClipboardImage(session.id, reader.result)
        setAttachments((prev) => [...prev, saved])
        showToast(`Đã đính kèm ảnh ${saved.label}`, 'ok')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Lỗi lưu ảnh', 'err')
      }
    }
    reader.readAsDataURL(file)
  }

  const handleSend = async (): Promise<void> => {
    const text = prompt.trim()
    if ((!text && attachments.length === 0) || isRunning || sending) return
    if (session.permissionMode === 'full') {
      const ok = window.confirm(
        `Chế độ Toàn quyền: ${provMeta.name} được phép sửa file và chạy mọi lệnh shell trong\n${workDir}\n\nTiếp tục?`
      )
      if (!ok) return
    }
    setSending(true)
    try {
      const toSend = [...attachments]
      setDraft(session.id, '')
      setAttachments([])
      await sendPrompt({
        sessionId: session.id,
        prompt: text || 'Hãy kiểm tra các tệp đã đính kèm.',
        attachments: toSend
      })
    } catch (err) {
      setDraft(session.id, text)
      showToast(err instanceof Error ? err.message : 'Không gửi được yêu cầu', 'err')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (atMenuOpen && atOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtSelectedIdx((i) => Math.min(atOptions.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtSelectedIdx((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickAtOption(atOptions[atSelectedIdx] ?? atOptions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtMenuOpen(false)
        return
      }
    }

    if (slashMenuOpen && slashOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIdx((i) => Math.min(slashOptions.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIdx((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        void pickSlashOption(slashOptions[slashSelectedIdx] ?? slashOptions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashMenuOpen(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div ref={containerRef} className="shrink-0 px-6 pb-4 pt-1.5">
      <div className="max-w-3xl mx-auto relative space-y-1.5">
        {/* Live Context Strip */}
        <div className="flex items-center justify-between gap-2 px-2 text-[11px]" style={{ color: 'var(--muted)' }}>
          <div className="flex items-center gap-3 min-w-0">
            {gitSummary?.isRepo && (
              <button
                type="button"
                onClick={() => {
                  setInspectorTab('changes')
                  setInspectorOpen(true)
                }}
                className="inline-flex items-center gap-1 hover:underline cursor-pointer truncate"
              >
                <GitBranch className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                <span className="font-mono">{gitSummary.branch}</span>
                {(gitSummary.addedLines > 0 || gitSummary.deletedLines > 0 || gitSummary.untrackedCount > 0) && (
                  <span style={{ color: 'var(--warn)' }}>
                    +{gitSummary.addedLines}/-{gitSummary.deletedLines}
                    {gitSummary.untrackedCount > 0 ? ` · ${gitSummary.untrackedCount} mới` : ''}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setInspectorTab('memory')
                setInspectorOpen(true)
              }}
              className="inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              <Brain className="w-3 h-3" />
              <span>
                Memory: {memory.decisions.length} quyết định · {memory.activeSkillIds.length} skill
              </span>
            </button>
          </div>

          {unsyncedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium shrink-0"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <ArrowLeftRight className="w-3 h-3" />
              Sẽ đồng bộ {unsyncedCount} lượt → {provMeta.shortName}
            </span>
          )}
        </div>

        {/* @file / @diff Popover */}
        {atMenuOpen && (
          <div
            className="absolute bottom-full left-0 mb-2 w-[420px] max-h-64 overflow-y-auto rounded-xl border shadow-2xl p-1.5 z-30"
            style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
          >
            <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide flex items-center justify-between" style={{ color: 'var(--muted)' }}>
              <span>Đính kèm ngữ cảnh (@)</span>
              <span>↑↓ chọn · Enter/Tab chèn</span>
            </div>
            {atOptions.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => pickAtOption(opt)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer text-left truncate"
                style={{
                  backgroundColor: idx === atSelectedIdx ? 'var(--sel)' : 'transparent',
                  color: opt.kind === 'diff' ? 'var(--info)' : 'var(--text)'
                }}
              >
                {opt.kind === 'diff' ? (
                  <GitCompare className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                )}
                <span className="truncate font-mono text-[11.5px]">{opt.label}</span>
              </button>
            ))}
            {atOptions.length === 0 && (
              <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                Không tìm thấy file khớp.
              </div>
            )}
          </div>
        )}

        {/* /slash Popover */}
        {slashMenuOpen && (
          <div
            className="absolute bottom-full left-0 mb-2 w-[450px] max-h-72 overflow-y-auto rounded-xl border shadow-2xl p-1.5 z-30"
            style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
          >
            {slashOptions.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => void pickSlashOption(opt)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer text-left"
                style={{ backgroundColor: idx === slashSelectedIdx ? 'var(--sel)' : 'transparent' }}
              >
                <span
                  className="inline-flex items-center gap-1 font-mono font-semibold shrink-0"
                  style={{ color: opt.kind === 'skill' ? 'var(--ok)' : 'var(--accent)' }}
                >
                  {opt.kind === 'skill' && <Sparkles className="w-3 h-3" />}
                  {opt.cmd}
                </span>
                <span className="truncate text-[11.5px] flex-1" style={{ color: 'var(--text)' }}>
                  {opt.title}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-subtle shrink-0" style={{ color: 'var(--muted)' }}>
                  {opt.kind === 'skill' ? 'Skill' : 'Mẫu'}
                </span>
              </button>
            ))}
            {slashOptions.length === 0 && (
              <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                Không có lệnh/skill khớp.
              </div>
            )}
          </div>
        )}

        {/* Composer Box */}
        <div
          className="rounded-2xl border p-3 shadow-lg transition-colors"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)'
          }}
        >
          {(attachments.length > 0 || memory.activeSkillIds.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {memory.activeSkillIds.map((sid) => {
                const sk = skills.find((x) => x.id === sid || x.name === sid)
                return (
                  <span
                    key={sid}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border"
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
                      color: 'var(--accent)'
                    }}
                  >
                    <Sparkles className="w-3 h-3" />
                    Skill: {sk?.name ?? sid}
                    <button
                      type="button"
                      onClick={() =>
                        void updateMemory(session.id, {
                          activeSkillIds: memory.activeSkillIds.filter((x) => x !== sid)
                        })
                      }
                      className="hover:opacity-75 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}

              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  {att.type === 'image' ? <ImageIcon className="w-3 h-3" /> : <Paperclip className="w-3 h-3" />}
                  <span className="max-w-[180px] truncate">{att.label}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                    className="hover:opacity-75 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={2}
            value={prompt}
            onChange={(e) => handleTextChange(e.target.value)}
            onPaste={(e) => void handlePaste(e)}
            onKeyDown={handleKeyDown}
            placeholder={`Giao việc cho ${provMeta.name}… (@ đính kèm file/diff · / skill & mẫu · Ctrl+V dán ảnh · Enter gửi)`}
            className="w-full resize-none bg-transparent outline-none text-[13.5px] leading-relaxed overflow-y-auto"
            style={{ color: 'var(--text)', minHeight: '48px', maxHeight: '180px' }}
          />

          <div className="mt-2 pt-2 border-t flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setAtQuery('')
                  setAtMenuOpen((o) => !o)
                  setSlashMenuOpen(false)
                }}
                className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                title="Đính kèm file hoặc git diff (@)"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>

              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}>
                <Shield className="w-3 h-3" style={{ color: session.permissionMode === 'full' ? 'var(--warn)' : 'var(--muted)' }} />
                <select
                  value={session.permissionMode}
                  disabled={isRunning}
                  onChange={(e) => void updateSessionMeta(session.id, { permissionMode: e.target.value as PermissionMode })}
                  className="bg-transparent outline-none text-xs cursor-pointer"
                  style={{ color: 'var(--text)' }}
                  title={MODE_LABELS[session.permissionMode].desc}
                >
                  <option value="plan" style={{ backgroundColor: 'var(--surface)' }}>Chỉ đọc (Plan)</option>
                  <option value="edit" style={{ backgroundColor: 'var(--surface)' }}>Cho sửa file</option>
                  <option value="full" style={{ backgroundColor: 'var(--surface)' }}>Toàn quyền</option>
                </select>
              </div>

              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}>
                <Cpu className="w-3 h-3" style={{ color: 'var(--muted)' }} />
                <select
                  value={session.model}
                  disabled={isRunning}
                  onChange={(e) => void updateSessionMeta(session.id, { model: e.target.value })}
                  className="bg-transparent outline-none text-xs cursor-pointer max-w-[175px]"
                  style={{ color: 'var(--text)' }}
                >
                  <option value="" style={{ backgroundColor: 'var(--surface)' }}>
                    Mặc định (tự động)
                  </option>
                  {models.map((m) => (
                    <option key={m} value={m} style={{ backgroundColor: 'var(--surface)' }}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {provMeta.supportsEffort && !modelLocksEffort && (
                <select
                  value={session.effort}
                  disabled={isRunning}
                  onChange={(e) => void updateSessionMeta(session.id, { effort: e.target.value as EffortLevel })}
                  className="px-2 py-1 rounded-lg border text-xs outline-none cursor-pointer"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)' }}
                  title="Mức suy luận (Reasoning Effort)"
                >
                  <option value="low" style={{ backgroundColor: 'var(--surface)' }}>Effort: Low</option>
                  <option value="medium" style={{ backgroundColor: 'var(--surface)' }}>Effort: Medium</option>
                  <option value="high" style={{ backgroundColor: 'var(--surface)' }}>Effort: High</option>
                  <option value="max" style={{ backgroundColor: 'var(--surface)' }}>Effort: Max</option>
                </select>
              )}
            </div>

            {isRunning ? (
              <button
                type="button"
                onClick={() => void stopRun(session.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer"
                style={{ backgroundColor: 'var(--err)' }}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Dừng</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={sending || (!prompt.trim() && attachments.length === 0)}
                onClick={() => void handleSend()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>Gửi</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
