import { useAppStore } from '@/stores/app-store'

// Types
export interface AppSettings {
  ai_provider: string
  ai_model: string
  openai_api_key: string
  ollama_url: string
  notifications_desktop: boolean
  notifications_sound: boolean
  runner_parallel: boolean
  runner_auto_retry: boolean
  runner_screenshot_on_failure: boolean
  rag_auto_index: boolean
  rag_include_openapi: boolean
}

export interface GeneratedTestItem {
  id: string
  scan_job_id: string
  project_id: string
  test_name: string
  test_code: string
  test_type: string
  entry_point?: string
  accepted: boolean
  created_at: string
}

export interface ConnectionValidateResponse {
  connected: boolean
  latency_ms?: number
  error?: string
}

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

export interface NetworkRequest {
  url: string
  method: string
  status?: number
  content_type?: string
  timestamp: string
  headers?: Record<string, string>
}

export interface TestResultItem {
  id: string
  test_run_id: string
  test_name: string
  test_file?: string
  test_suite?: string
  test_layer: string
  status: 'passed' | 'failed' | 'skipped' | 'error'
  duration_ms?: number
  error_message?: string
  error_stack?: string
  screenshot_path?: string
  video_path?: string
  trace_id?: string
  metadata?: {
    network_requests?: NetworkRequest[]
    [key: string]: unknown
  }
  created_at: string
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

export interface ReportSchedule {
  id: string
  project_id: string
  name: string
  cron_expr: string
  format: string
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  run_count: number
  created_at: string
}

export interface CreateScheduleInput {
  project_id: string
  name: string
  cron_expr: string
  format?: string
  enabled?: boolean
}

// API Client Class
class ApiClient {
  private getBaseUrl(): string {
    // Try to get from store first, fall back to env or default
    const storeUrl = useAppStore.getState().backendUrl
    if (storeUrl) return storeUrl

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Will be set after backend starts
      return 'http://jluizgomes.local:8000'
    }

    return import.meta.env.VITE_API_URL || 'http://jluizgomes.local:8000'
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

  async getTestRunResults(projectId: string, runId: string): Promise<TestResultItem[]> {
    return this.request(`/api/v1/projects/${projectId}/runs/${runId}/results`)
  }

  async updateProject(id: string, data: Record<string, unknown>): Promise<Project> {
    return this.request(`/api/v1/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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

  // Scanner
  async startScan(
    projectId: string,
    preDiscoveredStructure?: Record<string, unknown>
  ): Promise<{ job_id: string; status: string; progress: number }> {
    return this.request('/api/v1/scan', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        pre_discovered_structure: preDiscoveredStructure ?? null,
      }),
    })
  }

  async getScanStatus(jobId: string): Promise<{
    job_id: string
    status: string
    progress: number
    files_found: number
    entry_points_found: number
    tests_generated: number
    error_message?: string
  }> {
    return this.request(`/api/v1/scan/status/${jobId}`)
  }

  async getGeneratedTests(projectId: string): Promise<GeneratedTestItem[]> {
    return this.request(`/api/v1/scan/generated-tests/${projectId}`)
  }

  async acceptGeneratedTest(testId: string, accepted: boolean): Promise<GeneratedTestItem> {
    return this.request(`/api/v1/scan/generated-tests/${testId}`, {
      method: 'PATCH',
      body: JSON.stringify({ accepted }),
    })
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    return this.request('/api/v1/settings')
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    return this.request('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
  }

  // Report Schedules
  async getSchedules(projectId?: string): Promise<ReportSchedule[]> {
    const qs = projectId ? `?project_id=${projectId}` : ''
    return this.request(`/api/v1/report-schedules${qs}`)
  }

  async createSchedule(data: CreateScheduleInput): Promise<ReportSchedule> {
    return this.request('/api/v1/report-schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateSchedule(
    id: string,
    data: Partial<Pick<ReportSchedule, 'name' | 'cron_expr' | 'format' | 'enabled'>>
  ): Promise<ReportSchedule> {
    return this.request(`/api/v1/report-schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteSchedule(id: string): Promise<void> {
    return this.request(`/api/v1/report-schedules/${id}`, {
      method: 'DELETE',
    })
  }

  // Validate connections
  async validateConnection(
    type: 'database' | 'redis' | 'api',
    url: string
  ): Promise<ConnectionValidateResponse> {
    return this.request('/api/v1/settings/validate', {
      method: 'POST',
      body: JSON.stringify({ type, url }),
    })
  }
}

export const apiClient = new ApiClient()
