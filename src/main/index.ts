import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import { PROVIDERS } from '@shared/constants/providers'
import type { ProviderId } from '@shared/types/ai'
import { AgentOrchestrator } from './ai/orchestrator'
import { registerIpcHandlers } from './ipc/register-handlers'
import { WorkspaceDatabase } from './storage/database'
import { WorkspaceRepository } from './storage/repositories'
import { PtyManager } from './terminal/pty-manager'

let mainWindow: BrowserWindow | null = null
let db: WorkspaceDatabase | null = null
let orchestrator: AgentOrchestrator | null = null
let ptyManager: PtyManager | null = null

function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(process.resourcesPath, 'icon.ico')
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function createWindow(): void {
  const icon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 680,
    title: 'AI Coding Tool',
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0E1117',
    icon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.setAppUserModelId('AiCodingTool.Desktop')

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    db = new WorkspaceDatabase()
    await db.init()
    const repo = new WorkspaceRepository(db)

    orchestrator = new AgentOrchestrator(repo)
    ptyManager = new PtyManager()

    const broadcast = (channel: string, payload: unknown): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload)
      }
    }

    orchestrator.on('ai:event', (payload) => broadcast('ai:event', payload))
    orchestrator.on('ai:status', (payload) => broadcast('ai:status', payload))
    orchestrator.on('ai:turn-finished', (payload: { sessionTitle: string; provider: ProviderId; status: string }) => {
      const settings = repo.getSettings()
      if (settings.notifications && mainWindow && !mainWindow.isFocused() && Notification.isSupported()) {
        new Notification({
          title: `${PROVIDERS[payload.provider].name} — ${payload.status === 'error' ? 'Gặp lỗi' : 'Hoàn thành'}`,
          body: payload.sessionTitle
        }).show()
      }
    })

    ptyManager.on('pty:data', (payload) => broadcast('pty:data', payload))
    ptyManager.on('pty:exit', (payload) => broadcast('pty:exit', payload))

    registerIpcHandlers({
      getWindow: () => mainWindow,
      repo,
      orchestrator,
      ptyManager
    })

    createWindow()

    // Dev/E2E hook: chạy kịch bản kiểm thử giao diện nếu AICT_E2E_SCRIPT được chỉ định
    const e2eScript = process.env.AICT_E2E_SCRIPT
    if (!app.isPackaged && e2eScript && fs.existsSync(e2eScript) && mainWindow) {
      const win = mainWindow
      void import(/* @vite-ignore */ `file:///${e2eScript.replace(/\\/g, '/')}`).then((mod) => {
        if (typeof mod.default === 'function') {
          void mod.default({ app, win })
        }
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', async () => {
    await orchestrator?.stopAll()
    ptyManager?.killAll()
    db?.close()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
