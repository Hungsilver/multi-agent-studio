export const MAX_SPLIT_PANES = 3

export function clampSplitRatio(ratio: number): number {
  return Math.max(0.18, Math.min(0.82, ratio))
}

export function addSplitPaneId(
  paneSessionIds: string[],
  sessionId: string
): { paneSessionIds: string[]; focusedPaneIdx: number } {
  const existingIdx = paneSessionIds.indexOf(sessionId)
  if (existingIdx >= 0) {
    return { paneSessionIds: [...paneSessionIds], focusedPaneIdx: existingIdx }
  }
  const next = [...paneSessionIds]
  if (next.length >= MAX_SPLIT_PANES) {
    next[next.length - 1] = sessionId
  } else {
    next.push(sessionId)
  }
  return { paneSessionIds: next, focusedPaneIdx: next.length - 1 }
}

export function removeSplitPaneId(
  paneSessionIds: string[],
  idxToRemove: number,
  currentFocusedIdx: number
): { paneSessionIds: string[]; focusedPaneIdx: number } {
  if (paneSessionIds.length <= 1 || idxToRemove < 0 || idxToRemove >= paneSessionIds.length) {
    return {
      paneSessionIds: [...paneSessionIds],
      focusedPaneIdx: Math.max(0, Math.min(Math.max(0, paneSessionIds.length - 1), currentFocusedIdx))
    }
  }
  const next = [...paneSessionIds]
  next.splice(idxToRemove, 1)
  const nextFocused = Math.max(
    0,
    Math.min(next.length - 1, currentFocusedIdx >= idxToRemove ? currentFocusedIdx - 1 : currentFocusedIdx)
  )
  return { paneSessionIds: next, focusedPaneIdx: nextFocused }
}
