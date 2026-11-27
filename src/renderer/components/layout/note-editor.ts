export const taskPrefix = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/
const editorTask = /^([ \t]*)([☐☑])(?=[ \t]|$)/
const listPrefix = /^([ \t]*)(☐|☑|[-+*]|\d+[.)])(?:[ \t]+|$)/

function appendInline(parent: HTMLElement, text: string): void {
  const pattern = /(\*{1,3})(?=\S)(.+?)(?<=\S)\1(?!\*)/g
  let start = 0
  for (const match of text.matchAll(pattern)) {
    parent.append(text.slice(start, match.index))
    const element = document.createElement(match[1].length === 1 ? 'em' : 'strong')
    const inner = match[1].length === 3 ? element.appendChild(document.createElement('em')) : element
    appendInline(inner, match[2])
    parent.append(element)
    start = match.index + match[0].length
  }
  parent.append(text.slice(start))
}

export function loadNoteEditor(editor: HTMLDivElement, markdown: string): void {
  const lines = markdown.split('\n').map((line) => {
    const block = document.createElement('div')
    const display = line.replace(taskPrefix, (_match, prefix: string, state: string) =>
      (prefix.match(/^[ \t]*/)?.[0] ?? '') + (state === ' ' ? '☐' : '☑')
    )
    if (display) appendInline(block, display)
    else block.append(document.createElement('br'))
    return block
  })
  editor.replaceChildren(...lines)
}

function inlineMarkdown(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u00a0/g, ' ')
  if (!(node instanceof HTMLElement)) return ''
  if (node.tagName === 'BR') return node === node.parentNode?.lastChild ? '' : '\n'
  const content = Array.from(node.childNodes, inlineMarkdown).join('')
  const bold = node.matches('b,strong') || /^(bold|[6-9]00)$/.test(node.style.fontWeight)
  const italic = node.matches('i,em') || node.style.fontStyle === 'italic'
  const marker = (bold ? '**' : '') + (italic ? '*' : '')
  if (!marker || !content.trim()) return content
  return content.replace(/^(\s*)(\S[\s\S]*?)(\s*)$/, (_match, before, body, after) =>
    before + marker + body + marker + after
  )
}

export function readNoteEditor(editor: HTMLDivElement): string {
  const blocks: string[] = []
  let inline = ''
  for (const node of editor.childNodes) {
    if (node instanceof HTMLElement && node.matches('div,p')) {
      if (inline) blocks.push(inline)
      blocks.push(inlineMarkdown(node))
      inline = ''
    } else {
      inline += inlineMarkdown(node)
    }
  }
  if (inline) blocks.push(inline)
  return blocks.join('\n').split('\n').map((line) =>
    line.replace(editorTask, (_match, indent: string, box: string) => `${indent}- [${box === '☑' ? 'x' : ' '}]`)
  ).join('\n')
}

function selectionRange(editor: HTMLDivElement): Range | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null
}

export function formatNote(editor: HTMLDivElement, style: 'bold' | 'italic'): void {
  editor.focus({ preventScroll: true })
  document.execCommand(style)
}

function noteLines(editor: HTMLDivElement): Range[] {
  const lines: Range[] = []
  let inlineStart: ChildNode | null = null
  for (const child of editor.childNodes) {
    if (!(child instanceof HTMLElement) || !child.matches('div,p')) {
      inlineStart ??= child
      continue
    }
    if (inlineStart) {
      const range = document.createRange()
      range.setStartBefore(inlineStart)
      range.setEndBefore(child)
      lines.push(range)
      inlineStart = null
    }
    const range = document.createRange()
    range.selectNodeContents(child)
    lines.push(range)
  }
  if (inlineStart || lines.length === 0) {
    const range = document.createRange()
    range.selectNodeContents(editor)
    if (inlineStart) range.setStartBefore(inlineStart)
    lines.push(range)
  }
  return lines
}

function replacePrefix(line: Range, length: number, text: string): void {
  const range = line.cloneRange()
  range.collapse(true)
  const walker = document.createTreeWalker(line.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node && length > 0; node = walker.nextNode()) {
    if (!line.intersectsNode(node)) continue
    const size = node.textContent?.length ?? 0
    range.setEnd(node, Math.min(length, size))
    length -= size
  }
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  document.execCommand(text ? 'insertText' : 'delete', false, text)
}

export function insertNoteList(editor: HTMLDivElement, prefix: string): void {
  editor.focus({ preventScroll: true })
  const selected = selectionRange(editor)
  if (!selected) return
  const lines = noteLines(editor).filter((line) =>
    line.comparePoint(selected.startContainer, selected.startOffset) <= 0 &&
    line.comparePoint(selected.endContainer, selected.endOffset) >= 0
  )
  for (const line of lines.reverse()) {
    const text = line.toString().replace(/\u00a0/g, ' ')
    const match = text.match(listPrefix)
    const indent = match?.[1] ?? text.match(/^[ \t]*/)?.[0] ?? ''
    replacePrefix(line, match?.[0].length ?? indent.length, indent + prefix)
  }
}

export function continueNoteList(editor: HTMLDivElement): boolean {
  const selected = selectionRange(editor)
  if (!selected) return false
  const line = noteLines(editor).find((range) =>
    range.isPointInRange(selected.startContainer, selected.startOffset)
  )
  if (!line) return false
  const text = line.toString().replace(/\u00a0/g, ' ')
  const match = text.match(listPrefix)
  if (!match) return false
  const beforeCaret = line.cloneRange()
  beforeCaret.setEnd(selected.startContainer, selected.startOffset)
  if (beforeCaret.toString().length < match[0].length) return false

  if (selected.collapsed && !text.slice(match[0].length).trim()) {
    replacePrefix(line, match[0].length, '')
  } else {
    const marker = /^[☐☑]$/.test(match[2]) ? '☐' : match[2].replace(/^\d+/, (number) => String(Number(number) + 1))
    document.execCommand('insertParagraph')
    document.execCommand('insertText', false, `${match[1]}${marker} `)
  }
  return true
}
