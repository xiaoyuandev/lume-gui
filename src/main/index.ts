import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { LumeManager } from './lume'
import { loadSettings, saveSettings } from './settings'
import type { AppSettings, CreateVmInput, UpdateVmInput } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const lume = new LumeManager()
let isQuitting = false

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function applySystemSettings(settings: AppSettings): Promise<void> {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: settings.startAtLogin
    })
  }

  if (settings.autoStartServe) {
    await lume.ensureServeRunning()
  } else {
    lume.stopServe()
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    title: 'Lume GUI',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', async (event) => {
    const settings = await loadSettings()
    if (settings.backgroundMode && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  if (tray) return

  tray = new Tray(nativeImage.createFromPath(icon))
  tray.setToolTip('Lume GUI')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Lume GUI', click: () => showMainWindow() },
      { label: 'Restart lume serve', click: () => void lume.restartServe() },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showMainWindow())
}

function registerIpcHandlers(): void {
  ipcMain.handle('lume:getStatus', () => lume.getStatus())
  ipcMain.handle('lume:listVms', () => lume.listVms())
  ipcMain.handle('lume:getVm', (_, name: string) => lume.getVm(name))
  ipcMain.handle('lume:createVm', (_, input: CreateVmInput) => lume.createVm(input))
  ipcMain.handle('lume:startVm', (_, name: string) => lume.startVm(name))
  ipcMain.handle('lume:stopVm', (_, name: string) => lume.stopVm(name))
  ipcMain.handle('lume:deleteVm', (_, name: string) => lume.deleteVm(name))
  ipcMain.handle('lume:updateVm', (_, input: UpdateVmInput) => lume.updateVm(input))
  ipcMain.handle('lume:getVmLogs', (_, name: string) => lume.getVmLogs(name))
  ipcMain.handle('lume:listImages', () => lume.listImages())
  ipcMain.handle('lume:restartServe', () => lume.restartServe())
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:save', async (_, input: AppSettings) => {
    const settings = await saveSettings(input)
    await applySystemSettings(settings)
    return settings
  })
  ipcMain.handle('dialog:chooseDirectory', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory']
        })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()
  registerIpcHandlers()

  loadSettings().then((settings) => applySystemSettings(settings))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    showMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  lume.stopServe()
})
