export function formatGridJson(value: string): string | undefined {
  if (!/^\s*[\[{]/.test(value)) return undefined
  try {
    JSON.parse(value)
  } catch {
    return undefined
  }

  // Preserve numeric literals and duplicate keys from the original value.
  const compact = value.replace(/"(?:\\.|[^"\\])*"|\s+/g, (token) => token.startsWith('"') ? token : '')
  let depth = 0
  return compact.replace(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g, (token, index: number) => {
    const indent = (): string => '\n' + '  '.repeat(Math.min(depth, 24))
    if (token === '{' || token === '[') {
      depth++
      return token + (compact[index + 1] === '}' || compact[index + 1] === ']' ? '' : indent())
    }
    if (token === '}' || token === ']') {
      depth--
      return (compact[index - 1] === '{' || compact[index - 1] === '[' ? '' : indent()) + token
    }
    if (token === ',') return ',' + indent()
    return token === ':' ? ': ' : token
  })
}
