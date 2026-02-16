import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { BackendManager } from './backend-manager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let backendManager: BackendManager | null = null

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : true,
    backgroundColor: '#0f172a',
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function initBackend() {
  backendManager = new BackendManager()

  try {
    await backendManager.start()
    console.log('Backend started successfully')
  } catch (error) {
    console.error('Failed to start backend:', error)
    dialog.showErrorBox(
      'Backend Error',
      'Failed to start the backend server. Please check the logs.'
    )
  }
}

// IPC Handlers
function setupIpcHandlers() {
  // Backend management
  ipcMain.handle('backend:start', async () => {
    if (backendManager) {
      return backendManager.start()
    }
    return { success: false, error: 'Backend manager not initialized' }
  })

  ipcMain.handle('backend:stop', async () => {
    if (backendManager) {
      return backendManager.stop()
    }
    return { success: false, error: 'Backend manager not initialized' }
  })

  ipcMain.handle('backend:status', () => {
    if (backendManager) {
      return backendManager.getStatus()
    }
    return { status: 'stopped', port: null }
  })

  ipcMain.handle('backend:health-check', async () => {
    if (backendManager) {
      return backendManager.healthCheck()
    }
    return { healthy: false, error: 'Backend manager not initialized' }
  })

  ipcMain.handle('backend:get-url', () => {
    if (backendManager) {
      return backendManager.getBaseUrl()
    }
    return null
  })

  // File operations
  ipcMain.handle('file:open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Directory',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('file:select-file', async (_event, options: { filters?: Electron.FileFilter[], title?: string }) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: options.filters,
      title: options.title || 'Select File',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Shell operations
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    await shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle('shell:open-path', async (_event, filePath: string) => {
    await shell.openPath(filePath)
    return { success: true }
  })

  // App info
  ipcMain.handle('app:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('app:get-path', (_event, name: 'home' | 'appData' | 'userData' | 'temp' | 'logs') => {
    return app.getPath(name)
  })

  // Notifications
  ipcMain.handle('notification:show', (_event, options: { title: string, body: string }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title,
        body: options.body,
      })
      notification.show()
      return { success: true }
    }
    return { success: false, error: 'Notifications not supported' }
  })
}

app.whenReady().then(async () => {
  setupIpcHandlers()
  await initBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  if (backendManager) {
    await backendManager.stop()
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  if (backendManager) {
    await backendManager.stop()
  }
})
