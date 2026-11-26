import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Brain,
  Check,
  CheckCircle2,
  Copy,
  CopyPlus,
  FileCode2,
  GitBranch,
  Paperclip,
  RotateCcw,
  Sparkles,
  Wrench
} from 'lucide-react'
import { PROVIDERS } from '@shared/constants/providers'
import type { AiTurn, ToolCategory } from '@shared/types/ai'
import appAvatar from '../../assets/app-avatar.png'
import { useAiStore } from '../../stores/useAiStore'
import { useGitStore } from '../../stores/useGitStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { MessageMarkdown } from './MessageMarkdown'
import { PlanReviewCard } from './PlanReviewCard'
import { ToolActivityGroup, type ToolActivityItem } from './ToolActivityGroup'

type RenderBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tools'; items: ToolActivityItem[] }
  | { kind: 'handoff'; summary: string; from: string; to: string }
  | { kind: 'plan'; title: string }
  | { kind: 'error'; message: string; hint?: string }
  | { kind: 'complete'; durationMs: number; inputTokens?: number; outputTokens?: number; costUsd?: number; isError: boolean; hint?: string }

function buildTurnBlocks(turn: AiTurn): RenderBlock[] {
  const blocks: RenderBlock[] = []
  const toolIndex = new Map<string, ToolActivityItem>()

  const pushMarkdown = (txt: string): void => {
    const last = blocks[blocks.length - 1]
    if (last && last.kind === 'markdown') {
      last.text += txt
    } else {
      blocks.push({ kind: 'markdown', text: txt })
    }
  }

  const pushThinking = (txt: string): void => {
    const last = blocks[blocks.length - 1]
    if (last && last.kind === 'thinking') {
      last.text += txt
    } else {
      blocks.push({ kind: 'thinking', text: txt })
    }
  }

  const pushToolStart = (callId: string, name: string, category: ToolCategory, summary: string): void => {
    const item: ToolActivityItem = { callId, name, category, summary }
    toolIndex.set(callId, item)
    const last = blocks[blocks.length - 1]
    if (last && last.kind === 'tools') {
      last.items.push(item)
    } else {
      blocks.push({ kind: 'tools', items: [item] })
    }
  }

  for (const stored of turn.events) {
    const e = stored.event
    switch (e.type) {
      case 'handoff':
        blocks.push({
          kind: 'handoff',
          from: PROVIDERS[e.fromProvider].shortName,
          to: PROVIDERS[e.toProvider].shortName,
          summary: e.summary
        })
        break
      case 'thinking.delta':
        pushThinking(e.text)
        break
      case 'text.delta':
        pushMarkdown(e.text)
        break
      case 'tool.start':
        pushToolStart(e.callId, e.name, e.category, e.summary)
        break
      case 'tool.result': {
        const hit = toolIndex.get(e.callId)
        if (hit) {
          hit.ok = e.ok
          hit.output = e.output
        }
        break
      }
      case 'plan.proposed':
        blocks.push({ kind: 'plan', title: e.title })
        break
      case 'error':
        blocks.push({ kind: 'error', message: e.message, hint: e.hint })
        break
      case 'turn.complete':
        blocks.push({
          kind: 'complete',
          durationMs: e.durationMs,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          costUsd: e.costUsd,
          isError: e.isError,
          hint: e.errorHint
        })
        break
      default:
        break
    }
  }

  return blocks
}

function getTurnPlainText(turn: AiTurn): string {
  return turn.events
    .filter((ev) => ev.event.type === 'text.delta')
    .map((ev) => (ev.event.type === 'text.delta' ? ev.event.text : ''))
    .join('')
    .trim()
}

function RunningElapsedLabel({ startIso, providerName }: { startIso: string; providerName: string }): React.JSX.Element {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const startMs = new Date(startIso).getTime() || Date.now()
    const tick = (): void => setSec(Math.max(0, (Date.now() - startMs) / 1000))
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [startIso])

  return (
    <div className="flex items-center gap-2 text-xs pt-1" style={{ color: 'var(--info)' }}>
      <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: 'var(--info)' }} />
      <span>
        {providerName} đang xử lý… ({sec.toFixed(1)}s)
      </span>
    </div>
  )
}

const QUICK_STARTERS = [
  {
    icon: Sparkles,
    title: 'Phân tích kiến trúc dự án',
    prompt: 'Hãy khảo sát nhanh cấu trúc thư mục, tech stack và các module chính của dự án này.'
  },
  {
    icon: GitBranch,
    title: 'Review thay đổi Git hiện tại',
    prompt: 'Hãy kiểm tra git diff hiện tại, tìm bug tiềm ẩn, edge cases và đề xuất cải thiện.'
  },
  {
    icon: FileCode2,
    title: 'Tạo / chuẩn hóa AGENTS.md',
    prompt: 'Hãy khảo sát dự án và đề xuất nội dung file AGENTS.md chuẩn xác cho các AI agent làm việc nhất quán.'
  },
  {
    icon: Wrench,
    title: 'Tìm & sửa lỗi nhanh',
    prompt: 'Hãy kiểm tra lỗi build/typecheck/test trong dự án và đề xuất hướng sửa triệt để.'
  }
]

