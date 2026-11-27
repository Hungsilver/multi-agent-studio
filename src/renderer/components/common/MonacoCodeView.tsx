import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { ensureMonacoSetup } from '../../lib/monaco-setup'

interface MonacoCodeViewProps {
  value: string
  language: string
  theme: 'vs-dark' | 'light'
  readOnly?: boolean
  fontSize?: number
  onChange?: (nextValue: string) => void
  onSave?: () => void
}

export function MonacoCodeView({
  value,
  language,
  theme,
  readOnly = true,
  fontSize = 12,
  onChange,
  onSave
}: MonacoCodeViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const suppressingRef = useRef(false)

  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    ensureMonacoSetup()
    const el = hostRef.current
    if (!el) return

    const model = monaco.editor.createModel(value, language)
    modelRef.current = model

    const editor = monaco.editor.create(el, {
      model,
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2
    })
    editorRef.current = editor

    const changeDisp = model.onDidChangeContent(() => {
      if (!suppressingRef.current && onChangeRef.current) {
        onChangeRef.current(model.getValue())
      }
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    return () => {
      changeDisp.dispose()
      try {
        editor.setModel(null)
      } catch {
        // ignore
      }
      model.dispose()
      modelRef.current = null
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(theme)
  }, [theme])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, fontSize })
  }, [readOnly, fontSize])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    monaco.editor.setModelLanguage(model, language)
  }, [language])

  useEffect(() => {
    const model = modelRef.current
    if (!model) return
    if (model.getValue() !== value) {
      suppressingRef.current = true
      model.setValue(value)
      suppressingRef.current = false
    }
  }, [value])

  return <div ref={hostRef} className="w-full h-full" />
}
