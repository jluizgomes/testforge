import { useAppStore } from '@/stores/app-store'

// Types
export interface Project {
  id: string
  name: string
  path: string
  description?: string
  createdAt: string
  updatedAt: string
  config?: ProjectConfig
}

export interface ProjectConfig {
  frontendUrl?: string
  backendUrl?: string
  databaseUrl?: string
  redisUrl?: string
}

export interface CreateProjectInput {
  name: string
  path: string
  description?: string
  config?: ProjectConfig
}

export interface TestRun {
  id: string
  projectId: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  startedAt: string
  completedAt?: string
  results?: TestResults
}

export interface TestResults {
  total: number
  passed: number
  failed: number
  skipped: number
  duration: number
}

export interface Trace {
  id: string
  testRunId: string
  traceId: string
  spans: Span[]
  createdAt: string
}

export interface Span {
  id: string
  parentId?: string
  name: string
  service: string
  startTime: number
  endTime: number
  status: 'ok' | 'error'
  attributes?: Record<string, unknown>
}

// API Client Class
class ApiClient {
  private getBaseUrl(): string {
    // Try to get from store first, fall back to env or default
    const storeUrl = useAppStore.getState().backendUrl
    if (storeUrl) return storeUrl

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Will be set after backend starts
      return 'http://localhost:8000'
    }

    return import.meta.env.VITE_API_URL || 'http://localhost:8000'
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `HTTP error ${response.status}`)
    }

    return response.json()
  }

  // Health
  async healthCheck(): Promise<{ status: string }> {
    return this.request('/health')
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    return this.request('/api/v1/projects')
  }

  async getProject(id: string): Promise<Project> {
    return this.request(`/api/v1/projects/${id}`)
  }

  async createProject(data: CreateProjectInput): Promise<Project> {
    return this.request('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateProject(
    id: string,
    data: Partial<CreateProjectInput>
  ): Promise<Project> {
    return this.request(`/api/v1/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteProject(id: string): Promise<void> {
    return this.request(`/api/v1/projects/${id}`, {
      method: 'DELETE',
    })
  }

  // Test Runs
  async getTestRuns(projectId: string): Promise<TestRun[]> {
    return this.request(`/api/v1/projects/${projectId}/runs`)
  }

  async getTestRun(projectId: string, runId: string): Promise<TestRun> {
    return this.request(`/api/v1/projects/${projectId}/runs/${runId}`)
  }

  async startTestRun(
    projectId: string,
    config?: Record<string, unknown>
  ): Promise<TestRun> {
    return this.request(`/api/v1/projects/${projectId}/runs`, {
      method: 'POST',
      body: JSON.stringify(config || {}),
    })
  }

  async stopTestRun(projectId: string, runId: string): Promise<TestRun> {
    return this.request(`/api/v1/projects/${projectId}/runs/${runId}/stop`, {
      method: 'POST',
    })
  }

  // Traces
  async getTraces(runId: string): Promise<Trace[]> {
    return this.request(`/api/v1/traces?run_id=${runId}`)
  }

  async getTrace(traceId: string): Promise<Trace> {
    return this.request(`/api/v1/traces/${traceId}`)
  }

  // AI
  async generateTests(
    projectId: string,
    prompt: string
  ): Promise<{ tests: string[] }> {
    return this.request('/api/v1/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ projectId, prompt }),
    })
  }

  async analyzeFailure(
    runId: string,
    testId: string
  ): Promise<{ analysis: string; suggestions: string[] }> {
    return this.request('/api/v1/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ runId, testId }),
    })
  }

  async chat(
    projectId: string,
    message: string,
    history?: Array<{ role: string; content: string }>
  ): Promise<{ response: string }> {
    return this.request('/api/v1/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ projectId, message, history }),
    })
  }

  // Reports
  async generateReport(
    projectId: string,
    runId: string,
    format: 'html' | 'pdf' | 'json'
  ): Promise<Blob> {
    const response = await fetch(
      `${this.getBaseUrl()}/api/v1/reports/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, runId, format }),
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to generate report: ${response.status}`)
    }

    return response.blob()
  }

  // Validate connections
  async validateConnection(
    type: 'database' | 'redis' | 'api',
    url: string
  ): Promise<{ connected: boolean; error?: string }> {
    return this.request('/api/v1/validate-connection', {
      method: 'POST',
      body: JSON.stringify({ type, url }),
    })
  }
}

export const apiClient = new ApiClient()
