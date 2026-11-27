import { useSettingsStore } from '../stores/useSettingsStore'

/** Git từ chối xóa thường vì còn thay đổi chưa commit / file untracked / bị khóa. */
function isRefusedByGit(message: string): boolean {
  return /modified or untracked|contains modified|use --force|is dirty/i.test(message)
}

/**
 * Xóa worktree an toàn: thử xóa thường trước; nếu Git từ chối vì còn thay đổi chưa lưu thì hỏi xác nhận rõ ràng
 * trước khi xóa cưỡng bức. Trả về true nếu worktree đã bị xóa.
 */
export async function removeWorktreeWithConfirm(repoRoot: string, worktreePath: string, deleteBranch = false): Promise<boolean> {
  const toast = useSettingsStore.getState().showToast
  try {
    await window.workspaceApi.removeWorktree(repoRoot, worktreePath, deleteBranch, false)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isRefusedByGit(message)) {
      toast(`Không xóa được Worktree: ${message}`, 'err')
      return false
    }
    const ok = window.confirm(
      `Git từ chối xóa Worktree vì còn thay đổi chưa commit hoặc file chưa theo dõi:\n${worktreePath}\n\n` +
        'Xóa cưỡng bức sẽ MẤT VĨNH VIỄN các thay đổi đó (và nhánh chưa merge nếu bạn chọn xóa nhánh). Tiếp tục?'
    )
    if (!ok) return false
    try {
      await window.workspaceApi.removeWorktree(repoRoot, worktreePath, deleteBranch, true)
      return true
    } catch (err2) {
      toast(`Không xóa được Worktree: ${err2 instanceof Error ? err2.message : String(err2)}`, 'err')
      return false
    }
  }
}
