/**
 * Unit tests for the Zustand app store.
 * Total: 15 tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { useAppStore } from './app-store'

// Reset store to initial state before each test
beforeEach(() => {
  useAppStore.setState({
    theme: 'dark',
    backendStatus: { status: 'stopped', port: null },
    backendUrl: null,
    currentProject: null,
    projects: [],
    sidebarCollapsed: false,
    unreadNotifications: 0,
  })
  vi.clearAllMocks()
})

// ── Theme ─────────────────────────────────────────────────────────────────────

describe('theme', () => {
  it('initial theme is dark', () => {
    expect(useAppStore.getState().theme).toBe('dark')
  })

  it('setTheme updates the theme', () => {
    act(() => { useAppStore.getState().setTheme('light') })
    expect(useAppStore.getState().theme).toBe('light')
  })

  it('setTheme accepts system theme', () => {
    act(() => { useAppStore.getState().setTheme('system') })
    expect(useAppStore.getState().theme).toBe('system')
  })
})

// ── Backend status ────────────────────────────────────────────────────────────

describe('backendStatus', () => {
  it('initial backend status is stopped', () => {
    expect(useAppStore.getState().backendStatus.status).toBe('stopped')
    expect(useAppStore.getState().backendStatus.port).toBeNull()
  })

  it('setBackendStatus updates status', () => {
    act(() => {
      useAppStore.getState().setBackendStatus({ status: 'running', port: 8000 })
    })
    expect(useAppStore.getState().backendStatus.status).toBe('running')
    expect(useAppStore.getState().backendStatus.port).toBe(8000)
  })

  it('setBackendUrl updates the URL', () => {
    act(() => { useAppStore.getState().setBackendUrl('http://localhost:8000') })
    expect(useAppStore.getState().backendUrl).toBe('http://localhost:8000')
  })

  it('setBackendUrl can be cleared to null', () => {
    act(() => { useAppStore.getState().setBackendUrl(null) })
    expect(useAppStore.getState().backendUrl).toBeNull()
  })
})

// ── Projects ──────────────────────────────────────────────────────────────────

describe('projects', () => {
  const mockProject = {
    id: 'proj-1',
    name: 'Test Project',
    path: '/test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  it('initial projects list is empty', () => {
    expect(useAppStore.getState().projects).toEqual([])
  })

  it('setProjects replaces the entire list', () => {
    act(() => { useAppStore.getState().setProjects([mockProject]) })
    expect(useAppStore.getState().projects).toHaveLength(1)
    expect(useAppStore.getState().projects[0].name).toBe('Test Project')
  })

  it('initial currentProject is null', () => {
    expect(useAppStore.getState().currentProject).toBeNull()
  })

  it('setCurrentProject updates current project', () => {
    act(() => { useAppStore.getState().setCurrentProject(mockProject) })
    expect(useAppStore.getState().currentProject?.id).toBe('proj-1')
  })

  it('setCurrentProject can be cleared to null', () => {
    act(() => { useAppStore.getState().setCurrentProject(mockProject) })
    act(() => { useAppStore.getState().setCurrentProject(null) })
    expect(useAppStore.getState().currentProject).toBeNull()
  })
})

// ── Sidebar ───────────────────────────────────────────────────────────────────

describe('sidebar', () => {
  it('initial sidebarCollapsed is false', () => {
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
  })

  it('setSidebarCollapsed toggles the sidebar', () => {
    act(() => { useAppStore.getState().setSidebarCollapsed(true) })
    expect(useAppStore.getState().sidebarCollapsed).toBe(true)
    act(() => { useAppStore.getState().setSidebarCollapsed(false) })
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
  })
})

// ── Notifications ─────────────────────────────────────────────────────────────

describe('notifications', () => {
  it('unreadNotifications defaults to zero', () => {
    expect(useAppStore.getState().unreadNotifications).toBe(0)
  })

  it('setUnreadNotifications updates count', () => {
    act(() => { useAppStore.getState().setUnreadNotifications(5) })
    expect(useAppStore.getState().unreadNotifications).toBe(5)
  })
})

// ── initializeBackend (non-Electron / dev mode) ───────────────────────────────

describe('initializeBackend', () => {
  it('sets backendUrl in dev mode (no electronAPI)', async () => {
    // window.electronAPI is already undefined from setup.ts
    await act(async () => {
      await useAppStore.getState().initializeBackend()
    })
    const state = useAppStore.getState()
    expect(state.backendStatus.status).toBe('running')
    expect(state.backendUrl).toBe('http://localhost:8000')
  })
})
