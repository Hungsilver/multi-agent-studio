import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

let initialized = false

export function ensureMonacoSetup(): void {
  if (initialized) return
  initialized = true

  ;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    }
  }

  loader.config({ monaco })

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason as { name?: string; message?: string } | undefined
      if (reason && reason.name === 'Canceled' && reason.message === 'Canceled') {
        event.preventDefault()
      }
    })
  }
}

export function detectMonacoLanguage(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css'
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.cs')) return 'csharp'
  if (lower.endsWith('.ps1')) return 'powershell'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.sql')) return 'sql'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.xml') || lower.endsWith('.csproj')) return 'xml'
  if (lower.endsWith('.sh')) return 'shell'
  return 'plaintext'
}
