import { useAppStore } from '@/stores/app-store'

// ── Health ────────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy'
  latency_ms?: number
  error?: string
}

export interface HealthData {
  status: string
  version: string
  services: {
    database?: ServiceHealth
    redis?: ServiceHealth
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

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

// ── Scanner ───────────────────────────────────────────────────────────────────

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

// ── Projects ──────────────────────────────────────────────────────────────────

export interface ProjectConfig {
  id?: string
  project_id?: string
  frontend_url?: string | null
  backend_url?: string | null
  openapi_url?: string | null
  database_url?: string | null
  redis_url?: string | null
  playwright_config?: Record<string, unknown> | null
  test_timeout?: number
  parallel_workers?: number
  retry_count?: number
  browser?: string | null
  test_login_email?: string | null
  test_login_password?: string | null
  ai_provider?: string | null
  ai_model?: string | null
  created_at?: string
  updated_at?: string
}

export interface Project {
  id: string
  name: string
  path: string
  description?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  config?: ProjectConfig | null
}

export interface CreateProjectInput {
  name: string
  path: string
  description?: string
  config?: {
    frontend_url?: string
    backend_url?: string
    openapi_url?: string
    database_url?: string
    redis_url?: string
    playwright_config?: Record<string, unknown>
  }
}

// ── Network ───────────────────────────────────────────────────────────────────

export interface NetworkRequest {
  url: string
  method: string
  status?: number
  content_type?: string
  timestamp: string
  headers?: Record<string, string>
}

// ── Test Runs ─────────────────────────────────────────────────────────────────

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
  project_id: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled'
  started_at: string | null
  completed_at: string | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  duration_ms: number | null
  config: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  updated_at: string
  results?: TestResultItem[]
}

// ── Traces ────────────────────────────────────────────────────────────────────

export interface Span {
  id: string
  span_id: string
  parent_span_id: string | null
  service: string
  operation: string
  start_time: string
  end_time: string
  duration_ms: number
  status: string
  error_message: string | null
  attributes: Record<string, unknown> | null
  events: unknown[] | null
}

export interface Trace {
  id: string
  test_run_id: string
  trace_id: string
  start_time: string
  end_time: string | null
  duration_ms: number | null
  root_service: string
  root_operation: string
  status: string
  error_message: string | null
  attributes: Record<string, unknown> | null
  created_at: string
  spans: Span[] | null
}

// ── Workspace Sync ────────────────────────────────────────────────────────────

export interface WorkspaceSyncStatus {
  synced: boolean
  file_count: number
  total_size_bytes: number
  last_synced_at: string | null
  files: string[]   // up to 500 relative paths; persisted via manifest on the backend
}

// ── Code Quality ──────────────────────────────────────────────────────────────

export interface CodeQualityInsight {
  severity: 'error' | 'warning' | 'suggestion'
  category: string
  title: string
  description: string
  affected_tests: string[]
  fix: string
}

export interface FailureAnalysis {
  test_name: string
  root_cause?: string | null
  suggestions: string[]
  confidence: number
}

export interface CodeQualityResult {
  quality_score: number
  grade: string
  summary: string
  insights: CodeQualityInsight[]
  patterns: { pattern: string; count: number; tests: string[] }[]
  failure_analyses: FailureAnalysis[]
}

// ── Report Schedules ──────────────────────────────────────────────────────────

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

// ── API Client ────────────────────────────────────────────────────────────────

class ApiClient {
  private static readonly DEFAULT_BASE_URL = 'http://localhost:8001'

  getBaseUrl(): string {
    // In browser dev (same origin as Vite), use proxy to avoid CORS
    if (import.meta.env.DEV && typeof window !== 'undefined' && !window.electronAPI) return ''
    let storeUrl = useAppStore.getState().backendUrl
    // In dev, stored 8000 often points to another app (e.g. Aurora); prefer TestForge Docker on 8001
    if (import.meta.env.DEV && storeUrl === 'http://localhost:8000') storeUrl = 'http://localhost:8001'
    if (storeUrl) return storeUrl
    const envUrl = import.meta.env.VITE_API_URL
    if (envUrl !== undefined && envUrl !== '') return envUrl
    if (import.meta.env.DEV) return ''
    return ApiClient.DEFAULT_BASE_URL
  }

