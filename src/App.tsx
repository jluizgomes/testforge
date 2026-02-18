import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { Dashboard } from './features/dashboard/components/Dashboard'
import { ProjectsPage } from './features/projects/pages/ProjectsPage'
import { TestRunnerPage } from './features/test-runner/pages/TestRunnerPage'
import { TraceExplorerPage } from './features/trace-explorer/pages/TraceExplorerPage'
import { AIAssistantPage } from './features/ai-assistant/pages/AIAssistantPage'
import { ReportsPage } from './features/reports/pages/ReportsPage'
import { TestEditorPage } from './features/test-editor/pages/TestEditorPage'
import { SettingsPage } from './features/settings/pages/SettingsPage'
import { useAppStore } from './stores/app-store'
import { Toaster } from './components/ui/toaster'

function App() {
  const { initializeBackend, theme } = useAppStore()

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    const resolved = theme === 'system'
      ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme
    root.classList.add(resolved)
  }, [theme])

  useEffect(() => {
    initializeBackend()
  }, [initializeBackend])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/" element={<MainLayout />}>
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
