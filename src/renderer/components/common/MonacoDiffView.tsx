import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { ensureMonacoSetup } from '../../lib/monaco-setup'

interface MonacoDiffViewProps {
  original: string
  modified: string
  language: string
  theme: 'vs-dark' | 'light'
  sideBySide?: boolean
  fontSize?: number
}

export function MonacoDiffView({
  original,
  modified,
  language,
  theme,
  sideBySide = false,
  fontSize = 12
}: MonacoDiffViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<{ orig: monaco.editor.ITextModel; mod: monaco.editor.ITextModel } | null>(null)

  useEffect(() => {
    ensureMonacoSetup()
    const el = hostRef.current
    if (!el) return

    const diffEditor = monaco.editor.createDiffEditor(el, {
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: sideBySide,
      minimap: { enabled: false },
      fontSize,
      scrollBeyondLastLine: false
    })
    editorRef.current = diffEditor

    return () => {
      // Reset model trên DiffEditorWidget TRƯỚC KHI dispose TextModels (tránh lỗi Monaco dispose order)
      try {
        diffEditor.setModel(null)
      } catch {
        // ignore
      }
      if (modelsRef.current) {
        modelsRef.current.orig.dispose()
        modelsRef.current.mod.dispose()
        modelsRef.current = null
      }
      diffEditor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(theme)
  }, [theme])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide, fontSize })
  }, [sideBySide, fontSize])

  useEffect(() => {
    const diffEditor = editorRef.current
    if (!diffEditor) return

    const nextOrig = monaco.editor.createModel(original, language)
    const nextMod = monaco.editor.createModel(modified, language)
    const prev = modelsRef.current

    diffEditor.setModel({ original: nextOrig, modified: nextMod })
    modelsRef.current = { orig: nextOrig, mod: nextMod }

    if (prev) {
      prev.orig.dispose()
      prev.mod.dispose()
    }
  }, [original, modified, language])

  return <div ref={hostRef} className="w-full h-full" />
}
