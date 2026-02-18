import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project } from '@/services/api-client'

export type { Project }

export type Theme = 'light' | 'dark' | 'system'

export interface BackendStatus {
  status: 'starting' | 'running' | 'stopped' | 'error'
  port: number | null
  error?: string
}

export interface AuthUser {
  id: string
  email: string
  is_active: boolean
  is_admin: boolean
}

interface AppState {
  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // Auth
  isAuthenticated: boolean
  authUser: AuthUser | null
  authChecked: boolean
  setAuth: (user: AuthUser | null) => void
  checkAuth: () => Promise<void>
  logout: () => void

  // Backend
  backendStatus: BackendStatus
  backendUrl: string | null
  setBackendStatus: (status: BackendStatus) => void
  setBackendUrl: (url: string | null) => void
  initializeBackend: () => Promise<void>

  // Projects
  currentProject: Project | null
  projects: Project[]
  setCurrentProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void

  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void

  // Notifications
  unreadNotifications: number
  setUnreadNotifications: (count: number) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'dark',
      setTheme: theme => set({ theme }),

      // Auth
      isAuthenticated: false,
      authUser: null,
      authChecked: false,

      setAuth: (user: AuthUser | null) =>
        set({ authUser: user, isAuthenticated: user !== null, authChecked: true }),

      checkAuth: async () => {
        const { apiClient } = await import('@/services/api-client')
        const token = apiClient.getToken()
        if (!token) {
          // No token — check if auth is even required (auth_enabled=false)
          try {
            const me = await apiClient.getMe()
            // If getMe works without token, auth is disabled
            set({ authUser: me, isAuthenticated: true, authChecked: true })
          } catch {
            set({ authUser: null, isAuthenticated: false, authChecked: true })
          }
          return
        }
        try {
          const user = await apiClient.getMe()
          set({ authUser: user, isAuthenticated: true, authChecked: true })
        } catch {
          apiClient.setToken(null)
          set({ authUser: null, isAuthenticated: false, authChecked: true })
        }
      },

      logout: () => {
        import('@/services/api-client').then(({ apiClient }) => {
          apiClient.logout()
        })
        set({ authUser: null, isAuthenticated: false })
      },

      // Backend
      backendStatus: { status: 'stopped', port: null },
      backendUrl: null,
      setBackendStatus: backendStatus => set({ backendStatus }),
      setBackendUrl: backendUrl => set({ backendUrl }),

      initializeBackend: async () => {
        // Check if running in Electron
        if (typeof window !== 'undefined' && window.electronAPI) {
          try {
            // Get backend status
            const status = await window.electronAPI.backend.getStatus()
            set({ backendStatus: status })

            if (status.status === 'running') {
              const url = await window.electronAPI.backend.getUrl()
              set({ backendUrl: url })
            } else if (status.status === 'stopped') {
              // Start backend
              set({ backendStatus: { status: 'starting', port: null } })
              const result = await window.electronAPI.backend.start()

              if (result.success) {
                const url = await window.electronAPI.backend.getUrl()
                const newStatus = await window.electronAPI.backend.getStatus()
                set({ backendUrl: url, backendStatus: newStatus })
              } else {
                set({
                  backendStatus: {
                    status: 'error',
                    port: null,
                    error: result.error,
                  },
                })
              }
            }
          } catch (error) {
            console.error('Failed to initialize backend:', error)
            set({
              backendStatus: {
                status: 'error',
                port: null,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            })
          }
        } else {
          // Development without Electron: backend in Docker or local (localhost:8000)
          set({
            backendUrl: 'http://localhost:8000',
            backendStatus: { status: 'running', port: 8000 },
          })
        }
      },

      // Projects
      currentProject: null,
      projects: [],
      setCurrentProject: currentProject => set({ currentProject }),
      setProjects: projects => set({ projects }),

      // Sidebar
      sidebarCollapsed: false,
      setSidebarCollapsed: sidebarCollapsed => set({ sidebarCollapsed }),

      // Notifications
      unreadNotifications: 0,
      setUnreadNotifications: unreadNotifications =>
        set({ unreadNotifications }),
    }),
    {
      name: 'testforge-app-storage',
      partialize: state => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        currentProject: state.currentProject,
      }),
    }
  )
)
