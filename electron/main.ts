import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from 'electron'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { BackendManager } from './backend-manager.js'

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

  // Fallback: show window after 10s even if ready-to-show never fires (e.g. blank page)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 10_000)

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

  const result = await backendManager.start()
  if (result.success) {
    console.log('Backend started successfully')
  } else {
    console.warn('Backend unavailable:', result.error, '— UI will still open; API calls may fail.')
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
    // Parent window is optional; Electron accepts undefined at runtime
    const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
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

  // File system — pre-scan project directory (25s deadline) for remote volume support
  ipcMain.handle(
    'fs:scan-project',
    (_event, projectPath: string): Promise<Record<string, unknown>> => {
      return new Promise((resolve) => {
        const DEADLINE_MS = 25_000
        const timer = setTimeout(() => resolve({ timeout: true, files: [], entry_points: [], total_files: 0 }), DEADLINE_MS)

        try {
          const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next'])
          const ENTRY_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java'])
          const ROUTE_PATTERNS = [
            /router\.(get|post|put|delete|patch)\s*\(/,
            /export\s+default\s+function\s+\w+Page/,
            /@router\.(get|post|put|delete|patch)\s*\(/,
            /createBrowserRouter|<Route\s/,
          ]

          const files: Array<{ path: string; size: number; extension: string }> = []
          const entry_points: string[] = []

          function walk(dir: string, depth = 0) {
            if (depth > 8) return
            let entries: string[]
            try {
              entries = fs.readdirSync(dir)
            } catch {
              return
            }
            for (const entry of entries) {
              if (SKIP_DIRS.has(entry)) continue
              const full = path.join(dir, entry)
              let stat: fs.Stats
              try {
                stat = fs.statSync(full)
              } catch {
                continue
              }
              const rel = path.relative(projectPath, full)
              if (stat.isDirectory()) {
                walk(full, depth + 1)
              } else if (stat.isFile()) {
                const ext = path.extname(entry)
                files.push({ path: rel, size: stat.size, extension: ext })
                if (ENTRY_EXTS.has(ext)) {
                  try {
                    const content = fs.readFileSync(full, 'utf-8').slice(0, 1000)
                    if (ROUTE_PATTERNS.some((p) => p.test(content)) || content.includes('export default')) {
                      entry_points.push(rel)
                    }
                  } catch { /* ignore */ }
                }
              }
            }
          }

          walk(projectPath)
          clearTimeout(timer)
          resolve({ files, entry_points, total_files: files.length })
        } catch (err) {
          clearTimeout(timer)
          resolve({ error: String(err), files: [], entry_points: [], total_files: 0 })
        }
      })
    }
  )

  // File system — read .env / .env.local files from a project directory
  ipcMain.handle('fs:read-env-file', (_event, projectPath: string): Record<string, string> => {
    const candidates = ['.env.local', '.env']
    for (const filename of candidates) {
      const filePath = path.join(projectPath, filename)
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8')
        const vars: Record<string, string> = {}
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx === -1) continue
          const key = trimmed.slice(0, eqIdx).trim()
          const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
          if (key) vars[key] = value
        }
        return vars
      }
    }
    return {}
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
