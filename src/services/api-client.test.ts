/**
 * Unit tests for ApiClient.
 * Total: 15 tests
 *
 * All tests stub global.fetch to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient } from './api-client'

// ── Fetch stub helpers ──────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  } as Response)
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Reset store backendUrl so we use the fallback URL
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Projects ────────────────────────────────────────────────────────────────

describe('apiClient.getProjects', () => {
  it('calls GET /api/v1/projects and returns array', async () => {
    fetchSpy = mockFetch([{ id: '1', name: 'Project A', path: '/a' }])
    const result = await apiClient.getProjects()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Project A')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects'),
      expect.any(Object)
    )
  })
})

describe('apiClient.getProject', () => {
  it('calls GET /api/v1/projects/:id', async () => {
    fetchSpy = mockFetch({ id: 'abc', name: 'Single', path: '/s' })
    const result = await apiClient.getProject('abc')
    expect(result.id).toBe('abc')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/abc'),
      expect.any(Object)
    )
  })
})

describe('apiClient.createProject', () => {
  it('calls POST /api/v1/projects with body', async () => {
    const project = { id: 'new-1', name: 'New', path: '/new' }
    fetchSpy = mockFetch(project, 201)
    const result = await apiClient.createProject({ name: 'New', path: '/new' })
    expect(result.id).toBe('new-1')
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})

describe('apiClient.updateProject', () => {
  it('calls PATCH /api/v1/projects/:id', async () => {
    fetchSpy = mockFetch({ id: 'u1', name: 'Updated', path: '/u' })
    await apiClient.updateProject('u1', { name: 'Updated' })
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/u1'),
      expect.any(Object)
    )
  })
})

describe('apiClient.deleteProject', () => {
  it('calls DELETE /api/v1/projects/:id', async () => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    } as Response)
    await apiClient.deleteProject('d1')
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })
})

// ── Test Runs ────────────────────────────────────────────────────────────────

describe('apiClient.startTestRun', () => {
  it('calls POST /api/v1/projects/:id/runs', async () => {
    fetchSpy = mockFetch({ id: 'run-1', status: 'pending' }, 200)
    await apiClient.startTestRun('proj-1')
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/proj-1/runs'),
      expect.any(Object)
    )
  })
})

describe('apiClient.getTestRun', () => {
  it('calls GET /api/v1/projects/:pid/runs/:rid', async () => {
    fetchSpy = mockFetch({ id: 'run-2', status: 'passed' })
    const result = await apiClient.getTestRun('proj-1', 'run-2')
    expect(result.status).toBe('passed')
  })
})

describe('apiClient.getTestRunResults', () => {
  it('returns array of test results', async () => {
    fetchSpy = mockFetch([{ id: 'res-1', test_name: 'Login', status: 'passed' }])
    const results = await apiClient.getTestRunResults('proj-1', 'run-1')
    expect(results).toHaveLength(1)
    expect(results[0].test_name).toBe('Login')
  })
})

// ── Settings ─────────────────────────────────────────────────────────────────

describe('apiClient.getSettings', () => {
  it('calls GET /api/v1/settings', async () => {
    const settings = { ai_provider: 'openai', ai_model: 'gpt-4' }
    fetchSpy = mockFetch(settings)
    const result = await apiClient.getSettings()
    expect(result.ai_provider).toBe('openai')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/settings'),
      expect.any(Object)
    )
  })
})

describe('apiClient.updateSettings', () => {
  it('calls PATCH /api/v1/settings', async () => {
    fetchSpy = mockFetch({ ai_provider: 'ollama' })
    await apiClient.updateSettings({ ai_provider: 'ollama' })
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
  })
})

// ── Scanner ───────────────────────────────────────────────────────────────────

describe('apiClient.startScan', () => {
  it('calls POST /api/v1/scan with project_id', async () => {
    fetchSpy = mockFetch({ job_id: 'job-1', status: 'pending', progress: 0 })
    const result = await apiClient.startScan('proj-1')
    expect(result.job_id).toBe('job-1')
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})

describe('apiClient.getScanStatus', () => {
  it('calls GET /api/v1/scan/status/:jobId', async () => {
    fetchSpy = mockFetch({ job_id: 'job-1', status: 'completed', progress: 100 })
    const result = await apiClient.getScanStatus('job-1')
    expect(result.status).toBe('completed')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/scan/status/job-1'),
      expect.any(Object)
    )
  })
})

describe('apiClient.getGeneratedTests', () => {
  it('returns generated test items for a project', async () => {
    fetchSpy = mockFetch([{ id: 't-1', test_name: 'Login test', accepted: false }])
    const result = await apiClient.getGeneratedTests('proj-1')
    expect(result).toHaveLength(1)
    expect(result[0].test_name).toBe('Login test')
  })
})

// ── Validate connection ───────────────────────────────────────────────────────

describe('apiClient.validateConnection', () => {
  it('calls POST /api/v1/settings/validate and returns status', async () => {
    fetchSpy = mockFetch({ connected: true, latency_ms: 5 })
    const result = await apiClient.validateConnection('database', 'postgresql://localhost/db')
    expect(result.connected).toBe(true)
    expect(result.latency_ms).toBe(5)
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
})

describe('apiClient.acceptGeneratedTest', () => {
  it('calls PATCH /api/v1/scan/generated-tests/:id', async () => {
    fetchSpy = mockFetch({ id: 't-1', accepted: true })
    const result = await apiClient.acceptGeneratedTest('t-1', true)
    expect(result.accepted).toBe(true)
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
  })
})
