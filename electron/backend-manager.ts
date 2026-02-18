import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { app } from 'electron'
import net from 'net'

export interface BackendStatus {
  status: 'starting' | 'running' | 'stopped' | 'error'
  port: number | null
  error?: string
  pid?: number
}

export interface HealthCheckResult {
  healthy: boolean
  error?: string
  latency?: number
}

export class BackendManager {
  private process: ChildProcess | null = null
  private port: number | null = null
  private status: BackendStatus['status'] = 'stopped'
  private error: string | undefined
  private healthCheckInterval: NodeJS.Timeout | null = null
  private startupTimeout: NodeJS.Timeout | null = null

  private readonly isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  private readonly defaultPort = 8000
  private readonly healthCheckPath = '/health'
  private readonly maxStartupTime = 30000 // 30 seconds
  private readonly healthCheckIntervalMs = 10000 // 10 seconds

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'running' || this.status === 'starting') {
      return { success: true }
    }

    this.status = 'starting'
    this.error = undefined

    try {
      // In dev, use existing backend on default port if already running (e.g. Docker from make dev-electron)
      if (this.isDev) {
        const existing = await this.checkBackendAtPort(this.defaultPort)
        if (existing) {
          this.port = this.defaultPort
          this.status = 'running'
          this.startHealthCheckLoop()
          return { success: true }
        }
      }

      // Find available port and spawn our own backend
      this.port = await this.findAvailablePort(this.defaultPort)
      await this.spawnBackend()
      await this.waitForBackend()

      this.status = 'running'
      this.startHealthCheckLoop()

      return { success: true }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      this.status = 'error'
      this.error = errorMessage
      console.error('Failed to start backend:', errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /** Check if a backend is already running at the given port (e.g. Docker). */
  private async checkBackendAtPort(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${this.healthCheckPath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'stopped') {
      return { success: true }
    }

    this.stopHealthCheckLoop()
    this.clearStartupTimeout()

    const proc = this.process
    if (proc) {
      return new Promise(resolve => {
        const forceKillTimeout = setTimeout(() => {
          proc.kill('SIGKILL')
          this.cleanup()
          resolve({ success: true })
        }, 5000)

        proc.once('exit', () => {
          clearTimeout(forceKillTimeout)
          this.cleanup()
          resolve({ success: true })
        })

        proc.kill('SIGTERM')
      })
    }

    this.cleanup()
    return { success: true }
  }

  getStatus(): BackendStatus {
    return {
      status: this.status,
      port: this.port,
      error: this.error,
      pid: this.process?.pid,
    }
  }

  getBaseUrl(): string | null {
    if (this.port && this.status === 'running') {
      return `http://localhost:${this.port}`
    }
    return null
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.port || this.status !== 'running') {
      return { healthy: false, error: 'Backend not running' }
    }

    const startTime = Date.now()

    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${this.healthCheckPath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      const latency = Date.now() - startTime

      if (response.ok) {
        return { healthy: true, latency }
      } else {
        return { healthy: false, error: `HTTP ${response.status}`, latency }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      return { healthy: false, error: errorMessage }
    }
  }

  private async spawnBackend(): Promise<void> {
    const backendPath = this.getBackendPath()
    const env = {
      ...process.env,
      TESTFORGE_PORT: String(this.port),
      TESTFORGE_HOST: '127.0.0.1',
    }

    if (this.isDev) {
      // Development: use conda env testforge-env
      const condaArgs = ['run', '-n', 'testforge-env', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.port)]
      const condaCmd = process.platform === 'win32' ? 'conda.bat' : 'conda'
      this.process = spawn(condaCmd, condaArgs, {
        cwd: backendPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } else {
      // Production: run bundled executable
      const executableName = process.platform === 'win32' ? 'testforge-backend.exe' : 'testforge-backend'
      const executablePath = path.join(backendPath, executableName)

      this.process = spawn(executablePath, [], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    // Log stdout/stderr
    this.process.stdout?.on('data', (data: Buffer) => {
      console.log('[Backend]', data.toString().trim())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[Backend Error]', data.toString().trim())
    })

    this.process.on('error', (err: Error) => {
      console.error('Backend process error:', err)
      this.status = 'error'
      this.error = err.message
    })

    this.process.on('exit', (code: number | null) => {
      console.log('Backend process exited with code:', code)
      if (this.status !== 'stopped') {
        this.status = 'error'
        this.error = `Process exited with code ${code}`
      }
      this.process = null
    })
  }

  private getBackendPath(): string {
    if (this.isDev) {
      return path.join(process.cwd(), 'backend')
    }
    return path.join(process.resourcesPath, 'backend')
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    for (let port = startPort; port < startPort + 100; port++) {
      const available = await this.isPortAvailable(port)
      if (available) {
        return port
      }
    }
    throw new Error('No available ports found')
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer()

      server.once('error', () => {
        resolve(false)
      })

      server.once('listening', () => {
        server.close(() => {
          resolve(true)
        })
      })

      server.listen(port, '127.0.0.1')
    })
  }

  private async waitForBackend(): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()

      const checkHealth = async () => {
        const result = await this.healthCheck()

        if (result.healthy) {
          this.clearStartupTimeout()
          resolve()
          return
        }

        if (Date.now() - startTime > this.maxStartupTime) {
          this.clearStartupTimeout()
          reject(new Error('Backend startup timeout'))
          return
        }

        this.startupTimeout = setTimeout(checkHealth, 500)
      }

      checkHealth()
    })
  }

  private startHealthCheckLoop(): void {
    this.healthCheckInterval = setInterval(async () => {
      const result = await this.healthCheck()

      if (!result.healthy && this.status === 'running') {
        console.warn('Backend health check failed:', result.error)
        // Optionally restart the backend here
      }
    }, this.healthCheckIntervalMs)
  }

  private stopHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  private clearStartupTimeout(): void {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout)
      this.startupTimeout = null
    }
  }

  private cleanup(): void {
    this.process = null
    this.port = null
    this.status = 'stopped'
    this.error = undefined
  }
}
