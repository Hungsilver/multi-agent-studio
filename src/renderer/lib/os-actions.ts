import { useSettingsStore } from '../stores/useSettingsStore'

export function formatIpcError(err: unknown): string {
  return err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(err)
}

/** Mở VS Code và hiện lỗi cho người dùng nếu không mở được (thiếu launcher, đường dẫn sai...). */
export async function openInVsCodeWithToast(targetPath: string): Promise<void> {
  try {
    await window.workspaceApi.openInVsCode(targetPath)
  } catch (err) {
    useSettingsStore.getState().showToast(formatIpcError(err), 'err')
  }
}

/** Mở Explorer tại thư mục đích và hiện toast nếu xảy ra lỗi. */
export async function openInExplorerWithToast(targetPath: string): Promise<void> {
  try {
    await window.workspaceApi.openInExplorer(targetPath)
  } catch (err) {
    useSettingsStore.getState().showToast(formatIpcError(err), 'err')
  }
}
