import { useCallback, useEffect, useState } from 'react'
import { openInVsCodeWithToast } from '../../lib/os-actions'
import { AtSign, Code2, Eye, FileCode, Maximize2, RefreshCw, Save } from 'lucide-react'
import { THEMES } from '@shared/constants/themes'
import { detectMonacoLanguage } from '../../lib/monaco-setup'
import { useAiStore } from '../../stores/useAiStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useWorkspaceTabsStore } from '../../stores/useWorkspaceTabsStore'
import { MessageMarkdown } from '../ai/MessageMarkdown'
import { MonacoCodeView } from '../common/MonacoCodeView'

interface FileViewerPanelProps {
  workspacePath: string
  relPath: string
  fullTab?: boolean
}

function getPreviewKind(filePath: string): 'markdown' | 'html' | 'svg' | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')) return 'markdown'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.svg')) return 'svg'
  return null
}

export function FileViewerPanel({ workspacePath, relPath, fullTab = false }: FileViewerPanelProps): React.JSX.Element {
  const themeName = useSettingsStore((s) => s.settings.theme)
  const showToast = useSettingsStore((s) => s.showToast)
  const activeSessionId = useAiStore((s) => s.activeSessionId)
  const appendToDraft = useAiStore((s) => s.appendToDraft)
  const openToolTab = useWorkspaceTabsStore((s) => s.openToolTab)

  const isDark = THEMES[themeName]?.isDark ?? true
  const isExternal = workspacePath === '__external__'
  const previewKind = getPreviewKind(relPath)

  const [viewMode, setViewMode] = useState<'preview' | 'code'>(() => (previewKind ? 'preview' : 'code'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [originalContent, setOriginalContent] = useState('')
  const [content, setContent] = useState('')
  const [meta, setMeta] = useState<{ isBinary: boolean; tooLarge: boolean; size: number }>({
    isBinary: false,
    tooLarge: false,
    size: 0
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setViewMode(previewKind ? 'preview' : 'code')
  }, [relPath, previewKind])

  const loadFile = useCallback(async () => {
    if (!relPath || (!isExternal && !workspacePath)) return
    setLoading(true)
    setError(null)
    try {
      const res = isExternal
        ? await window.workspaceApi.readExternalFile(relPath)
        : await window.workspaceApi.readWorkspaceFile(workspacePath, relPath)
      setOriginalContent(res.content)
      setContent(res.content)
      setMeta({ isBinary: res.isBinary, tooLarge: res.tooLarge, size: res.size })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đọc được file')
    } finally {
      setLoading(false)
    }
  }, [isExternal, workspacePath, relPath])

  useEffect(() => {
    void loadFile()
  }, [loadFile])

  const dirty = !isExternal && content !== originalContent

  const handleSave = useCallback(async () => {
    if (isExternal || !dirty || meta.isBinary || meta.tooLarge) return
    setSaving(true)
    try {
      await window.workspaceApi.writeWorkspaceFile(workspacePath, relPath, content)
      setOriginalContent(content)
      showToast(`Đã lưu ${relPath}`, 'ok')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lưu file thất bại', 'err')
    } finally {
      setSaving(false)
    }
  }, [content, dirty, isExternal, meta.isBinary, meta.tooLarge, relPath, showToast, workspacePath])

  const absHint = isExternal
    ? relPath.replace(/\//g, '\\')
    : `${workspacePath.replace(/[\\/]+$/, '')}\\${relPath.replace(/\//g, '\\')}`
  const fileName = relPath.split('/').pop() || relPath

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div
        className="px-2.5 py-1.5 border-b flex items-center justify-between gap-2 text-xs shrink-0"
        style={{ backgroundColor: 'var(--header)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[11.5px] truncate" title={relPath}>
            {fileName}
          </span>
          {isExternal && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] border shrink-0"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              title={relPath}
            >
              Ngoài dự án
            </span>
          )}
          {dirty && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--warn)' }}
              title="Có thay đổi chưa lưu"
            />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {previewKind && !loading && !error && !meta.isBinary && !meta.tooLarge && (
            <div
              className="flex items-center rounded-md border p-0.5 mr-0.5"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg)' }}
            >
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium cursor-pointer"
                style={{
                  backgroundColor: viewMode === 'preview' ? 'var(--accent-soft)' : 'transparent',
                  color: viewMode === 'preview' ? 'var(--accent)' : 'var(--muted)'
                }}
              >
                <Eye className="w-3 h-3" />
                <span>Xem trước</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('code')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium cursor-pointer"
                style={{
                  backgroundColor: viewMode === 'code' ? 'var(--accent-soft)' : 'transparent',
                  color: viewMode === 'code' ? 'var(--accent)' : 'var(--muted)'
                }}
              >
                <FileCode className="w-3 h-3" />
                <span>Mã nguồn</span>
              </button>
            </div>
          )}

          {dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-white cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
              title="Lưu file (Ctrl+S)"
            >
              <Save className="w-3 h-3" />
              <span>{saving ? 'Đang lưu…' : 'Lưu'}</span>
            </button>
          )}

          {activeSessionId && !isExternal && (
            <button
              type="button"
              onClick={() => {
                appendToDraft(activeSessionId, `@${relPath} `)
                showToast(`Đã đính kèm @${relPath}`, 'ok')
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
              title="Chèn @file vào ô chat"
            >
              <AtSign className="w-3 h-3" />
              <span className="hidden sm:inline">Gửi AI</span>
            </button>
          )}

          {!fullTab && (
            <button
              type="button"
              onClick={() =>
                openToolTab({
                  kind: 'file',
                  title: fileName,
                  workspacePath,
                  filePath: relPath
                })
              }
              className="p-1 rounded btn-ghost cursor-pointer"
              style={{ color: 'var(--muted)' }}
              title="Mở ở Tab lớn"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void openInVsCodeWithToast(absHint)}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Mở bằng VS Code"
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => void loadFile()}
            className="p-1 rounded btn-ghost cursor-pointer"
            style={{ color: 'var(--muted)' }}
            title="Tải lại file từ đĩa"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
            Đang đọc {relPath}…
          </div>
        ) : error ? (
          <div className="p-4 text-xs" style={{ color: 'var(--err)' }}>
            {error}
          </div>
        ) : meta.tooLarge ? (
          <div className="p-6 text-center text-xs space-y-2" style={{ color: 'var(--muted)' }}>
            <p>File quá lớn để hiển thị trong trình xem nhanh ({(meta.size / 1024 / 1024).toFixed(2)} MB).</p>
            <button
              type="button"
              onClick={() => void openInVsCodeWithToast(absHint)}
              className="px-3 py-1.5 rounded-lg border btn-ghost cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              Mở bằng VS Code
            </button>
          </div>
        ) : meta.isBinary ? (
          <div className="p-6 text-center text-xs" style={{ color: 'var(--muted)' }}>
            Đây là file nhị phân ({meta.size.toLocaleString()} bytes), không thể chỉnh sửa trực tiếp dưới dạng text.
          </div>
        ) : previewKind === 'markdown' && viewMode === 'preview' ? (
          <div className="h-full overflow-y-auto p-4 text-[13px] leading-relaxed">
            <MessageMarkdown content={content} workspacePath={isExternal ? undefined : workspacePath} />
          </div>
        ) : (previewKind === 'html' || previewKind === 'svg') && viewMode === 'preview' ? (
          <iframe
            title={fileName}
            sandbox="allow-scripts allow-forms allow-modals"
            srcDoc={
              previewKind === 'svg'
                ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0e1117">${content}</body></html>`
                : content
            }
            className="w-full h-full border-0 bg-white"
          />
        ) : (
          <MonacoCodeView
            value={content}
            language={detectMonacoLanguage(relPath)}
            theme={isDark ? 'vs-dark' : 'light'}
            readOnly={isExternal}
            fontSize={fullTab ? 13 : 12}
            onChange={isExternal ? undefined : setContent}
            onSave={isExternal ? undefined : () => void handleSave()}
          />
        )}
      </div>
    </div>
  )
}
