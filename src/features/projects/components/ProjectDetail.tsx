import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  List,
  Wifi,
  WifiOff,
  AlertCircle,
  RefreshCw,
  HardDrive,
  Wand2,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip as ReTooltip,
} from 'recharts'
import { useProject } from '../hooks/useProjects'
import { apiClient } from '@/services/api-client'
import { useAppStore } from '@/stores/app-store'
import { ScanProgressModal } from './ScanProgressModal'
import { TestSuggestionsView } from './TestSuggestionsView'
import { formatDate, formatDuration } from '@/lib/utils'
import { useProjectSync } from '@/hooks/useProjectSync'

interface EnvVar {
  key: string
  value: string
}

type ConnStatus = { connected: boolean; latency_ms?: number; error?: string } | null

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { project, isLoading } = useProject(projectId!)
  const navigate = useNavigate()
  const setCurrentProject = useAppStore((s) => s.setCurrentProject)
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

  // Config edit state (URLs + credentials)
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
  const [configError, setConfigError] = useState<string | null>(null)

  // Connection test state
  const [testingConn, setTestingConn] = useState<string | null>(null)
  const [connResults, setConnResults] = useState<Record<string, ConnStatus>>({})

  // Execution settings state
  const [execSettings, setExecSettings] = useState({
    test_timeout: 30000,
    parallel_workers: 1,
    retry_count: 0,
    browser: 'chromium',
  })
  const [savingExec, setSavingExec] = useState(false)
  const [execSaved, setExecSaved] = useState(false)

  // Scanner state
  const [scanJobId, setScanJobId] = useState<string | null>(null)
  const [scanModalOpen, setScanModalOpen] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [scanning, setScanning] = useState(false)

  // Workspace sync
  const { status: wsStatus, isSyncing, isWatching, progress: syncProgress, sync: syncWorkspace, unsync: unsyncWorkspace } =
    useProjectSync(projectId ?? null, project?.path ?? null)

  // Scaffold state
  const [isScaffolding, setIsScaffolding] = useState(false)
  const [scaffoldResult, setScaffoldResult] = useState<{ created_files: string[] } | null>(null)

  const handleScaffold = async () => {
    if (!projectId) return
    setIsScaffolding(true)
    setScaffoldResult(null)
    try {
      const result = await apiClient.scaffoldProjectTests(projectId)
      setScaffoldResult(result)
    } catch (err) {
      console.error('Scaffold failed:', err)
    } finally {
      setIsScaffolding(false)
    }
  }

  const handleDownload = async () => {
    if (!projectId) return
    try {
      const blob = await apiClient.downloadWorkspace(projectId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `testforge-workspace-${projectId.slice(0, 8)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  // Runs tab: delete
  const deleteRunMutation = useMutation({
    mutationFn: ({ runId }: { runId: string }) =>
      apiClient.deleteTestRun(projectId!, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] })
    },
  })

  // Auto-show suggestions if previous scan results exist
  useEffect(() => {
    if (!projectId || showSuggestions) return
    apiClient
      .getGeneratedTests(projectId)
      .then((tests) => {
        if (tests.length > 0) setShowSuggestions(true)
      })
      .catch(() => {})
  }, [projectId, showSuggestions])

  // Test runs for overview stats + runs tab
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

    setExecSettings({
      test_timeout: project.config?.test_timeout ?? 30000,
      parallel_workers: project.config?.parallel_workers ?? 1,
      retry_count: project.config?.retry_count ?? 0,
      browser: project.config?.browser ?? 'chromium',
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

  // ── Button handlers ──────────────────────────────────────────────────────────
  const handleRunTests = () => {
    setCurrentProject(project)
    navigate('/test-runner')
  }

  const handleConfigure = () => {
    setActiveTab('config')
    setTimeout(
      () => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50
    )
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

  // ── Connection test ──────────────────────────────────────────────────────────
  const handleTestConnection = async (
    fieldKey: string,
    type: 'api' | 'database' | 'redis',
    url: string
  ) => {
    if (!url.trim()) return
    setTestingConn(fieldKey)
    setConnResults((prev) => ({ ...prev, [fieldKey]: null }))
    try {
      const result = await apiClient.validateConnection(type, url.trim())
      setConnResults((prev) => ({ ...prev, [fieldKey]: result }))
    } catch {
      setConnResults((prev) => ({
        ...prev,
        [fieldKey]: { connected: false, error: 'Request failed' },
      }))
    } finally {
      setTestingConn(null)
    }
  }

  // ── Env Var helpers ──────────────────────────────────────────────────────────
  const addEnvVar = () => setEnvVars((prev) => [...prev, { key: '', value: '' }])

  const removeEnvVar = (idx: number) =>
    setEnvVars((prev) => prev.filter((_, i) => i !== idx))

  const updateEnvVar = (idx: number, field: 'key' | 'value', val: string) =>
    setEnvVars((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row))
    )

  const loadFromDotEnv = async () => {
    if (!window.electronAPI) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = await (window as any).electronAPI.file.readEnvFile(
        project.path
      ) as Record<string, string>
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

  // ── Config URL save ──────────────────────────────────────────────────────────
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
      setConfigError(
        err instanceof Error ? err.message : 'Failed to save configuration'
      )
    } finally {
      setSavingConfig(false)
    }
  }

  // ── Execution settings save ──────────────────────────────────────────────────
  const saveExecSettings = async () => {
    setSavingExec(true)
    try {
      await apiClient.updateProject(project.id, {
        config: {
          test_timeout: execSettings.test_timeout,
          parallel_workers: execSettings.parallel_workers,
          retry_count: execSettings.retry_count,
          browser: execSettings.browser || undefined,
        },
      })
      setExecSaved(true)
      setTimeout(() => setExecSaved(false), 2500)
    } finally {
      setSavingExec(false)
    }
  }

  // ── Scanner ──────────────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    if (!project) return
    setScanning(true)
    try {
      let preDiscovered: Record<string, unknown> | undefined

      if (window.electronAPI) {
        try {
          const structure = await window.electronAPI.file.scanProject(project.path)
          preDiscovered = structure as Record<string, unknown>
        } catch {
          // Not fatal — backend will scan the path directly
        }
      }

      const res = await apiClient.startScan(project.id, preDiscovered)
      setScanJobId(res.job_id)
      setScanModalOpen(true)
    } finally {
      setScanning(false)
    }
  }

  // ── Overview stats ───────────────────────────────────────────────────────────
  const lastRun = testRuns[0] ?? null
  const passRate =
    lastRun && lastRun.total_tests > 0
      ? Math.round((lastRun.passed_tests / lastRun.total_tests) * 100)
      : null

  // Sparkline data: last 10 runs oldest→newest
  const sparklineData = testRuns
    .slice(0, 10)
    .reverse()
    .map((run, i) => ({
      index: i,
      rate:
        run.total_tests > 0
          ? Math.round((run.passed_tests / run.total_tests) * 100)
          : 0,
    }))

  const sparklineColor =
    lastRun?.status === 'passed'
      ? '#22c55e'
      : lastRun?.status === 'failed'
        ? '#ef4444'
        : '#94a3b8'

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
      icon:
        lastRun?.status === 'passed'
          ? CheckCircle2
          : lastRun?.status === 'failed'
            ? XCircle
            : Clock,
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
      sparkline: sparklineData.length >= 2,
    },
  ]

  // ── Runs tab helpers ─────────────────────────────────────────────────────────
  const statusVariant = (s: string) =>
    s === 'passed'
      ? 'success'
      : s === 'failed'
        ? 'destructive'
        : s === 'running'
          ? 'warning'
          : 'secondary'

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
                  onChange={(e) => setPathValue(e.target.value)}
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
            <TabsTrigger value="runs">
              <List className="mr-2 h-4 w-4" />
              Runs
              {testRuns.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {testRuns.length}
                </Badge>
              )}
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
              {overviewStats.map(({ title, value, desc, icon: Icon, sparkline }) => (
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
                    {sparkline && sparklineData.length >= 2 && (
                      <div className="mt-3 h-10">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={sparklineData}>
                            <defs>
                              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={sparklineColor} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={sparklineColor} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <ReTooltip
                              content={({ active, payload }) =>
                                active && payload?.length ? (
                                  <div className="bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow">
                                    {payload[0].value}%
                                  </div>
                                ) : null
                              }
                            />
                            <Area
                              type="monotone"
                              dataKey="rate"
                              stroke={sparklineColor}
                              strokeWidth={2}
                              fill="url(#sparkGrad)"
                              dot={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Workspace Sync card — only shown in Electron */}
            {window.electronAPI && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-medium">Workspace Sync</CardTitle>
                    {isWatching && (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={syncWorkspace}
                      disabled={isSyncing}
                    >
                      {isSyncing ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      )}
                      {isSyncing ? 'Syncing…' : 'Sync Now'}
                    </Button>
                    {wsStatus?.synced && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-purple-600 border-purple-300 hover:bg-purple-50"
                        onClick={handleScaffold}
                        disabled={isScaffolding || isSyncing}
                        title="Analyse project and generate test files using AI"
                      >
                        {isScaffolding ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        {isScaffolding ? 'Generating…' : 'Generate Tests'}
                      </Button>
                    )}
                    {wsStatus?.synced && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={handleDownload}
                        title="Download all workspace files (including generated tests) as ZIP"
                      >
                        <Download className="mr-1 h-3.5 w-3.5" />
                        Download
                      </Button>
                    )}
                    {wsStatus?.synced && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={unsyncWorkspace}
                        disabled={isSyncing}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Clear
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* ── Progress steps (shown while syncing) ── */}
                  {isSyncing && (
                    <div className="space-y-2">
                      {(['scanning', 'compressing', 'uploading'] as const).map((step) => {
                        const isActive = syncProgress.step === step
                        const isDone = (
                          (step === 'scanning' && ['compressing', 'uploading', 'done'].includes(syncProgress.step)) ||
                          (step === 'compressing' && ['uploading', 'done'].includes(syncProgress.step)) ||
                          (step === 'uploading' && syncProgress.step === 'done')
                        )
                        const labels = {
                          scanning: `Scanning files${isActive ? ` · ${syncProgress.current} found` : ''}`,
                          compressing: 'Compressing ZIP',
                          uploading: 'Uploading to container',
                        }
                        return (
                          <div key={step} className="flex items-center gap-2 text-xs">
                            {isDone ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                            ) : isActive ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />
                            ) : (
                              <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                            )}
                            <span className={isActive ? 'text-foreground font-medium' : isDone ? 'text-muted-foreground' : 'text-muted-foreground/50'}>
                              {labels[step]}
                            </span>
                          </div>
                        )
                      })}

                      {/* Live scrolling file name */}
                      {syncProgress.step === 'scanning' && syncProgress.lastFile && (
                        <p className="ml-5 font-mono text-[10px] text-muted-foreground truncate">
                          {syncProgress.lastFile}
                        </p>
                      )}
                    </div>
                  )}

                  {/* ── Status summary (idle / done / error) ── */}
                  {!isSyncing && (
                    <>
                      {syncProgress.step === 'error' ? (
                        <div className="flex items-center gap-2 text-sm text-destructive">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>{syncProgress.error ?? 'Sync failed'}</span>
                        </div>
                      ) : wsStatus?.synced ? (
                        <div className="flex items-center gap-3 text-sm flex-wrap">
                          <span className="flex items-center gap-1 text-green-600 font-medium">
                            <CheckCircle2 className="h-4 w-4" />
                            Synced
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{wsStatus.file_count} files</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">
                            {(wsStatus.total_size_bytes / 1024).toFixed(0)} KB
                          </span>
                          {wsStatus.last_synced_at && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{formatDate(wsStatus.last_synced_at)}</span>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-yellow-600">
                          <AlertCircle className="h-4 w-4" />
                          <span>Not synced — click "Sync Now" to upload project files to the container</span>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Scaffold result (shown after AI generation) ── */}
                  {scaffoldResult && scaffoldResult.created_files.length > 0 && (
                    <div className="rounded-md border border-purple-200 bg-purple-50/40 overflow-hidden">
                      <div className="px-3 py-1.5 border-b border-purple-200 bg-purple-50/60 flex items-center gap-2">
                        <Wand2 className="h-3.5 w-3.5 text-purple-600" />
                        <span className="text-xs font-medium text-purple-700">
                          {scaffoldResult.created_files.length} test files generated
                        </span>
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {scaffoldResult.created_files.map((f) => (
                          <div key={f} className="px-3 py-0.5 font-mono text-[11px] text-purple-700 hover:bg-purple-50 truncate">
                            + {f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── File list (shown after sync completes) ── */}
                  {syncProgress.step === 'done' && syncProgress.files.length > 0 && (
                    <div className="rounded-md border bg-muted/40 overflow-hidden">
                      <div className="px-3 py-1.5 border-b bg-muted/60 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Synced files ({syncProgress.files.length})
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {syncProgress.files.map((f) => (
                          <div
                            key={f}
                            className="px-3 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted/60 truncate"
                          >
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Recent runs table */}
            {testRuns.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent Test Runs</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {testRuns.slice(0, 5).map((run) => (
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

          {/* ── Runs ── */}
          <TabsContent value="runs" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>All Test Runs</CardTitle>
                    <CardDescription>
                      Complete history of executions for this project
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={handleRunTests}>
                    <Play className="mr-2 h-4 w-4" />
                    Run Now
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {runsLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading runs…
                  </div>
                ) : testRuns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Activity className="h-10 w-10 text-muted-foreground opacity-30" />
                    <p className="mt-3 text-sm font-medium">No runs yet</p>
                    <p className="text-xs text-muted-foreground">
                      Start a run from the Test Runner page
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {testRuns.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between px-6 py-3 text-sm hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {run.status === 'passed' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          ) : run.status === 'failed' ? (
                            <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                #{run.id.slice(0, 8)}
                              </span>
                              <Badge variant={statusVariant(run.status) as 'success' | 'destructive' | 'warning' | 'secondary'}>
                                {run.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {run.passed_tests}/{run.total_tests} passed
                              {run.failed_tests > 0 && ` · ${run.failed_tests} failed`}
                              {run.skipped_tests > 0 && ` · ${run.skipped_tests} skipped`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right text-xs text-muted-foreground">
                            {run.duration_ms != null && (
                              <p>{formatDuration(run.duration_ms)}</p>
                            )}
                            <p>{formatDate(run.created_at)}</p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete run"
                            disabled={deleteRunMutation.isPending && deleteRunMutation.variables?.runId === run.id}
                            onClick={() => deleteRunMutation.mutate({ runId: run.id })}
                          >
                            {deleteRunMutation.isPending && deleteRunMutation.variables?.runId === run.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
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
            {/* URLs + credentials */}
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
              <CardContent className="space-y-5">
                {(
                  [
                    { label: 'Frontend URL', key: 'frontend_url', placeholder: 'http://localhost:3000', connType: 'api' as const },
                    { label: 'Backend URL', key: 'backend_url', placeholder: 'http://localhost:8000', connType: 'api' as const },
                    { label: 'OpenAPI Spec URL', key: 'openapi_url', placeholder: 'http://localhost:8000/openapi.json', connType: 'api' as const },
                    { label: 'Database URL', key: 'database_url', placeholder: 'postgresql://user:pass@localhost:5432/db', connType: 'database' as const },
                    { label: 'Redis URL', key: 'redis_url', placeholder: 'redis://localhost:6379', connType: 'redis' as const },
                    { label: 'Test Login Email', key: 'test_login_email', placeholder: 'test@example.com', connType: null, inputType: 'text' },
                    { label: 'Test Login Password', key: 'test_login_password', placeholder: '••••••••', connType: null, inputType: 'password' },
                  ] as {
                    label: string
                    key: keyof typeof configEdits
                    placeholder: string
                    connType: 'api' | 'database' | 'redis' | null
                    inputType?: string
                  }[]
                ).map(({ label, key, placeholder, connType, inputType }) => {
                  const result = connResults[key]
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`config-${key}`} className="text-sm font-medium">
                        {label}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id={`config-${key}`}
                          type={inputType ?? 'text'}
                          value={configEdits[key]}
                          onChange={(e) =>
                            setConfigEdits((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder={placeholder}
                          className="font-mono text-sm flex-1"
                        />
                        {connType && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0 px-3"
                            disabled={!configEdits[key].trim() || testingConn === key}
                            onClick={() =>
                              handleTestConnection(key, connType, configEdits[key])
                            }
                          >
                            {testingConn === key ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wifi className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1.5">Test</span>
                          </Button>
                        )}
                      </div>
                      {result !== undefined && result !== null && (
                        <div
                          className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                            result.connected
                              ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                              : 'bg-red-500/10 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {result.connected ? (
                            <Wifi className="h-3 w-3" />
                          ) : (
                            <WifiOff className="h-3 w-3" />
                          )}
                          {result.connected
                            ? result.latency_ms != null
                              ? `Connected · ${result.latency_ms}ms`
                              : 'Connected'
                            : `Failed: ${result.error ?? 'unreachable'}`}
                        </div>
                      )}
                    </div>
                  )
                })}
                {configError && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded p-2">
                    {configError}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Execution Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Execution Settings</CardTitle>
                    <CardDescription>
                      Control how tests are run for this project
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={saveExecSettings} disabled={savingExec}>
                    {savingExec ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Saving…
                      </>
                    ) : execSaved ? (
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
              <CardContent className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="exec-timeout">
                      Timeout{' '}
                      <span className="font-normal text-muted-foreground">(ms)</span>
                    </Label>
                    <Input
                      id="exec-timeout"
                      type="number"
                      min={1000}
                      step={1000}
                      value={execSettings.test_timeout}
                      onChange={(e) =>
                        setExecSettings((p) => ({
                          ...p,
                          test_timeout: Number(e.target.value),
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Max time per test · default 30000ms
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exec-workers">
                      Parallel Workers
                    </Label>
                    <Input
                      id="exec-workers"
                      type="number"
                      min={1}
                      max={16}
                      value={execSettings.parallel_workers}
                      onChange={(e) =>
                        setExecSettings((p) => ({
                          ...p,
                          parallel_workers: Number(e.target.value),
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Concurrent test threads · default 1
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exec-retries">
                      Retries on Failure
                    </Label>
                    <Input
                      id="exec-retries"
                      type="number"
                      min={0}
                      max={5}
                      value={execSettings.retry_count}
                      onChange={(e) =>
                        setExecSettings((p) => ({
                          ...p,
                          retry_count: Number(e.target.value),
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Re-run failed tests N times · default 0
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exec-browser">
                      Browser{' '}
                      <span className="font-normal text-muted-foreground">(Playwright only)</span>
                    </Label>
                    <Select
                      value={execSettings.browser}
                      onValueChange={(v) =>
                        setExecSettings((p) => ({ ...p, browser: v }))
                      }
                    >
                      <SelectTrigger id="exec-browser">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="chromium">Chromium</SelectItem>
                        <SelectItem value="firefox">Firefox</SelectItem>
                        <SelectItem value="webkit">WebKit (Safari)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Target browser for E2E tests
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Workers and browser selection apply to Playwright runs.
                    pytest uses <code className="bg-muted px-1 rounded">-n workers</code> and ignores browser.
                  </span>
                </div>
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
