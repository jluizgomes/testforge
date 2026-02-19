import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from 'electron'
import fs from 'fs'
import path from 'path'
import { BackendManager } from './backend-manager.js'

// Lazy-loaded for workspace sync (only needed when sync is triggered)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let JSZip: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chokidar: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ignore: any = null

// Map of active file watchers keyed by project ID
const _watchers = new Map<string, { close(): void }>()

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

  // ── Workspace Sync ────────────────────────────────────────────────────────

  /**
   * fs:sync-project — Walk project directory, create a ZIP (respecting
   * .gitignore + default ignores), and POST it to the backend workspace
   * endpoint. Starts a file watcher after a successful upload.
   */
  ipcMain.handle(
    'fs:sync-project',
    async (event, { projectPath, projectId, backendUrl }: {
      projectPath: string
      projectId: string
      backendUrl: string
    }): Promise<{ success: boolean; file_count?: number; files?: string[]; error?: string }> => {
      const send = (data: { step: string; current: number; file?: string }) => {
        try { event.sender.send('sync:progress', data) } catch { /* window may be gone */ }
      }

      try {
        // Lazy-load heavy deps
        if (!JSZip) JSZip = (await import('jszip')).default
        if (!ignore) ignore = (await import('ignore')).default

        const DEFAULT_IGNORES = [
          'node_modules', '.git', '.github', '.claude', '.cursor', '.venv', 'venv', 'dist', 'build',
          '.next', '__pycache__', '.pytest_cache', '*.pyc', '.DS_Store', 'coverage', '*.lock',
          '*.log', '*.min.js', '*.map', 'docs',
          '.env.example', '.claudeignore',
        ]

        // Build ignore filter
        const ig = ignore()
        ig.add(DEFAULT_IGNORES)

        // Read .gitignore files (root)
        for (const name of ['.gitignore', '.npmignore']) {
          const p = path.join(projectPath, name)
          if (fs.existsSync(p)) {
            try { ig.add(fs.readFileSync(p, 'utf-8')) } catch { /* ignore */ }
          }
        }

        const SKIP_DIRS = new Set([
          'node_modules', '.git', '.github', '.claude', '.cursor', '__pycache__', '.pytest_cache',
          '.venv', 'venv', 'dist', 'build', '.next', 'coverage', 'docs',
        ])
        const MAX_FILE_SIZE = 512 * 1024 // 500 KB — skip likely binaries
        const MAX_DEPTH = 8

        const zip = new JSZip()
        const syncedFiles: string[] = []

        send({ step: 'scanning', current: 0 })

        const addDir = (dir: string, depth: number) => {
          if (depth > MAX_DEPTH) return
          let entries: string[]
          try { entries = fs.readdirSync(dir) } catch { return }

          for (const entry of entries) {
            if (SKIP_DIRS.has(entry)) continue
            const full = path.join(dir, entry)
            const rel = path.relative(projectPath, full).replace(/\\/g, '/')
            if (ig.ignores(rel)) continue

            let stat: fs.Stats
            try { stat = fs.statSync(full) } catch { continue }

            if (stat.isDirectory()) {
              addDir(full, depth + 1)
            } else if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
              try {
                const data = fs.readFileSync(full)
                zip.file(rel, data)
                syncedFiles.push(rel)
                // Emit every file so the UI can show the scrolling list
                send({ step: 'scanning', current: syncedFiles.length, file: rel })
              } catch { /* skip unreadable files */ }
            }
          }
        }

        addDir(projectPath, 0)

        send({ step: 'compressing', current: syncedFiles.length })

        // Generate ZIP as Buffer
        const zipBuffer: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

        send({ step: 'uploading', current: syncedFiles.length })

        // Upload to backend using built-in fetch + FormData (Electron 22+ / Node 18+)
        const url = `${backendUrl}/api/v1/projects/${projectId}/workspace/upload`
        const blob = new Blob([zipBuffer], { type: 'application/zip' })
        const form = new FormData()
        form.append('file', blob, 'workspace.zip')

        const resp = await fetch(url, { method: 'POST', body: form })

        if (!resp.ok) {
          const text = await resp.text()
          return { success: false, error: `Upload failed (${resp.status}): ${text}` }
        }

        // Start watcher after successful upload
        _startWatcher(projectPath, projectId, backendUrl, ig)

        return { success: true, file_count: syncedFiles.length, files: syncedFiles }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  /**
   * fs:watch-project — Start a chokidar watcher for incremental sync.
   * Each added/changed file is PUT to workspace/files; unlinked files are DELETE'd.
   */
  ipcMain.handle(
    'fs:watch-project',
    async (_event, { projectPath, projectId, backendUrl }: {
      projectPath: string
      projectId: string
      backendUrl: string
    }): Promise<{ success: boolean }> => {
      try {
        if (!ignore) ignore = (await import('ignore')).default
        const ig = ignore()
        ig.add(['node_modules', '.git', '.github', '.claude', '.cursor', '__pycache__', '.pytest_cache', '.venv', 'venv', 'dist', 'build', '.next', 'docs', '.env.example', '.claudeignore'])
        for (const name of ['.gitignore']) {
          const p = path.join(projectPath, name)
          if (fs.existsSync(p)) {
            try { ig.add(fs.readFileSync(p, 'utf-8')) } catch { /* ignore */ }
          }
        }
        _startWatcher(projectPath, projectId, backendUrl, ig)
        return { success: true }
      } catch (err) {
        console.error('fs:watch-project error', err)
        return { success: false }
      }
    }
  )

  /**
   * fs:unwatch-project — Stop the chokidar watcher for a project.
   */
  ipcMain.handle(
    'fs:unwatch-project',
    (_event, { projectId }: { projectId: string }): void => {
      const watcher = _watchers.get(projectId)
      if (watcher) {
        watcher.close()
        _watchers.delete(projectId)
      }
    }
  )
}

// ── Watcher helper (outside setupIpcHandlers to allow reuse) ─────────────────

function _startWatcher(
  projectPath: string,
  projectId: string,
  backendUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ig: any,
): void {
  // Close any existing watcher for this project
  const existing = _watchers.get(projectId)
  if (existing) existing.close()

  // Debounce timers: path → NodeJS.Timeout
  const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

  const scheduleSync = (rel: string, action: 'upsert' | 'delete', full: string) => {
    const prev = debounceMap.get(rel)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(async () => {
      debounceMap.delete(rel)
      if (action === 'upsert') {
        try {
          const data = fs.readFileSync(full)
          const content_b64 = data.toString('base64')
          const putResp = await fetch(
            `${backendUrl}/api/v1/projects/${projectId}/workspace/files`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: rel, content_b64 }),
            }
          )
          if (!putResp.ok) {
            await fetch(
              `${backendUrl}/api/v1/projects/${projectId}/workspace/files`,
              {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: rel }),
              }
            )
          }
        } catch { /* best-effort */ }
      } else {
        try {
          await fetch(
            `${backendUrl}/api/v1/projects/${projectId}/workspace/files`,
            {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: rel }),
            }
          )
        } catch { /* best-effort */ }
      }
    }, 150)
    debounceMap.set(rel, timer)
  }

  // Lazy-load chokidar and start watching
  import('chokidar').then((mod) => {
    chokidar = mod.default ?? mod
    const watcher = chokidar.watch(projectPath, {
      ignored: (filePath: string) => {
        const rel = path.relative(projectPath, filePath).replace(/\\/g, '/')
        if (!rel) return false // root itself
        return ig.ignores(rel)
      },
      persistent: true,
      ignoreInitial: true,
    })

    watcher.on('add', (filePath: string) => {
      const rel = path.relative(projectPath, filePath).replace(/\\/g, '/')
      scheduleSync(rel, 'upsert', filePath)
    })
    watcher.on('change', (filePath: string) => {
      const rel = path.relative(projectPath, filePath).replace(/\\/g, '/')
      scheduleSync(rel, 'upsert', filePath)
    })
    watcher.on('unlink', (filePath: string) => {
      const rel = path.relative(projectPath, filePath).replace(/\\/g, '/')
      scheduleSync(rel, 'delete', filePath)
    })

    _watchers.set(projectId, watcher)
  }).catch((err) => {
    console.error('chokidar load error:', err)
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
