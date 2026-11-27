export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'meta'
  content: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  index: number
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
  rawLines: string[]
}

export interface ParsedUnifiedDiff {
  headerLines: string[]
  hunks: DiffHunk[]
  eol: '\r\n' | '\n'
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseUnifiedDiff(unifiedDiff: string): ParsedUnifiedDiff {
  if (!unifiedDiff || !unifiedDiff.trim()) {
    return { headerLines: [], hunks: [], eol: '\n' }
  }

  const eol: '\r\n' | '\n' = unifiedDiff.includes('\r\n') ? '\r\n' : '\n'
  const rawSplit = unifiedDiff.split('\n')
  // Drop trailing empty element caused by final LF newline
  if (rawSplit.length > 0 && rawSplit[rawSplit.length - 1] === '') {
    rawSplit.pop()
  }

  const headerLines: string[] = []
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldCursor = 0
  let newCursor = 0

  for (const rawLine of rawSplit) {
    const clean = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const hunkMatch = clean.match(HUNK_HEADER_RE)
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10)
      const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1
      const newStart = parseInt(hunkMatch[3], 10)
      const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1
      oldCursor = oldStart
      newCursor = newStart
      current = {
        index: hunks.length,
        header: clean,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
        rawLines: [rawLine]
      }
      hunks.push(current)
      continue
    }

    if (!current) {
      headerLines.push(rawLine)
      continue
    }

    current.rawLines.push(rawLine)
    if (clean.startsWith('+')) {
      current.lines.push({ type: 'add', content: clean.slice(1), oldLine: null, newLine: newCursor++ })
    } else if (clean.startsWith('-')) {
      current.lines.push({ type: 'del', content: clean.slice(1), oldLine: oldCursor++, newLine: null })
    } else if (clean.startsWith('\\')) {
      current.lines.push({ type: 'meta', content: clean, oldLine: null, newLine: null })
    } else {
      current.lines.push({
        type: 'context',
        content: clean.startsWith(' ') ? clean.slice(1) : clean,
        oldLine: oldCursor++,
        newLine: newCursor++
      })
    }
  }

  return { headerLines, hunks, eol }
}

export function buildSingleHunkPatch(parsed: ParsedUnifiedDiff, hunkIndex: number): string {
  const hunk = parsed.hunks[hunkIndex]
  if (!hunk) {
    throw new Error(`Không tìm thấy hunk #${hunkIndex}`)
  }
  const combined = [...parsed.headerLines, ...hunk.rawLines]
  return `${combined.join('\n')}\n`
}
