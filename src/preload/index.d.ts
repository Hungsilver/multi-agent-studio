import type { WorkspaceApi } from '@shared/types/ipc'

declare global {
  interface Window {
    workspaceApi: WorkspaceApi
  }
}

export {}