  // ── HTTP helper ──────────────────────────────────────────────────────────

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `HTTP error ${response.status}`)
    }

    return response.json()
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<HealthData> {
    return this.request('/health')
  }

  // ── Projects ────────────────────────────────────────────────────────────────

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
    data: Partial<CreateProjectInput> & { config?: Record<string, unknown> }
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

  // ── Test Runs ───────────────────────────────────────────────────────────────

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
      body: JSON.stringify({ config: config ?? null }),
    })
  }

  async deleteTestRun(projectId: string, runId: string): Promise<void> {
    await this.request(`/api/v1/projects/${projectId}/runs/${runId}`, {
      method: 'DELETE',
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

  // ── Traces ──────────────────────────────────────────────────────────────────

  async getTraces(runId?: string, limit = 50): Promise<Trace[]> {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (runId) qs.set('run_id', runId)
    return this.request(`/api/v1/traces?${qs.toString()}`)
  }

  async getTrace(traceId: string): Promise<Trace> {
    return this.request(`/api/v1/traces/${traceId}?include_spans=true`)
  }

  // ── AI ──────────────────────────────────────────────────────────────────────

  async generateTests(
    projectId: string,
    prompt: string
  ): Promise<{ tests: string[] }> {
    return this.request('/api/v1/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, prompt }),
    })
  }

  async analyzeFailure(
    runId: string,
    testId: string
  ): Promise<{ analysis: string; suggestions: string[] }> {
    return this.request('/api/v1/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ run_id: runId, test_id: testId }),
    })
  }

  async chat(
    projectId: string,
    message: string,
    history?: Array<{ role: string; content: string }>
  ): Promise<{ response: string; context_used?: string[] }> {
    return this.request('/api/v1/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, message, history }),
    })
  }

  // ── Reports ─────────────────────────────────────────────────────────────────

  async generateReport(
    projectId: string,
    runId: string,
    format: 'html' | 'pdf' | 'json' | 'xml' | 'markdown'
  ): Promise<Blob> {
    const response = await fetch(
      `${this.getBaseUrl()}/api/v1/reports/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, run_id: runId, format }),
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to generate report: ${response.status}`)
    }

    return response.blob()
  }

  async getCodeQuality(
    projectId: string,
    runId: string,
    includeAI = false
  ): Promise<CodeQualityResult> {
    return this.request('/api/v1/reports/quality', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        run_id: runId,
        include_ai_analysis: includeAI,
      }),
    })
  }

  // ── Scanner ─────────────────────────────────────────────────────────────────

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
    entry_points_by_type: Record<string, number>
    tests_by_type: Record<string, number>
    error_message?: string
  }> {
    return this.request(`/api/v1/scan/status/${jobId}`)
  }

  async getScanStats(projectId: string): Promise<{
    entry_points_by_type: Record<string, number>
    tests_by_type: Record<string, number>
    total_resources: number
    total_tests: number
  }> {
    return this.request(`/api/v1/scan/stats/${projectId}`)
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

  async deleteGeneratedTest(testId: string): Promise<void> {
    await fetch(`${this.getBaseUrl()}/api/v1/scan/generated-tests/${testId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async exportAcceptedTests(projectId: string): Promise<Blob> {
    const response = await fetch(
      `${this.getBaseUrl()}/api/v1/scan/export/${projectId}`,
    )
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `HTTP error ${response.status}`)
    }
    return response.blob()
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    return this.request('/api/v1/settings')
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    return this.request('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
  }

  // ── Report Schedules ────────────────────────────────────────────────────────

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

  // ── Validate connections ────────────────────────────────────────────────────

  async validateConnection(
    type: 'database' | 'redis' | 'api',
    url: string
  ): Promise<ConnectionValidateResponse> {
    return this.request('/api/v1/settings/validate', {
      method: 'POST',
      body: JSON.stringify({ type, url }),
    })
  }

  // ── Workspace Sync ───────────────────────────────────────────────────────────

  async getWorkspaceStatus(projectId: string): Promise<WorkspaceSyncStatus> {
    return this.request(`/api/v1/projects/${projectId}/workspace`)
  }

  async clearWorkspace(projectId: string): Promise<void> {
    await this.request(`/api/v1/projects/${projectId}/workspace`, {
      method: 'DELETE',
    })
  }

  async scaffoldProjectTests(projectId: string): Promise<{
    structure: Record<string, unknown>
    created_files: string[]
    created_files_with_content: { path: string; content: string }[]
    total_files: number
  }> {
    return this.request(`/api/v1/projects/${projectId}/workspace/scaffold`, {
      method: 'POST',
    })
  }

  async downloadWorkspace(projectId: string): Promise<Blob> {
    const url = `${this.getBaseUrl()}/api/v1/projects/${projectId}/workspace/download`
    const response = await fetch(url)
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error((err as { detail?: string }).detail || `HTTP ${response.status}`)
    }
    return response.blob()
  }
}

export const apiClient = new ApiClient()
