import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { BookOpen, FilePlus2, RefreshCw, Save, Server, Sparkles, Trash2 } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import type { PromptTemplate, RuleFile, SkillItem } from '@shared/types/governance'
import { ensureMonacoSetup } from '../../lib/monaco-setup'
import { useAiStore } from '../../stores/useAiStore'
import { useGovernanceStore } from '../../stores/useGovernanceStore'
import { useSettingsStore } from '../../stores/useSettingsStore'

type GovTab = 'skills' | 'rules' | 'mcp' | 'templates'

const AGENTS_TEMPLATE = `# AGENTS.md

## Tổng quan dự án
- Mô tả ngắn về kiến trúc, tech stack và các module chính.

## Quy tắc code & Kiểm chứng
- Luôn chạy typecheck và unit tests trước khi hoàn tất thay đổi.
- Không sửa các file cấu hình hoặc dữ liệu nhạy cảm nếu không được yêu cầu.
`

export function GovernanceStudio(): React.JSX.Element {
  const workspaces = useSettingsStore((s) => s.workspaces)
  const themeName = useSettingsStore((s) => s.settings.theme)
  const showToast = useSettingsStore((s) => s.showToast)
  const activeDetail = useAiStore((s) => s.activeDetail)

  const skills = useGovernanceStore((s) => s.skills)
  const rules = useGovernanceStore((s) => s.rules)
  const mcpServers = useGovernanceStore((s) => s.mcpServers)
  const templates = useGovernanceStore((s) => s.templates)
  const loadAll = useGovernanceStore((s) => s.loadAll)

  const defaultWs = activeDetail?.session.workspacePath || workspaces[0]?.path || ''
  const [selectedWs, setSelectedWs] = useState(defaultWs)
  const [tab, setTab] = useState<GovTab>('skills')

  // Skill editor state
  const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null)
  const [skName, setSkName] = useState('')
  const [skDesc, setSkDesc] = useState('')
  const [skTags, setSkTags] = useState('')
  const [skScope, setSkScope] = useState<'workspace' | 'global'>('workspace')
  const [skSource, setSkSource] = useState<SkillItem['source']>('agents')
  const [skBody, setSkBody] = useState('')

  // Rule editor state
  const [selectedRule, setSelectedRule] = useState<RuleFile | null>(null)
  const [ruleContent, setRuleContent] = useState('')

  // Template editor state
  const [tplCmd, setTplCmd] = useState('')
  const [tplTitle, setTplTitle] = useState('')
  const [tplBody, setTplBody] = useState('')

  const isDark = THEMES[themeName]?.isDark ?? true

  useEffect(() => {
    ensureMonacoSetup()
  }, [])

  useEffect(() => {
    void loadAll(selectedWs || undefined)
  }, [selectedWs, loadAll])

  const openSkill = (sk: SkillItem): void => {
    setSelectedSkill(sk)
    setSkName(sk.name)
    setSkDesc(sk.description)
    setSkTags(sk.tags.join(', '))
    setSkScope(sk.scope)
    setSkSource(sk.source)
    setSkBody(sk.body)
  }

  const startNewSkill = (): void => {
    setSelectedSkill(null)
    setSkName('')
    setSkDesc('')
    setSkTags('')
    setSkScope(selectedWs ? 'workspace' : 'global')
    setSkSource('agents')
    setSkBody('# Hướng dẫn thực hiện Skill\n\n- Bước 1: ...\n- Bước 2: ...\n')
  }

  const handleSaveSkill = async (): Promise<void> => {
    try {
      const saved = await window.workspaceApi.saveSkill({
        workspacePath: selectedWs || undefined,
        scope: skScope,
        source: skSource,
        name: skName,
        description: skDesc,
        tags: skTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        body: skBody,
        existingFilePath: selectedSkill?.filePath
      })
      await loadAll(selectedWs || undefined)
      openSkill(saved)
      showToast(`Đã lưu Skill "${saved.name}"`, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu Skill', 'err')
    }
  }

  const handleDeleteSkill = async (sk: SkillItem): Promise<void> => {
    if (!window.confirm(`Xóa Skill "${sk.name}" (${sk.filePath})?`)) return
    await window.workspaceApi.deleteSkill(sk.filePath)
    if (selectedSkill?.filePath === sk.filePath) startNewSkill()
    await loadAll(selectedWs || undefined)
    showToast('Đã xóa Skill', 'ok')
  }

  const openRule = (r: RuleFile): void => {
    setSelectedRule(r)
    setRuleContent(r.exists ? r.content : r.name.includes('AGENTS') ? AGENTS_TEMPLATE : '')
  }

  const handleSaveRule = async (): Promise<void> => {
    if (!selectedRule) return
    const saved = await window.workspaceApi.saveRuleFile(selectedRule.filePath, ruleContent)
    await loadAll(selectedWs || undefined)
    setSelectedRule(saved)
    showToast(`Đã lưu ${saved.name}`, 'ok')
  }

  const handleSyncAgents = async (): Promise<void> => {
    if (!selectedWs) return
    try {
      await window.workspaceApi.syncAgentsRule(selectedWs, ['CLAUDE.md', 'GEMINI.md'])
      await loadAll(selectedWs)
      showToast('Đã đồng bộ AGENTS.md → CLAUDE.md & GEMINI.md', 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Đồng bộ thất bại', 'err')
    }
  }

  const handleSaveTemplate = async (): Promise<void> => {
    if (!tplCmd.trim() || !tplBody.trim()) {
      showToast('Nhập slash command và nội dung prompt', 'err')
      return
    }
    const tpl: PromptTemplate = {
      id: `tpl-${Date.now()}`,
      slashCmd: tplCmd.trim(),
      title: tplTitle.trim() || tplCmd.trim(),
      description: '',
      body: tplBody,
      scope: 'global'
    }
    await window.workspaceApi.savePromptTemplate(tpl)
    setTplCmd('')
    setTplTitle('')
    setTplBody('')
    await loadAll(selectedWs || undefined)
    showToast('Đã lưu Prompt Template', 'ok')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Top Bar */}
      <div
        className="h-12 shrink-0 px-5 border-b flex items-center justify-between gap-4"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm font-semibold">Quản lý Skills, AGENTS.md &amp; MCP</h1>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedWs}
            onChange={(e) => setSelectedWs(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border text-xs outline-none max-w-[260px]"
            style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <option value="">Chỉ phạm vi Global</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.path}>
                {w.name} ({w.path})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void loadAll(selectedWs || undefined)}
            className="p-1.5 rounded-lg border btn-ghost cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            title="Tải lại"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-navigation */}
      <div
        className="px-5 py-2 border-b flex items-center gap-2 text-xs"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {(
          [
            { id: 'skills', label: `Skills (${skills.length})`, icon: Sparkles },
            { id: 'rules', label: 'AGENTS.md & Rules', icon: BookOpen },
            { id: 'mcp', label: `MCP Servers (${mcpServers.length})`, icon: Server },
            { id: 'templates', label: `Slash Templates (${templates.length})`, icon: FilePlus2 }
          ] as Array<{ id: GovTab; label: string; icon: typeof Sparkles }>
        ).map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--muted)'
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {tab === 'skills' && (
          <>
            <div className="w-72 shrink-0 border-r flex flex-col min-h-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              <div className="p-2.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs font-semibold">Danh sách SKILL.md</span>
                <button
                  type="button"
                  onClick={startNewSkill}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  + Tạo Skill
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {skills.map((sk) => (
                  <div
                    key={sk.filePath}
                    onClick={() => openSkill(sk)}
                    className="group p-2.5 rounded-lg border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: selectedSkill?.filePath === sk.filePath ? 'var(--sel)' : 'var(--bg)',
                      borderColor: selectedSkill?.filePath === sk.filePath ? 'var(--accent)' : 'var(--border)'
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold truncate">{sk.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDeleteSkill(sk)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:opacity-75 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-[11px] line-clamp-2 mt-0.5" style={{ color: 'var(--muted)' }}>
                      {sk.description}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--muted)' }}>
                      <span className="px-1.5 py-0.5 rounded bg-subtle">{sk.scope}</span>
                      <span className="px-1.5 py-0.5 rounded bg-subtle">{sk.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 min-h-0 p-4 gap-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                <input
                  value={skName}
                  onChange={(e) => setSkName(e.target.value)}
                  placeholder="Tên Skill (vd: dotnet-cqrs)"
                  className="px-3 py-1.5 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <input
                  value={skDesc}
                  onChange={(e) => setSkDesc(e.target.value)}
                  placeholder="Mô tả ngắn..."
                  className="px-3 py-1.5 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <input
                  value={skTags}
                  onChange={(e) => setSkTags(e.target.value)}
                  placeholder="Tags (phân cách dấu phẩy)"
                  className="px-3 py-1.5 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <div className="flex gap-2">
                  <select
                    value={skScope}
                    disabled={Boolean(selectedSkill)}
                    onChange={(e) => setSkScope(e.target.value as 'workspace' | 'global')}
                    className="flex-1 px-2 py-1.5 rounded-lg border outline-none"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    <option value="workspace" disabled={!selectedWs}>Workspace</option>
                    <option value="global">Global</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleSaveSkill()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white font-semibold cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Lưu</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                <Editor
                  value={skBody}
                  onChange={(v) => setSkBody(v ?? '')}
                  language="markdown"
                  theme={isDark ? 'vs-dark' : 'light'}
                  options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
                />
              </div>
            </div>
          </>
        )}

        {tab === 'rules' && (
          <>
            <div className="w-72 shrink-0 border-r p-2 space-y-2 overflow-y-auto" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              {selectedWs && (
                <button
                  type="button"
                  onClick={() => void handleSyncAgents()}
                  className="w-full py-1.5 px-2.5 rounded-lg border text-xs font-medium btn-ghost cursor-pointer"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                >
                  Đồng bộ AGENTS.md → CLAUDE.md &amp; GEMINI.md
                </button>
              )}

              {rules.map((r) => (
                <button
                  key={r.filePath}
                  type="button"
                  onClick={() => openRule(r)}
                  className="w-full text-left p-2.5 rounded-lg border text-xs cursor-pointer"
                  style={{
                    backgroundColor: selectedRule?.filePath === r.filePath ? 'var(--sel)' : 'var(--bg)',
                    borderColor: selectedRule?.filePath === r.filePath ? 'var(--accent)' : 'var(--border)'
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold">{r.name}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: r.exists ? 'rgba(52, 211, 153, 0.14)' : 'rgba(255,255,255,0.06)',
                        color: r.exists ? 'var(--ok)' : 'var(--muted)'
                      }}
                    >
                      {r.exists ? 'Đã có' : 'Chưa tạo'}
                    </span>
                  </div>
                  <div className="text-[10.5px] truncate mt-0.5" style={{ color: 'var(--muted)' }}>
                    {r.filePath}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col min-w-0 min-h-0 p-4 gap-3">
              {selectedRule ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
                      {selectedRule.filePath}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveRule()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Lưu {selectedRule.name}</span>
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                    <Editor
                      value={ruleContent}
                      onChange={(v) => setRuleContent(v ?? '')}
                      language="markdown"
                      theme={isDark ? 'vs-dark' : 'light'}
                      options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
                  Chọn một file rule (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) ở bên trái để xem hoặc chỉnh sửa.
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'mcp' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-4xl mx-auto space-y-3">
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                Tự động quét cấu hình MCP từ <code>.mcp.json</code>, <code>~/.claude.json</code> và <code>~/.codex/config.toml</code>.
              </div>
              {mcpServers.length === 0 ? (
                <div className="p-8 rounded-xl border text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  Không phát hiện MCP server nào đang cấu hình.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {mcpServers.map((m, idx) => (
                    <div
                      key={`${m.name}-${idx}`}
                      className="p-3.5 rounded-xl border space-y-1.5 text-xs"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{m.name}</span>
                        <span
                          className="px-2 py-0.5 rounded-full text-[10.5px]"
                          style={{
                            backgroundColor: m.enabled ? 'rgba(52,211,153,0.14)' : 'var(--err-bg)',
                            color: m.enabled ? 'var(--ok)' : 'var(--err)'
                          }}
                        >
                          {m.enabled ? m.transport : 'disabled'}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] truncate" style={{ color: 'var(--info)' }}>
                        {m.commandOrUrl} {m.args.join(' ')}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                        Nguồn: {m.source}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'templates' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
              <div className="space-y-2.5">
                <div className="font-semibold text-sm">Danh sách Slash Commands</div>
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="p-3 rounded-xl border space-y-1"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>
                        {t.slashCmd}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void window.workspaceApi.deletePromptTemplate(t.id).then(() => loadAll(selectedWs || undefined))
                        }
                        className="text-red-400 hover:opacity-75 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-[11px] whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>
                      {t.body}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="p-4 rounded-xl border space-y-3 h-fit"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="font-semibold text-sm">Thêm Prompt Template mới</div>
                <input
                  value={tplCmd}
                  onChange={(e) => setTplCmd(e.target.value)}
                  placeholder="Lệnh slash (vd: /api-crud)"
                  className="w-full px-3 py-2 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <input
                  value={tplTitle}
                  onChange={(e) => setTplTitle(e.target.value)}
                  placeholder="Tiêu đề mô tả..."
                  className="w-full px-3 py-2 rounded-lg border outline-none"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <textarea
                  rows={6}
                  value={tplBody}
                  onChange={(e) => setTplBody(e.target.value)}
                  placeholder="Nội dung prompt khi gọi lệnh này..."
                  className="w-full p-3 rounded-lg border outline-none resize-y"
                  style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
                />
                <button
                  type="button"
                  onClick={() => void handleSaveTemplate()}
                  className="w-full py-2 rounded-lg font-semibold text-white cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  Lưu Prompt Template
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
