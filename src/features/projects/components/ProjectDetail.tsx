import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import {
  Play,
  Settings,
  FileText,
  Activity,
  Plus,
  Trash2,
  Download,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  Loader2,
  Pencil,
  FolderOpen,
  X,
} from 'lucide-react'
import { useProject } from '../hooks/useProjects'
import { apiClient } from '@/services/api-client'
import { useAppStore } from '@/stores/app-store'
import { ScanProgressModal } from './ScanProgressModal'
import { TestSuggestionsView } from './TestSuggestionsView'
import { formatDate, formatDuration } from '@/lib/utils'

interface EnvVar {
  key: string
  value: string
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { project, isLoading } = useProject(projectId!)
  const navigate = useNavigate()
  const setCurrentProject = useAppStore(s => s.setCurrentProject)
  const queryClient = useQueryClient()

  // Controlled tab
  const [activeTab, setActiveTab] = useState('overview')
  const tabsRef = useRef<HTMLDivElement>(null)

  // Path edit state
  const [editingPath, setEditingPath] = useState(false)
  const [pathValue, setPathValue] = useState('')
  const [savingPath, setSavingPath] = useState(false)

  // Env vars state
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [savingEnv, setSavingEnv] = useState(false)
  const [envSaved, setEnvSaved] = useState(false)

