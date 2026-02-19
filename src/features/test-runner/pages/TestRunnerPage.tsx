import { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Monitor,
  Server,
  Database,
  Wifi,
  Image,
  Globe,
  Code2,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScreenshotModal } from '@/components/ScreenshotModal'
import { useAppStore } from '@/stores/app-store'
import { useProjects } from '@/features/projects/hooks/useProjects'
import { apiClient, type TestResultItem, type NetworkRequest } from '@/services/api-client'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useToast } from '@/components/ui/use-toast'

// Lazy-load Monaco to avoid crashing if not installed yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MonacoEditor = lazy((): Promise<any> =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })).catch(() => ({
    default: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Monaco not installed — run <code className="mx-1 bg-muted px-1 rounded">npm install</code>
      </div>
    ),
  }))
)

// ── Types ─────────────────────────────────────────────────────────────────
type TestStatus = 'idle' | 'running' | 'passed' | 'failed'

interface LayerStat {
  id: string
  name: string
  icon: React.ElementType
  status: TestStatus
  tests: number
  passed: number
  failed: number
}

interface LogEntry {
  time: string
  level: 'info' | 'success' | 'error' | 'warn'
  message: string
}

const STATUS_COLORS: Record<string, string> = {
  passed: 'text-green-600',
  failed: 'text-red-500',
  error: 'text-red-500',
  skipped: 'text-yellow-500',
  running: 'text-blue-500',
}

// ── Default editor content ─────────────────────────────────────────────────
const EDITOR_TEMPLATE = `import { test, expect } from '@playwright/test'

test.describe('My Test Suite', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page).toHaveTitle(/Home/)
  })

  test('should display the navigation', async ({ page }) => {
    await page.goto('http://localhost:3000')
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })
})
`

