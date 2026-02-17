import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Play, Settings, FileText, Activity, Plus, Trash2, Download, Sparkles } from 'lucide-react'
import { useProject } from '../hooks/useProjects'
import { apiClient } from '@/services/api-client'
import { ScanProgressModal } from './ScanProgressModal'
import { TestSuggestionsView } from './TestSuggestionsView'

interface EnvVar {
  key: string
  value: string
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { project, isLoading } = useProject(projectId!)

  // Env vars state
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [savingEnv, setSavingEnv] = useState(false)
  const [envSaved, setEnvSaved] = useState(false)

  // Scanner state
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const [scanModalOpen, setScanModalOpen] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [scanning, setScanning] = useState(false)

  // Load env_vars from project config on mount
  useEffect(() => {
    if (!project) return
    const stored =
      (project.config as { playwright_config?: { env_vars?: Record<string, string> } } | undefined)
        ?.playwright_config?.env_vars ?? {}
    setEnvVars(
      Object.entries(stored).map(([key, value]) => ({ key, value }))
    )
  }, [project])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-lg font-semibold">Project not found</h2>
        <p className="text-muted-foreground">
          The project you're looking for doesn't exist.
        </p>
      </div>
    )
  }

  // ── Env Var helpers ──────────────────────────────────────────────────
  const addEnvVar = () => setEnvVars((prev) => [...prev, { key: '', value: '' }])

  const removeEnvVar = (idx: number) =>
    setEnvVars((prev) => prev.filter((_, i) => i !== idx))

  const updateEnvVar = (idx: number, field: 'key' | 'value', val: string) =>
    setEnvVars((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row)))

  const loadFromDotEnv = async () => {
    if (!window.electronAPI) return
    try {
      const parsed = await window.electronAPI.file.readEnvFile(project.path)
      const merged: EnvVar[] = [...envVars]
      for (const [key, value] of Object.entries(parsed)) {
        const existing = merged.findIndex((r) => r.key === key)
        if (existing >= 0) {
          merged[existing].value = value
        } else {
          merged.push({ key, value })
        }
      }
      setEnvVars(merged)
    } catch {
      // Not in Electron or no .env file — silently ignore
    }
  }

  const handleStartScan = async () => {
    if (!project) return
    setScanning(true)
    try {
      let preDiscovered: Record<string, unknown> | undefined
      // If in Electron, pre-scan the project directory (25s deadline)
      if (window.electronAPI) {
        try {
          const structure = await window.electronAPI.fs.scanProject(project.path)
          preDiscovered = structure as Record<string, unknown>
        } catch {
          // Not fatal — backend will try to scan directly
        }
      }
      const res = await apiClient.startScan(project.id, preDiscovered)
      setScanJobId(res.job_id ?? (res as Record<string, unknown>).id as string)
      setScanModalOpen(true)
    } finally {
      setScanning(false)
    }
  }

  const saveEnvVars = async () => {
    setSavingEnv(true)
    try {
      const env_vars: Record<string, string> = {}
      for (const row of envVars) {
        if (row.key.trim()) env_vars[row.key.trim()] = row.value
      }
      const currentPlaywrightConfig =
        (project.config as { playwright_config?: Record<string, unknown> } | undefined)
          ?.playwright_config ?? {}
      await apiClient.updateProject(project.id, {
        config: {
          playwright_config: { ...currentPlaywrightConfig, env_vars },
        } as Record<string, unknown>,
      })
      setEnvSaved(true)
      setTimeout(() => setEnvSaved(false), 2500)
    } finally {
      setSavingEnv(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground">
            {project.description || 'No description'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline">{project.path}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Settings className="mr-2 h-4 w-4" />
            Configure
          </Button>
          <Button>
            <Play className="mr-2 h-4 w-4" />
            Run Tests
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="mr-2 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="tests">
            <FileText className="mr-2 h-4 w-4" />
            Tests
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="mr-2 h-4 w-4" />
            Configuration
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: 'Frontend Tests', desc: 'Playwright E2E tests' },
              { title: 'Backend Tests', desc: 'API integration tests' },
              { title: 'Database Tests', desc: 'Schema and query tests' },
            ].map((card) => (
              <Card key={card.title}>
                <CardHeader>
                  <CardTitle className="text-lg">{card.title}</CardTitle>
                  <CardDescription>{card.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">0</p>
                  <p className="text-sm text-muted-foreground">tests configured</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Tests ── */}
        <TabsContent value="tests" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Test Suggestions</h2>
              <p className="text-sm text-muted-foreground">
                AI-powered test generation from your project structure
              </p>
            </div>
            <Button
              onClick={handleStartScan}
              disabled={scanning}
            >
              {scanning ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  Scanning…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Scan for Tests
                </>
              )}
            </Button>
          </div>

          {showSuggestions ? (
            <TestSuggestionsView projectId={project.id} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Sparkles className="h-16 w-16 text-muted-foreground opacity-30" />
                <h3 className="mt-4 text-lg font-semibold">No suggestions yet</h3>
                <p className="mt-2 text-center text-muted-foreground text-sm">
                  Click "Scan for Tests" to analyze your project with AI and get
                  intelligent test suggestions.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Configuration ── */}
        <TabsContent value="config" className="mt-6 space-y-6">
          {/* URLs */}
          <Card>
            <CardHeader>
              <CardTitle>Project Configuration</CardTitle>
              <CardDescription>
                URLs and connection settings for this project
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: 'Frontend URL', value: project.config?.frontendUrl },
                { label: 'Backend URL', value: project.config?.backendUrl },
                { label: 'Database URL', value: (project.config as { databaseUrl?: string } | undefined)?.databaseUrl },
              ].map(({ label, value }) => (
                <div key={label}>
                  <Label className="text-sm font-medium">{label}</Label>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {value || 'Not configured'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Environment Variables */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Environment Variables</CardTitle>
                  <CardDescription>
                    Injected into tests via <code className="text-xs bg-muted px-1 rounded">os.environ</code> at runtime
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {window.electronAPI && (
                    <Button variant="outline" size="sm" onClick={loadFromDotEnv}>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Load from .env
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={addEnvVar}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Variable
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {envVars.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No environment variables configured. Click "Add Variable" to add one.
                </p>
              ) : (
                envVars.map((row, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="KEY"
                      value={row.key}
                      onChange={(e) => updateEnvVar(idx, 'key', e.target.value)}
                      className="w-48 font-mono text-xs"
                    />
                    <span className="text-muted-foreground text-sm">=</span>
                    <Input
                      placeholder="value"
                      value={row.value}
                      onChange={(e) => updateEnvVar(idx, 'value', e.target.value)}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeEnvVar(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}

              {envVars.length > 0 && (
                <div className="pt-2 flex justify-end">
                  <Button size="sm" onClick={saveEnvVars} disabled={savingEnv}>
                    {savingEnv ? 'Saving…' : envSaved ? '✓ Saved' : 'Save Variables'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Scan Progress Modal */}
      <ScanProgressModal
        open={scanModalOpen}
        projectId={project.id}
        jobId={scanJobId}
        onComplete={() => {
          setScanModalOpen(false)
          setShowSuggestions(true)
        }}
        onClose={() => {
          setScanModalOpen(false)
          if (scanJobId) setShowSuggestions(true)
        }}
      />
    </div>
  )
}