  // Config edit state
  const [configEdits, setConfigEdits] = useState({
    frontend_url: '',
    backend_url: '',
    database_url: '',
    openapi_url: '',
    redis_url: '',
    test_login_email: '',
    test_login_password: '',
  })
  const [savingConfig, setSavingConfig] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)

  // Scanner state
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const [scanModalOpen, setScanModalOpen] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [scanning, setScanning] = useState(false)

  // Auto-show suggestions if previous scan results exist
  useEffect(() => {
    if (!projectId || showSuggestions) return
    apiClient.getGeneratedTests(projectId).then(tests => {
      if (tests.length > 0) setShowSuggestions(true)
    }).catch(() => {/* ignore */})
  }, [projectId, showSuggestions])

  // Test runs for overview stats
  const { data: testRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['test-runs', projectId],
    queryFn: () => apiClient.getTestRuns(projectId!),
    enabled: !!projectId,
  })

  // Load config + env_vars when project loads
  useEffect(() => {
    if (!project) return

    const pwConfig = project.config?.playwright_config as
      | { env_vars?: Record<string, string> }
      | null
      | undefined
    const stored = pwConfig?.env_vars ?? {}
    setEnvVars(Object.entries(stored).map(([key, value]) => ({ key, value })))

    setConfigEdits({
      frontend_url: project.config?.frontend_url ?? '',
      backend_url: project.config?.backend_url ?? '',
      database_url: project.config?.database_url ?? '',
      openapi_url: project.config?.openapi_url ?? '',
      redis_url: project.config?.redis_url ?? '',
      test_login_email: project.config?.test_login_email ?? '',
      test_login_password: project.config?.test_login_password ?? '',
    })
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

  // ── Button handlers ───────────────────────────────────────────────────
  const handleRunTests = () => {
    setCurrentProject(project)
    navigate('/test-runner')
  }

  const handleConfigure = () => {
    setActiveTab('config')
    setTimeout(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const handleEditPath = () => {
    setPathValue(project?.path ?? '')
    setEditingPath(true)
  }

  const handleBrowsePath = async () => {
    if (!window.electronAPI) return
    const picked = await window.electronAPI.file.openProject()
    if (picked) setPathValue(picked)
  }

  const handleSavePath = async () => {
    if (!pathValue.trim() || !project) return
    setSavingPath(true)
    try {
      await apiClient.updateProject(project.id, { path: pathValue.trim() })
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      setEditingPath(false)
    } finally {
      setSavingPath(false)
    }
  }

  // ── Env Var helpers ───────────────────────────────────────────────────
  const addEnvVar = () => setEnvVars(prev => [...prev, { key: '', value: '' }])

  const removeEnvVar = (idx: number) =>
    setEnvVars(prev => prev.filter((_, i) => i !== idx))

  const updateEnvVar = (idx: number, field: 'key' | 'value', val: string) =>
    setEnvVars(prev => prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row)))

  const loadFromDotEnv = async () => {
    if (!window.electronAPI) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = await (window as any).electronAPI.file.readEnvFile(project.path) as Record<string, string>
      const merged: EnvVar[] = [...envVars]
      for (const [key, value] of Object.entries(parsed)) {
        const existing = merged.findIndex(r => r.key === key)
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

  const saveEnvVars = async () => {
    setSavingEnv(true)
    try {
      const env_vars: Record<string, string> = {}
      for (const row of envVars) {
        if (row.key.trim()) env_vars[row.key.trim()] = row.value
      }
      const currentPlaywrightConfig =
        (project.config?.playwright_config as Record<string, unknown> | null | undefined) ?? {}
      await apiClient.updateProject(project.id, {
        config: {
          playwright_config: { ...currentPlaywrightConfig, env_vars },
        },
      })
      setEnvSaved(true)
      setTimeout(() => setEnvSaved(false), 2500)
    } finally {
      setSavingEnv(false)
    }
  }

  // ── Config URL save ───────────────────────────────────────────────────
  // Config save error
  const [configError, setConfigError] = useState<string | null>(null)

  const saveConfig = async () => {
    setSavingConfig(true)
    setConfigError(null)
    try {
      await apiClient.updateProject(project.id, {
        config: {
          frontend_url: configEdits.frontend_url || undefined,
          backend_url: configEdits.backend_url || undefined,
          database_url: configEdits.database_url || undefined,
          openapi_url: configEdits.openapi_url || undefined,
          redis_url: configEdits.redis_url || undefined,
          test_login_email: configEdits.test_login_email || undefined,
          test_login_password: configEdits.test_login_password || undefined,
        },
      })
      setConfigSaved(true)
      setTimeout(() => setConfigSaved(false), 2500)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  // ── Scanner ───────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    if (!project) return
    setScanning(true)
    try {
      let preDiscovered: Record<string, unknown> | undefined

      if (window.electronAPI) {
        // Electron: pre-scan the local filesystem using the stored project path
        try {
          const structure = await window.electronAPI.file.scanProject(project.path)
          preDiscovered = structure as Record<string, unknown>
        } catch {
          // Not fatal — backend will scan the path directly
        }
      }
      // Browser mode: send null and let the backend scan project.path directly

      const res = await apiClient.startScan(project.id, preDiscovered)
      setScanJobId(res.job_id)
      setScanModalOpen(true)
    } finally {
      setScanning(false)
    }
  }

  // ── Overview stats ────────────────────────────────────────────────────
  const lastRun = testRuns[0] ?? null
  const passRate =
    lastRun && lastRun.total_tests > 0
      ? Math.round((lastRun.passed_tests / lastRun.total_tests) * 100)
      : null

  const overviewStats = [
    {
      title: 'Total Runs',
      value: runsLoading ? '…' : String(testRuns.length),
      desc: 'executions recorded',
      icon: Activity,
    },
    {
      title: 'Last Run',
      value: runsLoading
        ? '…'
        : lastRun
          ? `${lastRun.passed_tests}/${lastRun.total_tests}`
          : '—',
      desc: runsLoading
        ? ''
        : lastRun
          ? lastRun.failed_tests > 0
            ? `${lastRun.failed_tests} failed`
            : 'All passing'
          : 'No runs yet',
      icon: lastRun?.status === 'passed' ? CheckCircle2 : lastRun?.status === 'failed' ? XCircle : Clock,
    },
    {
      title: 'Pass Rate',
      value: runsLoading ? '…' : passRate !== null ? `${passRate}%` : '—',
      desc: runsLoading
        ? ''
        : lastRun
          ? `Last run ${formatDate(lastRun.created_at)}`
          : 'Run tests to see metrics',
      icon: TrendingUp,
    },
  ]

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
            {editingPath ? (
              <>
                <Input
                  value={pathValue}
                  onChange={e => setPathValue(e.target.value)}
                  className="h-7 w-80 font-mono text-xs"
                  placeholder="/path/to/project"
                  disabled={savingPath}
                />
                {window.electronAPI && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleBrowsePath}
                    disabled={savingPath}
                  >
                    <FolderOpen className="mr-1 h-3.5 w-3.5" />
                    Browse
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleSavePath}
                  disabled={savingPath || !pathValue.trim()}
                >
                  {savingPath ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">Save</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditingPath(false)}
                  disabled={savingPath}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Badge variant="outline" className="font-mono text-xs">
                  {project.path}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleEditPath}
                  title="Edit project path"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleConfigure}>
            <Settings className="mr-2 h-4 w-4" />
            Configure
          </Button>
          <Button onClick={handleRunTests}>
            <Play className="mr-2 h-4 w-4" />
            Run Tests
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div ref={tabsRef}>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
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
        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Stats cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {overviewStats.map(({ title, value, desc, icon: Icon }) => (
              <Card key={title}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {title}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Recent runs table */}
          {testRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Test Runs</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {testRuns.slice(0, 5).map(run => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between px-6 py-3 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        {run.status === 'passed' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : run.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium capitalize">{run.status}</span>
                        <span className="text-muted-foreground">
                          {run.passed_tests}/{run.total_tests} passed
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-muted-foreground">
                        {run.duration_ms != null && (
                          <span>{formatDuration(run.duration_ms)}</span>
                        )}
                        <span>{formatDate(run.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty runs state */}
          {!runsLoading && testRuns.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Activity className="h-12 w-12 text-muted-foreground opacity-30" />
                <h3 className="mt-4 text-base font-semibold">No test runs yet</h3>
                <p className="mt-2 text-sm text-center text-muted-foreground">
                  Click "Run Tests" to execute your first test run.
                </p>
                <Button className="mt-4" size="sm" onClick={handleRunTests}>
                  <Play className="mr-2 h-4 w-4" />
                  Run Tests
                </Button>
              </CardContent>
            </Card>
          )}
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
            <Button onClick={handleStartScan} disabled={scanning}>
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Project Configuration</CardTitle>
                  <CardDescription>
                    URLs and connection settings for this project
                  </CardDescription>
                </div>
                <Button size="sm" onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : configSaved ? (
                    <>
                      <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-green-500" />
                      Saved
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {(
                [
                  { label: 'Frontend URL', key: 'frontend_url', placeholder: 'http://localhost:3000', type: 'text' },
                  { label: 'Backend URL', key: 'backend_url', placeholder: 'http://localhost:8000', type: 'text' },
                  { label: 'OpenAPI Spec URL', key: 'openapi_url', placeholder: 'http://localhost:8000/openapi.json', type: 'text' },
                  { label: 'Database URL', key: 'database_url', placeholder: 'postgresql://user:pass@localhost:5432/db', type: 'text' },
                  { label: 'Redis URL', key: 'redis_url', placeholder: 'redis://localhost:6379', type: 'text' },
                  { label: 'Test Login Email', key: 'test_login_email', placeholder: 'test@example.com', type: 'text' },
                  { label: 'Test Login Password', key: 'test_login_password', placeholder: '••••••••', type: 'password' },
                ] as { label: string; key: keyof typeof configEdits; placeholder: string; type: string }[]
              ).map(({ label, key, placeholder, type }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`config-${key}`} className="text-sm font-medium">
                    {label}
                  </Label>
                  <Input
                    id={`config-${key}`}
                    type={type}
                    value={configEdits[key]}
                    onChange={e =>
                      setConfigEdits(prev => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className="font-mono text-sm"
                  />
                </div>
              ))}
              {configError && (
                <p className="text-sm text-destructive bg-destructive/10 rounded p-2">
                  {configError}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Environment Variables */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Environment Variables</CardTitle>
                  <CardDescription>
                    Injected into tests via{' '}
                    <code className="text-xs bg-muted px-1 rounded">os.environ</code>{' '}
                    at runtime
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
                      onChange={e => updateEnvVar(idx, 'key', e.target.value)}
                      className="w-48 font-mono text-xs"
                    />
                    <span className="text-muted-foreground text-sm">=</span>
                    <Input
                      placeholder="value"
                      value={row.value}
                      onChange={e => updateEnvVar(idx, 'value', e.target.value)}
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
      </div>

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
