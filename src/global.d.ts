/* Global type augmentations for the renderer process. */

interface ElectronBackendApi {
  start(): Promise<{ success: boolean; error?: string }>
  stop(): Promise<{ success: boolean; error?: string }>
  getStatus(): Promise<{ status: 'starting' | 'running' | 'stopped' | 'error'; port: number | null; error?: string }>
  healthCheck(): Promise<{ healthy: boolean; error?: string; latency?: number }>
  getUrl(): Promise<string | null>
}

interface ElectronFileApi {
  openProject(): Promise<string | null>
  selectFile(options?: { filters?: { name: string; extensions: string[] }[]; title?: string }): Promise<string | null>
  readEnvFile(projectPath: string): Promise<Record<string, string>>
  scanProject(projectPath: string): Promise<Record<string, unknown>>
}

interface ElectronShellApi {
  openExternal(url: string): Promise<{ success: boolean }>
  openPath(path: string): Promise<{ success: boolean }>
}

interface ElectronAppApi {
  getVersion(): Promise<string>
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'logs'): Promise<string>
}

interface ElectronNotificationApi {
  show(options: { title: string; body: string }): Promise<{ success: boolean; error?: string }>
}

interface ElectronAPI {
  backend: ElectronBackendApi
  file: ElectronFileApi
  shell: ElectronShellApi
  app: ElectronAppApi
  notification: ElectronNotificationApi
  platform: NodeJS.Platform
  isElectron: boolean
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