export function ChatTimeline(): React.JSX.Element {
  const detail = useAiStore((s) => s.activeDetail)
  const sendPrompt = useAiStore((s) => s.sendPrompt)
  const forkSession = useAiStore((s) => s.forkSession)
  const setDraft = useAiStore((s) => s.setDraft)
  const setInspectorOpen = useAiStore((s) => s.setInspectorOpen)
  const setInspectorTab = useAiStore((s) => s.setInspectorTab)
  const setSelectedTurnForDiff = useAiStore((s) => s.setSelectedTurnForDiff)
  const selectSession = useAiStore((s) => s.selectSession)
  const refreshWorking = useGitStore((s) => s.refreshWorking)
  const showToast = useSettingsStore((s) => s.showToast)

  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const turns = detail?.turns ?? []
  const session = detail?.session

  const renderedTurns = useMemo(
    () => turns.map((t) => ({ turn: t, blocks: buildTurnBlocks(t) })),
    [turns]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, turns[turns.length - 1]?.events.length])

  if (!session) return <div className="flex-1" />

  const workDir = session.worktreePath || session.workspacePath

  const handleRestoreTurn = async (turnId: string, turnIndex: number): Promise<void> => {
    try {
      await window.workspaceApi.restoreTurnCheckpoint(session.id, turnId)
      await refreshWorking(workDir)
      await selectSession(session.id)
      showToast(`Đã khôi phục toàn bộ code về trước lượt #${turnIndex}`, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Khôi phục checkpoint thất bại', 'err')
    }
  }

  const handleApprovePlan = async (): Promise<void> => {
    await sendPrompt({
      sessionId: session.id,
      prompt: 'Kế hoạch đã được duyệt. Hãy triển khai đầy đủ theo đúng kế hoạch vừa đề xuất và kiểm tra lại kết quả.',
      permissionMode: 'edit'
    })
  }

  const handleCopyReply = (turn: AiTurn): void => {
    const txt = getTurnPlainText(turn)
    if (!txt) return
    void navigator.clipboard.writeText(txt)
    setCopiedTurnId(turn.id)
    setTimeout(() => setCopiedTurnId((cur) => (cur === turn.id ? null : cur)), 1500)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-3xl mx-auto space-y-6">
        {renderedTurns.length === 0 && (
          <div className="py-10 text-center space-y-5">
            <img
              src={appAvatar}
              alt="AI Coding Tool"
              className="w-14 h-14 rounded-2xl mx-auto shadow-lg"
            />
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">
                AI Coding Tool · {PROVIDERS[session.provider].name}
              </h2>
              <p className="text-xs max-w-md mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>
                Gõ <code className="px-1 py-0.5 rounded bg-subtle">@</code> để đính kèm file/diff,{' '}
                <code className="px-1 py-0.5 rounded bg-subtle">/</code> để dùng Skill &amp; Prompt mẫu, hoặc{' '}
                <code className="px-1 py-0.5 rounded bg-subtle">Ctrl+V</code> dán ảnh lỗi UI. Đổi qua lại Claude, Codex, AGY, Gemini bất cứ lúc nào giữ 100% ngữ cảnh.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl mx-auto text-left pt-2">
              {QUICK_STARTERS.map((q) => {
                const Icon = q.icon
                return (
                  <button
                    key={q.title}
                    type="button"
                    onClick={() => setDraft(session.id, q.prompt)}
                    className="p-3 rounded-xl border btn-ghost transition-colors cursor-pointer space-y-1"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                      <span>{q.title}</span>
                    </div>
                    <div className="text-[11px] line-clamp-2" style={{ color: 'var(--muted)' }}>
                      {q.prompt}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {renderedTurns.map(({ turn, blocks }) => {
          const provMeta = PROVIDERS[turn.provider]
          const hasText = Boolean(getTurnPlainText(turn))
          return (
            <div key={turn.id} className="space-y-3 group/turn">
              {/* User Bubble */}
              <div className="flex justify-end">
                <div
                  className="max-w-[85%] rounded-2xl px-4 py-2.5 border text-[13.5px] leading-relaxed whitespace-pre-wrap"
                  style={{
                    backgroundColor: 'var(--sel)',
                    borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border))'
                  }}
                >
                  <div>{turn.userPrompt}</div>
                  {turn.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {turn.attachments.map((att) => (
                        <span
                          key={att.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border"
                          style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--muted)' }}
                        >
                          <Paperclip className="w-3 h-3" />
                          {att.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Assistant Response */}
              <div className="space-y-2 pl-1">
                <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--muted)' }}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: provMeta.color }} />
                    <span className="font-semibold" style={{ color: 'var(--text)' }}>
                      {provMeta.name}
                    </span>
                    <span>· Lượt #{turn.turnIndex}</span>
                    {turn.model && <span>· {turn.model}</span>}
                  </div>

                  {turn.status !== 'running' && (
                    <div className="flex items-center gap-2.5">
                      {hasText && (
                        <button
                          type="button"
                          onClick={() => handleCopyReply(turn)}
                          className="inline-flex items-center gap-1 hover:underline cursor-pointer opacity-80 hover:opacity-100"
                          title="Sao chép câu trả lời"
                        >
                          {copiedTurnId === turn.id ? <Check className="w-3 h-3" style={{ color: 'var(--ok)' }} /> : <Copy className="w-3 h-3" />}
                          <span>{copiedTurnId === turn.id ? 'Đã chép' : 'Chép'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void forkSession(session.id, turn.turnIndex)}
                        className="inline-flex items-center gap-1 hover:underline cursor-pointer opacity-80 hover:opacity-100"
                        title="Rẽ nhánh thành phiên mới từ lượt này"
                      >
                        <CopyPlus className="w-3 h-3" />
                        <span>Fork</span>
                      </button>
                      {turn.preTreeHash && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTurnForDiff(turn.id)
                              setInspectorTab('changes')
                              setInspectorOpen(true)
                            }}
                            className="inline-flex items-center gap-1 hover:underline cursor-pointer"
                            style={{ color: 'var(--info)' }}
                          >
                            <FileCode2 className="w-3 h-3" />
                            <span>Xem Diff</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRestoreTurn(turn.id, turn.turnIndex)}
                            className="inline-flex items-center gap-1 hover:underline cursor-pointer"
                            style={{ color: 'var(--warn)' }}
                            title="Hoàn tác toàn bộ thay đổi code của lượt này"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Hoàn tác lượt</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {blocks.map((blk, i) => {
                  if (blk.kind === 'handoff') {
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
                        style={{
                          backgroundColor: 'var(--accent-soft)',
                          borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
                          color: 'var(--text)'
                        }}
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                        <span>
                          <strong>{blk.from} → {blk.to}:</strong> {blk.summary}
                        </span>
                      </div>
                    )
                  }
                  if (blk.kind === 'thinking') {
                    return (
                      <details
                        key={i}
                        className="rounded-lg border px-3 py-1.5 text-xs"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                      >
                        <summary className="cursor-pointer flex items-center gap-1.5 font-medium" style={{ color: 'var(--muted)' }}>
                          <Brain className="w-3.5 h-3.5" />
                          <span>Quá trình suy nghĩ / Ghi chú</span>
                        </summary>
                        <div className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                          {blk.text}
                        </div>
                      </details>
                    )
                  }
                  if (blk.kind === 'tools') {
                    return <ToolActivityGroup key={i} items={blk.items} />
                  }
                  if (blk.kind === 'markdown') {
                    return <MessageMarkdown key={i} content={blk.text} />
                  }
                  if (blk.kind === 'plan') {
                    return (
                      <PlanReviewCard
                        key={i}
                        title={blk.title}
                        disabled={session.status === 'running'}
                        onApproveAndExecute={() => void handleApprovePlan()}
                      />
                    )
                  }
                  if (blk.kind === 'error') {
                    return (
                      <div
                        key={i}
                        className="rounded-lg border px-3.5 py-2.5 text-xs space-y-1"
                        style={{ backgroundColor: 'var(--err-bg)', borderColor: 'var(--err)', color: 'var(--err)' }}
                      >
                        <div className="flex items-start gap-2 font-medium whitespace-pre-wrap">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{blk.message}</span>
                        </div>
                        {blk.hint && (
                          <div className="pl-6 text-[11.5px]" style={{ color: 'var(--text)' }}>
                            Gợi ý: {blk.hint}
                          </div>
                        )}
                      </div>
                    )
                  }
                  if (blk.kind === 'complete') {
                    const sec = blk.durationMs > 0 ? `${(blk.durationMs / 1000).toFixed(1)}s` : null
                    const tok =
                      blk.inputTokens || blk.outputTokens
                        ? `${(blk.inputTokens ?? 0).toLocaleString()} in / ${(blk.outputTokens ?? 0).toLocaleString()} out`
                        : null
                    const cost = blk.costUsd ? `$${blk.costUsd.toFixed(4)}` : null
                    const stats = [sec, tok, cost].filter(Boolean).join(' · ')
                    return (
                      <div key={i} className="space-y-1 pt-1">
                        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: blk.isError ? 'var(--err)' : 'var(--muted)' }}>
                          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: blk.isError ? 'var(--err)' : 'var(--ok)' }} />
                          <span>{blk.isError ? 'Kết thúc với lỗi' : 'Hoàn thành'}</span>
                          {stats && <span>· {stats}</span>}
                        </div>
                        {blk.hint && (
                          <div className="text-[11.5px] pl-5" style={{ color: 'var(--warn)' }}>
                            {blk.hint}
                          </div>
                        )}
                      </div>
                    )
                  }
                  return null
                })}

                {turn.status === 'running' && (
                  <RunningElapsedLabel startIso={turn.createdAt} providerName={provMeta.name} />
                )}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
