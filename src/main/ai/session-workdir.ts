import fs from 'node:fs'
import type { AiSession } from '@shared/types/ai'

/**
 * Thư mục làm việc thật của phiên. Phiên gắn worktree mà thư mục đã mất thì KHÔNG được lùi về repo gốc
 * (sẽ ghi/hoàn tác nhầm vào nhánh đang mở) — báo lỗi để người dùng tự quyết định.
 */
export function resolveSessionWorkDir(session: Pick<AiSession, 'worktreePath' | 'workspacePath' | 'worktreeBranch'>): string {
  if (session.worktreePath) {
    if (!fs.existsSync(session.worktreePath)) {
      throw new Error(
        `Worktree của phiên không còn tồn tại: ${session.worktreePath}` +
          `${session.worktreeBranch ? ` (nhánh ${session.worktreeBranch})` : ''}. ` +
          'Để tránh ghi nhầm vào repo gốc, thao tác đã bị dừng — hãy tạo lại worktree hoặc mở phiên mới.'
      )
    }
    return session.worktreePath
  }
  return session.workspacePath
}
