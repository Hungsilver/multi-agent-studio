import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import githubDarkDefault from 'shiki/themes/github-dark-default.mjs'
import githubLightDefault from 'shiki/themes/github-light-default.mjs'
import bash from 'shiki/langs/bash.mjs'
import csharp from 'shiki/langs/csharp.mjs'
import css from 'shiki/langs/css.mjs'
import diff from 'shiki/langs/diff.mjs'
import dockerfile from 'shiki/langs/dockerfile.mjs'
import go from 'shiki/langs/go.mjs'
import html from 'shiki/langs/html.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import json from 'shiki/langs/json.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import powershell from 'shiki/langs/powershell.mjs'
import python from 'shiki/langs/python.mjs'
import rust from 'shiki/langs/rust.mjs'
import sql from 'shiki/langs/sql.mjs'
import toml from 'shiki/langs/toml.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import xml from 'shiki/langs/xml.mjs'
import yaml from 'shiki/langs/yaml.mjs'

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  cs: 'csharp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  ps: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  docker: 'dockerfile'
}

const SUPPORTED_LANGS = new Set([
  'bash',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'go',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'powershell',
  'python',
  'rust',
  'sql',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml'
])

let highlighterPromise: Promise<HighlighterCore> | null = null

export function getShikiHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDarkDefault, githubLightDefault],
      langs: [
        bash,
        csharp,
        css,
        diff,
        dockerfile,
        go,
        html,
        javascript,
        json,
        jsx,
        markdown,
        powershell,
        python,
        rust,
        sql,
        toml,
        tsx,
        typescript,
        xml,
        yaml
      ],
      engine: createJavaScriptRegexEngine()
    })
  }
  return highlighterPromise
}

export async function highlightCodeBlock(code: string, rawLang: string, isDark: boolean): Promise<string | null> {
  const normalized = LANG_ALIASES[rawLang.toLowerCase()] ?? rawLang.toLowerCase()
  const lang = SUPPORTED_LANGS.has(normalized) ? normalized : 'text'
  if (lang === 'text') return null
  const hl = await getShikiHighlighter()
  return hl.codeToHtml(code, {
    lang,
    theme: isDark ? 'github-dark-default' : 'github-light-default'
  })
}