// ── Component ──────────────────────────────────────────────────────────────
export function TestRunnerPage() {
  const { projects } = useProjects()
  const currentProject = useAppStore(s => s.currentProject)
  const { toast } = useToast()

  const [activeProjectId, setActiveProjectId] = useState<string>('')

  // Set default project once data is available
  useEffect(() => {
    if (!activeProjectId) {
      const defaultId = currentProject?.id || projects[0]?.id || ''
      if (defaultId) setActiveProjectId(defaultId)
    }
  }, [projects, currentProject, activeProjectId])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [results, setResults] = useState<TestResultItem[]>([])
  const [selectedResult, setSelectedResult] = useState<TestResultItem | null>(null)
  const [editorCode, setEditorCode] = useState(EDITOR_TEMPLATE)
  const [theme] = useState<'vs-dark' | 'light'>('vs-dark')
  const logsEndRef = useRef<HTMLDivElement>(null)
  // Guard so polling never fires "Run completed" more than once per run
  const runFinishedRef = useRef(false)
  const [activeLayerFilter, setActiveLayerFilter] = useState<string | null>(null)
  const [screenshotModal, setScreenshotModal] = useState<{
    url: string; name: string; status?: string; layer?: string
  } | null>(null)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<{ analysis: string; suggestions: string[] } | null>(null)
  const [lastAnalyzedId, setLastAnalyzedId] = useState<string | null>(null)

  // Reset AI analysis when user selects a different result
  useEffect(() => {
    setAiAnalysis(null)
    setLastAnalyzedId(null)
  }, [selectedResult?.id])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Layer summary derived from results
  const layerStats: LayerStat[] = [
    { id: 'frontend', name: 'Frontend', icon: Monitor },
    { id: 'backend', name: 'Backend', icon: Server },
    { id: 'database', name: 'Database', icon: Database },
    { id: 'infrastructure', name: 'Infrastructure', icon: Wifi },
  ].map((l) => {
    const layerResults = results.filter((r) => r.test_layer === l.id)
    const passed = layerResults.filter((r) => r.status === 'passed').length
    const failed = layerResults.filter((r) =>
      r.status === 'failed' || r.status === 'error'
    ).length
    const status: TestStatus =
      layerResults.length === 0
        ? 'idle'
        : isRunning
          ? 'running'
          : failed > 0
            ? 'failed'
            : 'passed'

    return { ...l, status, tests: layerResults.length, passed, failed }
  })

  const addLog = (level: LogEntry['level'], message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs((prev) => [...prev, { time, level, message }])
  }

  const handleRunProgress = useCallback(
    async (data: Record<string, unknown>) => {
      // Stream install / env-setup logs from backend
      if (data.log) {
        addLog('info', data.log as string)
      }

      const status = data.status as string | undefined
      const isTerminal = status === 'passed' || status === 'failed' || status === 'cancelled'

      if (data.progress !== undefined) {
        setProgress(data.progress as number)
      }

      // Fetch results only when run is finished to avoid flooding (ERR_INSUFFICIENT_RESOURCES)
      if (isTerminal && activeProjectId && activeRunId) {
        try {
          const items = await apiClient.getTestRunResults(activeProjectId, activeRunId)
          setResults(items)
        } catch {
          // ignore
        }
      }

      if (isTerminal) {
        // Guard: polling can deliver the terminal status multiple times while
        // React re-renders to stop the interval. Process completion only once.
        if (runFinishedRef.current) return
        runFinishedRef.current = true

        setIsRunning(false)
        let completionMsg = `Run completed — status: ${status}`
        if (status === 'failed' && activeProjectId && activeRunId) {
          try {
            const run = await apiClient.getTestRun(activeProjectId, activeRunId)
            if (run.error_message) {
              completionMsg += `. Reason: ${run.error_message}`
            }
          } catch {
            // ignore — best effort
          }
        }
        addLog(status === 'passed' ? 'success' : 'error', completionMsg)
      }
    },
    [activeProjectId, activeRunId]
  )

  const pollRunFn = useCallback(async () => {
    if (!activeProjectId || !activeRunId) throw new Error('no run')
    const run = await apiClient.getTestRun(activeProjectId, activeRunId)
    const pct =
      run.status === 'passed' || run.status === 'failed' || run.status === 'cancelled'
        ? 100
        : run.total_tests > 0
          ? Math.round(((run.passed_tests + run.failed_tests) / run.total_tests) * 100)
          : 0
    return {
      status: run.status,
      progress: pct,
      total_tests: run.total_tests,
      passed_tests: run.passed_tests,
      failed_tests: run.failed_tests,
    } as unknown as Record<string, unknown>
  }, [activeProjectId, activeRunId])

  useWebSocket<Record<string, unknown>>({
    jobType: 'run',
    jobId: activeRunId,
    enabled: isRunning,
    onMessage: handleRunProgress,
    pollFn: pollRunFn,
    isTerminal: (data) => {
      const s = data.status as string | undefined
      return s === 'passed' || s === 'failed' || s === 'cancelled'
    },
  })

  const handleStart = async () => {
    if (!activeProjectId) return
    runFinishedRef.current = false
    setIsRunning(true)
    setProgress(0)
    setResults([])
    setSelectedResult(null)
    setActiveLayerFilter(null)
    setLogs([])

    addLog('info', 'Starting test run…')

    // Auto-sync: if running in Electron and workspace is not synced, upload now
    const activeProject = projects.find((p) => p.id === activeProjectId)
    if (window.electronAPI && activeProject?.path) {
      try {
        const ws = await apiClient.getWorkspaceStatus(activeProjectId)
        if (!ws.synced) {
          addLog('info', 'Syncing project files to container…')
          const _backendUrl = apiClient.getBaseUrl() || 'http://localhost:8001'
          const syncResult = await window.electronAPI.file.syncProject(
            activeProject.path,
            activeProjectId,
            _backendUrl
          )
          if (syncResult.success) {
            addLog('success', `Project files synced (${syncResult.file_count ?? 0} files)`)
          } else {
            addLog('warn', `Sync skipped: ${syncResult.error ?? 'unknown error'}`)
          }
        }
      } catch {
        // Non-fatal — continue with existing path translation
      }
    }

    addLog('info', 'Initializing test runner…')

    try {
      const run = await apiClient.startTestRun(activeProjectId)
      setActiveRunId(run.id)
      addLog('info', `Test run created: ${run.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog('error', `Failed to start run: ${msg}`)
      toast({ title: 'Failed to start test run', description: msg, variant: 'destructive' })
      setIsRunning(false)
    }
  }

  const handleStop = async () => {
    if (!activeProjectId || !activeRunId) return
    try {
      await apiClient.stopTestRun(activeProjectId, activeRunId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast({ title: 'Failed to stop test run', description: msg, variant: 'destructive' })
    }
    setIsRunning(false)
    addLog('warn', 'Test run stopped by user')
  }

  // Filter results by active layer (if any)
  const filteredResults = activeLayerFilter
    ? results.filter((r) => r.test_layer === activeLayerFilter)
    : results

  // Collect all screenshots and network requests from results
  const allScreenshots = results.filter((r) => r.screenshot_path)
  const allNetworkRequests: (NetworkRequest & { test_name: string })[] = results.flatMap((r) =>
    (r.metadata?.network_requests ?? []).map((req) => ({ ...req, test_name: r.test_name }))
  )

  const backendUrl = apiClient.getBaseUrl() || 'http://localhost:8001'

  const screenshotUrl = (path: string) => {
    const filename = path.split('/').pop() ?? path
    return `${backendUrl}/screenshots/${filename}`
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Test Runner</h1>
          <p className="text-muted-foreground">Execute and monitor your E2E test suite</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Project selector */}
          {projects.length > 0 && (
            <Select value={activeProjectId} onValueChange={setActiveProjectId} disabled={isRunning}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isRunning ? (
            <Button variant="destructive" onClick={handleStop}>
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button onClick={handleStart} disabled={!activeProjectId}>
              <Play className="mr-2 h-4 w-4" />
              Run All Tests
            </Button>
          )}
          <Button
            variant="outline"
            disabled={isRunning || results.length === 0}
            onClick={handleStart}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Rerun
          </Button>
        </div>
      </div>

      {/* ── Progress ── */}
      {isRunning && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Running tests…
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Layer Cards ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {layerStats.map((layer) => (
          <Card
            key={layer.id}
            className={cn(
              'cursor-pointer transition-all hover:shadow-md',
              activeLayerFilter === layer.id && 'ring-2 ring-primary'
            )}
            onClick={() =>
              setActiveLayerFilter((prev) => (prev === layer.id ? null : layer.id))
            }
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{layer.name}</CardTitle>
              <layer.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{layer.tests || '—'}</div>
                <Badge
                  variant={
                    layer.status === 'passed'
                      ? 'success'
                      : layer.status === 'failed'
                        ? 'destructive'
                        : layer.status === 'running'
                          ? 'warning'
                          : 'secondary'
                  }
                >
                  {layer.status}
                </Badge>
              </div>
              {layer.status !== 'idle' && (
                <div className="mt-2 flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {layer.passed}
                  </span>
                  <span className="flex items-center gap-1 text-red-600">
                    <XCircle className="h-3 w-3" />
                    {layer.failed}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Main Tabs ── */}
      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">
            <Clock className="mr-2 h-4 w-4" />
            Logs
          </TabsTrigger>
          <TabsTrigger value="results">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Results
            {filteredResults.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
                {filteredResults.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="screenshots">
            <Image className="mr-2 h-4 w-4" />
            Screenshots
            {allScreenshots.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
                {allScreenshots.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="network">
            <Globe className="mr-2 h-4 w-4" />
            Network
            {allNetworkRequests.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
                {allNetworkRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="editor">
            <Code2 className="mr-2 h-4 w-4" />
            Editor
          </TabsTrigger>
        </TabsList>

        {/* ── Logs Tab ── */}
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Test Logs</CardTitle>
              <CardDescription>Real-time output from test execution</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] rounded-md border bg-zinc-950 p-4 font-mono text-sm">
                {logs.length === 0 ? (
                  <p className="text-zinc-500">No logs yet. Start a test run to see output.</p>
                ) : (
                  logs.map((log, i) => (
                    <div
                      key={i}
                      className={cn(
                        'py-0.5',
                        log.level === 'error' && 'text-red-400',
                        log.level === 'success' && 'text-green-400',
                        log.level === 'warn' && 'text-yellow-400',
                        log.level === 'info' && 'text-zinc-400'
                      )}
                    >
                      <span className="text-zinc-600">[{log.time}]</span>{' '}
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Results Tab ── */}
        <TabsContent value="results" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Result list */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">
                  Test Results
                  {activeLayerFilter && (
                    <Badge variant="outline" className="ml-2 text-xs font-normal">
                      {activeLayerFilter}
                      <button
                        className="ml-1 hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setActiveLayerFilter(null) }}
                      >
                        ×
                      </button>
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[480px]">
                  {filteredResults.length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">
                      {activeLayerFilter ? `No ${activeLayerFilter} results.` : 'No results yet.'}
                    </p>
                  ) : (
                    filteredResults.map((r) => (
                      <button
                        key={r.id}
                        className={cn(
                          'w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors flex items-start gap-3',
                          selectedResult?.id === r.id && 'bg-muted'
                        )}
                        onClick={() => setSelectedResult(r)}
                      >
                        <span className={cn('mt-0.5 text-sm', STATUS_COLORS[r.status])}>
                          {r.status === 'passed' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : r.status === 'skipped' ? (
                            <Clock className="h-4 w-4" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{r.test_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.test_layer} · {r.duration_ms ? `${r.duration_ms}ms` : '—'}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      </button>
                    ))
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Result detail */}
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-base leading-snug">
                  {selectedResult ? selectedResult.test_name : 'Select a result'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedResult ? (
                  <p className="text-sm text-muted-foreground">
                    Click a result on the left to see details.
                  </p>
                ) : (
                  <ScrollArea className="h-[440px] pr-1">
                    <div className="space-y-4">

                      {/* Status badges */}
                      <div className="flex gap-2 flex-wrap">
                        <Badge
                          variant={
                            selectedResult.status === 'passed'
                              ? 'success'
                              : selectedResult.status === 'skipped'
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {selectedResult.status}
                        </Badge>
                        <Badge variant="outline">{selectedResult.test_layer}</Badge>
                        {selectedResult.duration_ms != null && (
                          <Badge variant="outline">{selectedResult.duration_ms}ms</Badge>
                        )}
                        {selectedResult.trace_id && (
                          <Badge variant="outline" className="font-mono text-xs">
                            trace: {selectedResult.trace_id.slice(0, 12)}…
                          </Badge>
                        )}
                      </div>

                      {/* File + suite info */}
                      {(selectedResult.test_file || selectedResult.test_suite) && (
                        <div className="space-y-1">
                          {selectedResult.test_file && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Code2 className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="font-mono truncate" title={selectedResult.test_file}>
                                {selectedResult.test_file.split('/').slice(-2).join('/')}
                              </span>
                            </div>
                          )}
                          {selectedResult.test_suite && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                              <span>Suite: <span className="font-medium text-foreground">{selectedResult.test_suite}</span></span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                            <span>{new Date(selectedResult.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      )}

                      {/* Error message */}
                      {selectedResult.error_message && (
                        <div>
                          <p className="text-xs font-semibold text-destructive mb-1">Error</p>
                          <pre className="text-xs bg-zinc-950 text-red-300 p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
                            {selectedResult.error_message}
                          </pre>
                        </div>
                      )}

                      {/* Stack trace */}
                      {selectedResult.error_stack && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Stack Trace</p>
                          <pre className="text-xs bg-zinc-950 text-zinc-300 p-3 rounded-md overflow-x-auto max-h-40">
                            {selectedResult.error_stack}
                          </pre>
                        </div>
                      )}

                      {/* AI Analyze button (for failures) */}
                      {(selectedResult.status === 'failed' || selectedResult.status === 'error') && (
                        <div className="space-y-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={analyzingId === selectedResult.id}
                            onClick={async () => {
                              setAnalyzingId(selectedResult.id)
                              setAiAnalysis(null)
                              try {
                                const res = await apiClient.analyzeFailure(
                                  selectedResult.test_run_id,
                                  selectedResult.id,
                                )
                                setAiAnalysis(res)
                                setLastAnalyzedId(selectedResult.id)
                              } catch {
                                setAiAnalysis({
                                  analysis: 'Analysis failed — check AI/Ollama settings.',
                                  suggestions: [],
                                })
                                setLastAnalyzedId(selectedResult.id)
                              } finally {
                                setAnalyzingId(null)
                              }
                            }}
                          >
                            {analyzingId === selectedResult.id ? (
                              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Analyzing…</>
                            ) : (
                              <>🤖 Analyze with AI</>
                            )}
                          </Button>

                          {aiAnalysis && lastAnalyzedId === selectedResult.id && (
                            <div className="space-y-2">
                              <div className="text-xs bg-blue-950/40 border border-blue-900/40 rounded-md p-3">
                                <p className="font-semibold text-blue-400 mb-1">AI Analysis</p>
                                <p className="text-blue-100 whitespace-pre-wrap">{aiAnalysis.analysis}</p>
                              </div>
                              {aiAnalysis.suggestions.length > 0 && (
                                <div className="text-xs bg-zinc-900 border rounded-md p-3">
                                  <p className="font-semibold text-muted-foreground mb-1">Suggestions</p>
                                  <ul className="space-y-1">
                                    {aiAnalysis.suggestions.map((s, i) => (
                                      <li key={i} className="text-zinc-300">• {s}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Screenshot thumbnail */}
                      {selectedResult.screenshot_path && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Screenshot</p>
                          <img
                            src={screenshotUrl(selectedResult.screenshot_path)}
                            alt="Test screenshot"
                            className="rounded-md border max-h-48 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() =>
                              setScreenshotModal({
                                url: screenshotUrl(selectedResult.screenshot_path!),
                                name: selectedResult.test_name,
                                status: selectedResult.status,
                                layer: selectedResult.test_layer,
                              })
                            }
                          />
                        </div>
                      )}

                      {/* Inline network requests (top 5) */}
                      {(selectedResult.metadata?.network_requests ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">
                            Network Requests ({selectedResult.metadata!.network_requests!.length})
                          </p>
                          <div className="space-y-1">
                            {selectedResult.metadata!.network_requests!.slice(0, 5).map((req, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                                <span className={cn(
                                  'font-bold w-12 flex-shrink-0',
                                  req.method === 'GET' && 'text-blue-400',
                                  req.method === 'POST' && 'text-green-400',
                                  req.method === 'PUT' && 'text-yellow-400',
                                  req.method === 'DELETE' && 'text-red-400',
                                )}>
                                  {req.method}
                                </span>
                                <span className={cn(
                                  'font-semibold w-8 flex-shrink-0',
                                  req.status && req.status < 400 ? 'text-green-400' : 'text-red-400',
                                )}>
                                  {req.status ?? '—'}
                                </span>
                                <span className="text-zinc-400 truncate">{req.url}</span>
                              </div>
                            ))}
                            {selectedResult.metadata!.network_requests!.length > 5 && (
                              <p className="text-xs text-muted-foreground">
                                +{selectedResult.metadata!.network_requests!.length - 5} more (see Network tab)
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Extra metadata (non-network fields) */}
                      {selectedResult.metadata &&
                        Object.keys(selectedResult.metadata).filter((k) => k !== 'network_requests').length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-1">Metadata</p>
                            <div className="text-xs bg-zinc-950 rounded-md p-3 space-y-1 font-mono">
                              {Object.entries(selectedResult.metadata)
                                .filter(([k]) => k !== 'network_requests')
                                .map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <span className="text-zinc-400 min-w-[100px] flex-shrink-0">{k}:</span>
                                    <span className="text-zinc-200 truncate">{String(v)}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Screenshots Tab ── */}
        <TabsContent value="screenshots" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Screenshots</CardTitle>
              <CardDescription>
                Captured on test failure by Playwright
              </CardDescription>
            </CardHeader>
            <CardContent>
              {allScreenshots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Image className="h-10 w-10 opacity-30" />
                  <p className="text-sm">No screenshots captured yet</p>
                  <p className="text-xs text-center max-w-xs">
                    Screenshots are captured automatically on failure during Playwright E2E test runs.
                    Backend/pytest tests do not generate screenshots.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {allScreenshots.map((r) => (
                    <div key={r.id} className="group relative">
                      <img
                        src={screenshotUrl(r.screenshot_path!)}
                        alt={r.test_name}
                        className="w-full h-40 object-cover rounded-md border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() =>
                          setScreenshotModal({
                            url: screenshotUrl(r.screenshot_path!),
                            name: r.test_name,
                            status: r.status,
                            layer: r.test_layer,
                          })
                        }
                      />
                      <div className="mt-1">
                        <p className="text-xs font-medium truncate">{r.test_name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge
                            variant={r.status === 'passed' ? 'success' : 'destructive'}
                            className="text-xs px-1"
                          >
                            {r.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{r.test_layer}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Network Tab ── */}
        <TabsContent value="network" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Network Requests</CardTitle>
              <CardDescription>
                HTTP requests captured via Playwright request events
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {allNetworkRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Globe className="h-10 w-10 opacity-30" />
                  <p className="text-sm">No network requests captured yet</p>
                  <p className="text-xs text-center max-w-xs">
                    HTTP requests are captured during Playwright E2E test execution.
                    Backend/pytest tests use direct HTTP calls that are not intercepted here.
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[480px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Method</th>
                        <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Status</th>
                        <th className="text-left px-4 py-2 font-semibold text-muted-foreground">URL</th>
                        <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Type</th>
                        <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Test</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allNetworkRequests.map((req, i) => (
                        <tr
                          key={i}
                          className="border-b last:border-b-0 hover:bg-muted/40 transition-colors"
                        >
                          <td className="px-4 py-2">
                            <span
                              className={cn(
                                'font-mono font-bold',
                                req.method === 'GET' && 'text-blue-500',
                                req.method === 'POST' && 'text-green-500',
                                req.method === 'PUT' && 'text-yellow-500',
                                req.method === 'DELETE' && 'text-red-500',
                                req.method === 'PATCH' && 'text-purple-500'
                              )}
                            >
                              {req.method}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {req.status ? (
                              <span
                                className={cn(
                                  'font-mono font-semibold',
                                  req.status < 300 && 'text-green-500',
                                  req.status >= 300 && req.status < 400 && 'text-yellow-500',
                                  req.status >= 400 && 'text-red-500'
                                )}
                              >
                                {req.status}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono max-w-xs truncate" title={req.url}>
                            {req.url}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {req.content_type?.split(';')[0] || '—'}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground truncate max-w-[140px]">
                            {req.test_name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Editor Tab ── */}
        <TabsContent value="editor" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">Test Editor</CardTitle>
                <CardDescription>
                  Write Playwright tests — TypeScript with full IntelliSense
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!activeProjectId) return
                    try {
                      const res = await apiClient.generateTests(activeProjectId, editorCode)
                      if (res.tests?.[0]) setEditorCode(res.tests[0])
                    } catch {/* ignore */}
                  }}
                >
                  ✨ Generate with AI
                </Button>
                <Button
                  size="sm"
                  onClick={handleStart}
                  disabled={isRunning || !activeProjectId}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Run
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[500px] rounded-b-lg overflow-hidden border-t">
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading editor…
                    </div>
                  }
                >
                  <MonacoEditor
                    height="100%"
                    language="typescript"
                    theme={theme}
                    value={editorCode}
                    onChange={(val: string | undefined) => setEditorCode(val ?? '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineHeight: 20,
                      tabSize: 2,
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 16, bottom: 16 },
                    }}
                  />
                </Suspense>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Screenshot zoom modal */}
      <ScreenshotModal
        open={!!screenshotModal}
        onClose={() => setScreenshotModal(null)}
        imageUrl={screenshotModal?.url ?? ''}
        testName={screenshotModal?.name ?? ''}
        testStatus={screenshotModal?.status}
        testLayer={screenshotModal?.layer}
      />
    </div>
  )
}
