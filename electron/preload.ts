import { contextBridge, ipcRenderer } from 'electron'

// Types for the exposed API
export interface BackendStatus {
  status: 'starting' | 'running' | 'stopped' | 'error'
  port: number | null
  error?: string
}

export interface HealthCheckResult {
  healthy: boolean
  error?: string
  latency?: number
}

export interface NotificationOptions {
  title: string
  body: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

// Backend API
const backendApi = {
  start: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('backend:start'),

  stop: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('backend:stop'),

  getStatus: (): Promise<BackendStatus> =>
    ipcRenderer.invoke('backend:status'),

  healthCheck: (): Promise<HealthCheckResult> =>
    ipcRenderer.invoke('backend:health-check'),

  getUrl: (): Promise<string | null> =>
    ipcRenderer.invoke('backend:get-url'),
}

// File API
const fileApi = {
  openProject: (): Promise<string | null> =>
    ipcRenderer.invoke('file:open-project'),

  selectFile: (options?: { filters?: FileFilter[], title?: string }): Promise<string | null> =>
    ipcRenderer.invoke('file:select-file', options || {}),

  readEnvFile: (projectPath: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke('fs:read-env-file', projectPath),

  scanProject: (projectPath: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('fs:scan-project', projectPath),
}

// Shell API
const shellApi = {
  openExternal: (url: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('shell:open-external', url),

  openPath: (path: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('shell:open-path', path),
}

// App API
const appApi = {
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:get-version'),

  getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'logs'): Promise<string> =>
    ipcRenderer.invoke('app:get-path', name),
}

// Notification API
const notificationApi = {
  show: (options: NotificationOptions): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('notification:show', options),
}

// Expose APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  backend: backendApi,
  file: fileApi,
  shell: shellApi,
  app: appApi,
  notification: notificationApi,

  // Platform info
  platform: process.platform,
  isElectron: true,
})

// Type declaration for the renderer process
declare global {
  interface Window {
    electronAPI: {
      backend: typeof backendApi
      file: typeof fileApi
      shell: typeof shellApi
      app: typeof appApi
      notification: typeof notificationApi
      platform: NodeJS.Platform
      isElectron: boolean
    }
    // Allow accessing file.readEnvFile in non-Electron environments (returns empty)
  }
}
