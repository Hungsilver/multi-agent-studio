import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { PROVIDERS } from '@shared/constants/providers'
import type { ProviderId } from '@shared/types/ai'
import { AgentOrchestrator } from './ai/orchestrator'
import { AppsManager } from './apps/apps-manager'
import { cleanupOldAppLogs } from './apps/apps-store'
import { PostgresWorkspace } from './database/postgres-workspace'
import { ExternalDatabaseWorkspace } from './database/external-workspace'
import { registerPostgresHandlers } from './ipc/postgres-handlers'
import { registerIpcHandlers } from './ipc/register-handlers'
import { WorkspaceDatabase } from './storage/database'
import { WorkspaceRepository } from './storage/repositories'
import { PtyManager } from './terminal/pty-manager'

let mainWindow: BrowserWindow | null = null
let desktopNote: BrowserWindow | null = null
let db: WorkspaceDatabase | null = null
let orchestrator: AgentOrchestrator | null = null
let ptyManager: PtyManager | null = null
let appsManager: AppsManager | null = null
const postgresWorkspace = new PostgresWorkspace()
const externalDatabaseWorkspace = new ExternalDatabaseWorkspace()

function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(process.resourcesPath, 'icon.ico')
  ]
  return candidates.find((p) => fs.existsSync(p))
}

function createWindow(openDockedNote = false): void {
  const icon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 540,
    title: 'Multi-Agent Studio',
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0E1117',
    icon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    void postgresWorkspace.close()
    void externalDatabaseWorkspace.close()
  })
  mainWindow.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) {
      void postgresWorkspace.close()
      void externalDatabaseWorkspace.close()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (openDockedNote) url.hash = 'dock-note'
    void mainWindow.loadURL(url.toString())
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'), openDockedNote ? { hash: 'dock-note' } : undefined)
  }
}

function focusDesktopNote(): boolean {
  if (!desktopNote || desktopNote.isDestroyed()) return false
  if (desktopNote.isMinimized()) desktopNote.restore()
  desktopNote.show()
  desktopNote.focus()
  return true
}

async function openDesktopNote(): Promise<boolean> {
  if (focusDesktopNote()) return true
  const win = new BrowserWindow({
    width: 280,
    height: 420,
    minWidth: 245,
    minHeight: 200,
    title: 'Ghi chú nhanh',
    icon: resolveAppIcon(),
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    maximizable: false,
    show: false,
    backgroundColor: '#1C222B',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  desktopNote = win
  win.once('closed', () => { desktopNote = null })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL)
      url.hash = 'desktop-note'
      await win.loadURL(url.toString())
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'desktop-note' })
    }
    return desktopNote === win && focusDesktopNote()
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  }
}

const customDataDir = process.env.MULTI_AGENT_STUDIO_DATA || process.env.AI_CODING_TOOL_DATA
if (customDataDir) {
  app.setPath('userData', customDataDir)
}

const gotLock = process.env.AICT_E2E_SCRIPT ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.setAppUserModelId('MultiAgentStudio.Desktop')

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (app.isReady()) createWindow()
  })

  // Bảo mật thẻ <webview> dùng cho Live Web Preview: luôn chạy sandboxed, không preload/nodeIntegration
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true

      const targetSrc = (params.src || '').trim()
      if (targetSrc && !/^(https?:\/\/|about:blank)/i.test(targetSrc)) {
        event.preventDefault()
      }
    })
  })

  app.whenReady().then(async () => {
    db = new WorkspaceDatabase()
    await db.init()
    const repo = new WorkspaceRepository(db)
    repo.recoverInterruptedTurns()

    orchestrator = new AgentOrchestrator(repo)
    ptyManager = new PtyManager()
    appsManager = new AppsManager()
    cleanupOldAppLogs()

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

    appsManager.on('apps:alert', (payload) => {
      broadcast('apps:alert', payload)
      const settings = repo.getSettings()
      if (settings.notifications && mainWindow && !mainWindow.isFocused() && Notification.isSupported()) {
        new Notification({
          title: payload.title,
          body: payload.message
        }).show()
      }
    })

    ptyManager.on('pty:data', (payload) => broadcast('pty:data', payload))
    ptyManager.on('pty:exit', (payload) => broadcast('pty:exit', payload))

    registerIpcHandlers({
      getWindow: () => mainWindow,
      repo,
      orchestrator,
      ptyManager,
      appsManager
    })
    registerPostgresHandlers(() => mainWindow, postgresWorkspace, externalDatabaseWorkspace)

    ipcMain.handle('note:desktop', async (event, action: unknown) => {
      if (event.sender === mainWindow?.webContents) {
        if (action === 'open') return openDesktopNote()
        if (action === 'focus') return focusDesktopNote()
      }
      if (desktopNote && event.sender === desktopNote.webContents && (action === 'close' || action === 'dock')) {
        if (action === 'dock') {
          if (!mainWindow) createWindow(true)
          else {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.show()
            mainWindow.focus()
            mainWindow.webContents.send('note:docked')
          }
        }
        desktopNote.close()
        return true
      }
      return false
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
    void postgresWorkspace.close()
    void externalDatabaseWorkspace.close()
    await orchestrator?.stopAll()
    await appsManager?.stopAllTunnels()
    ptyManager?.killAll()
    db?.close()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
