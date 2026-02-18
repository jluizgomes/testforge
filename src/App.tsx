import { useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { Dashboard } from './features/dashboard/components/Dashboard'
import { ProjectsPage } from './features/projects/pages/ProjectsPage'
import { TestRunnerPage } from './features/test-runner/pages/TestRunnerPage'
import { TraceExplorerPage } from './features/trace-explorer/pages/TraceExplorerPage'
import { AIAssistantPage } from './features/ai-assistant/pages/AIAssistantPage'
import { ReportsPage } from './features/reports/pages/ReportsPage'
import { TestEditorPage } from './features/test-editor/pages/TestEditorPage'
import { SettingsPage } from './features/settings/pages/SettingsPage'
import { LoginPage } from './features/auth/pages/LoginPage'
import { AuthGuard } from './features/auth/components/AuthGuard'
import { apiClient } from './services/api-client'
import { useAppStore } from './stores/app-store'
import { Toaster } from './components/ui/toaster'

function App() {
  const { initializeBackend, theme, logout } = useAppStore()
  const navigate = useNavigate()

  // Wire api-client 401 → store logout + redirect to /login
  const handleUnauthorized = useCallback(() => {
    logout()
    navigate('/login', { replace: true })
  }, [logout, navigate])

  useEffect(() => {
    apiClient.onUnauthorized = handleUnauthorized
    return () => { apiClient.onUnauthorized = null }
  }, [handleUnauthorized])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    const resolved = theme === 'system'
      ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme
    root.classList.add(resolved)
  }, [theme])

  useEffect(() => {
    // Initialize backend connection
    initializeBackend()
  }, [initializeBackend])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <MainLayout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects/*" element={<ProjectsPage />} />
          <Route path="test-runner" element={<TestRunnerPage />} />
          <Route path="test-editor" element={<TestEditorPage />} />
          <Route path="traces" element={<TraceExplorerPage />} />
          <Route path="ai-assistant" element={<AIAssistantPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster />
    </div>
  )
}

export default App
