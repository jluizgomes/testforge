import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Download,
  FileText,
  Calendar,
  Clock,
  TrendingUp,
  BarChart3,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { formatDate, formatDuration } from '@/lib/utils'
import { apiClient, type ReportSchedule, type TestRun, type CodeQualityResult } from '@/services/api-client'
import { ScheduleReportDialog } from '../components/ScheduleReportDialog'
import { CodeQualityView } from '../components/CodeQualityView'
import { useProjects } from '@/features/projects/hooks/useProjects'
import { useAppStore } from '@/stores/app-store'

const FORMAT_COLORS: Record<string, string> = {
  html: 'bg-blue-500/10 text-blue-600 border-blue-200',
  pdf: 'bg-red-500/10 text-red-600 border-red-200',
  json: 'bg-amber-500/10 text-amber-600 border-amber-200',
  xml: 'bg-purple-500/10 text-purple-600 border-purple-200',
  markdown: 'bg-slate-500/10 text-slate-600 border-slate-200',
}

const REPORT_FORMATS = [
  { label: 'HTML', value: 'html' },
  { label: 'PDF', value: 'pdf' },
  { label: 'JSON', value: 'json' },
  { label: 'JUnit XML', value: 'xml' },
  { label: 'Markdown', value: 'markdown' },
] as const

export function ReportsPage() {
  const { projects } = useProjects()
  const currentProject = useAppStore(s => s.currentProject)

  const [schedules, setSchedules] = useState<ReportSchedule[]>([])
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [runs, setRuns] = useState<TestRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [generatingRunId, setGeneratingRunId] = useState<string | null>(null)
  const [reportFormat, setReportFormat] = useState<string>('html')

  // Code Quality tab state
  const [qualityRunId, setQualityRunId] = useState<string>('')
  const [includeAI, setIncludeAI] = useState(false)
  const [loadingQuality, setLoadingQuality] = useState(false)
  const [qualityResult, setQualityResult] = useState<CodeQualityResult | null>(null)

  const activeProject = currentProject ?? projects[0] ?? null

  const loadSchedules = () => {
    setLoadingSchedules(true)
    apiClient
      .getSchedules()
      .then(setSchedules)
      .catch(() => {})
      .finally(() => setLoadingSchedules(false))
  }

  useEffect(() => {
    loadSchedules()
  }, [])

  useEffect(() => {
    if (!activeProject?.id) return
    setLoadingRuns(true)
    apiClient
      .getTestRuns(activeProject.id)
      .then(r => setRuns(r.slice(0, 20)))
      .catch(() => setRuns([]))
      .finally(() => setLoadingRuns(false))
  }, [activeProject?.id])

  const handleCreated = (schedule: ReportSchedule) => {
    setSchedules(prev => [schedule, ...prev])
  }

  const handleToggle = async (schedule: ReportSchedule) => {
    setTogglingId(schedule.id)
    try {
      const updated = await apiClient.updateSchedule(schedule.id, {
        enabled: !schedule.enabled,
      })
      setSchedules(prev => prev.map(s => (s.id === updated.id ? updated : s)))
    } catch {
      // ignore
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await apiClient.deleteSchedule(id)
      setSchedules(prev => prev.filter(s => s.id !== id))
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  const handleAnalyzeQuality = async () => {
    if (!activeProject?.id || !qualityRunId) return
    setLoadingQuality(true)
    setQualityResult(null)
    try {
      const result = await apiClient.getCodeQuality(activeProject.id, qualityRunId, includeAI)
      setQualityResult(result)
    } catch {
      // ignore — could show toast
    } finally {
      setLoadingQuality(false)
    }
  }

  const handleGenerateReport = async (run: TestRun) => {
    if (!activeProject?.id) return
    setGeneratingRunId(run.id)
    try {
      const blob = await apiClient.generateReport(
        activeProject.id,
        run.id,
        reportFormat as 'html' | 'pdf' | 'json' | 'xml' | 'markdown'
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = reportFormat === 'xml' ? 'xml' : reportFormat
      a.download = `report-${run.id.slice(0, 8)}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // ignore — could show toast
    } finally {
      setGeneratingRunId(null)
    }
  }

  // Stats computed from real runs
  const completedRuns = runs.filter(
    r => r.status === 'passed' || r.status === 'failed'
  )
  const totalTests = completedRuns.reduce((sum, r) => sum + r.total_tests, 0)
  const totalPassed = completedRuns.reduce((sum, r) => sum + r.passed_tests, 0)
  const passRate =
    totalTests > 0
      ? Math.round((totalPassed / totalTests) * 100 * 10) / 10
      : null
  const avgDurationMs =
    completedRuns.length > 0
      ? Math.round(
          completedRuns.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) /
            completedRuns.length
        )
      : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Generate and view test execution reports
          </p>
        </div>
        {activeProject && (
          <Badge variant="secondary">{activeProject.name}</Badge>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Runs</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">{runs.length || '—'}</div>
                <p className="text-xs text-muted-foreground">
                  {activeProject?.name ?? 'No project'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Pass Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {passRate != null ? `${passRate}%` : '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {completedRuns.length} completed runs
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tests Run</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {totalTests > 0 ? totalTests : '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Total test executions
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {avgDurationMs != null ? formatDuration(avgDurationMs) : '—'}
                </div>
                <p className="text-xs text-muted-foreground">Per test run</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="recent">
        <TabsList>
          <TabsTrigger value="recent">Recent Runs</TabsTrigger>
          <TabsTrigger value="scheduled">
            Scheduled
            {schedules.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {schedules.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            Code Quality
          </TabsTrigger>
        </TabsList>

        {/* ── Recent Runs ── */}
        <TabsContent value="recent" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent Test Runs</CardTitle>
                  <CardDescription>
                    Select a format and generate a downloadable report
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={reportFormat} onValueChange={setReportFormat}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_FORMATS.map(f => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!activeProject ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="h-16 w-16 text-muted-foreground opacity-30" />
                  <h3 className="mt-4 text-lg font-semibold">
                    No project selected
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Select a project to see its test runs and generate reports.
                  </p>
                </div>
              ) : loadingRuns ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading runs…
                </div>
              ) : runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="h-16 w-16 text-muted-foreground opacity-30" />
                  <h3 className="mt-4 text-lg font-semibold">No runs yet</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Run tests from the Test Runner to generate reports.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {runs.map(run => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          {run.status === 'passed' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : run.status === 'failed' ? (
                            <XCircle className="h-5 w-5 text-red-500" />
                          ) : (
                            <FileText className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-medium font-mono text-sm">
                            Run #{run.id.slice(0, 12)}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(run.created_at)}
                            <span>·</span>
                            {run.total_tests} tests
                            {run.duration_ms != null && (
                              <>
                                <span>·</span>
                                {formatDuration(run.duration_ms)}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge
                          variant={
                            run.status === 'passed'
                              ? 'success'
                              : run.status === 'failed'
                                ? 'destructive'
                                : run.status === 'running'
                                  ? 'warning'
                                  : 'secondary'
                          }
                        >
                          {run.status}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            generatingRunId === run.id ||
                            run.status === 'running' ||
                            run.status === 'pending'
                          }
                          onClick={() => handleGenerateReport(run)}
                        >
                          {generatingRunId === run.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-4 w-4" />
                          )}
                          {generatingRunId === run.id
                            ? 'Generating…'
                            : `${reportFormat.toUpperCase()}`}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Scheduled ── */}
        <TabsContent value="scheduled" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Scheduled Reports</CardTitle>
                  <CardDescription>
                    Automatically generate reports on a recurring schedule
                  </CardDescription>
                </div>
                <Button onClick={() => setDialogOpen(true)} size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Schedule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingSchedules ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading schedules…
                </div>
              ) : schedules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Calendar className="h-16 w-16 text-muted-foreground opacity-30" />
                  <h3 className="mt-4 text-lg font-semibold">
                    No scheduled reports
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Set up automatic report generation on a schedule.
                  </p>
                  <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Schedule
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {schedules.map(schedule => (
                    <div
                      key={schedule.id}
                      className="flex items-center justify-between rounded-lg border p-4"
                    >
                      <div className="flex items-start gap-3">
                        <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{schedule.name}</span>
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                FORMAT_COLORS[schedule.format] ??
                                'bg-muted text-muted-foreground'
                              }`}
                            >
                              {schedule.format}
                            </span>
                            {!schedule.enabled && (
                              <Badge variant="outline" className="text-xs">
                                Paused
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="font-mono">
                              {schedule.cron_expr}
                            </span>
                            {schedule.next_run_at && (
                              <>
                                <span>·</span>
                                <span>
                                  Next: {formatDate(schedule.next_run_at)}
                                </span>
                              </>
                            )}
                            {schedule.run_count > 0 && (
                              <>
                                <span>·</span>
                                <span>{schedule.run_count} runs</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title={
                            schedule.enabled
                              ? 'Pause schedule'
                              : 'Enable schedule'
                          }
                          disabled={togglingId === schedule.id}
                          onClick={() => handleToggle(schedule)}
                        >
                          {togglingId === schedule.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : schedule.enabled ? (
                            <ToggleRight className="h-4 w-4 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={deletingId === schedule.id}
                          onClick={() => handleDelete(schedule.id)}
                        >
                          {deletingId === schedule.id ? (
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

        {/* ── Templates ── */}
        <TabsContent value="templates" className="mt-6">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: 'Executive Summary',
                desc: 'High-level overview for stakeholders',
                format: 'html',
              },
              {
                title: 'Detailed Technical',
                desc: 'In-depth analysis for developers',
                format: 'html',
              },
              {
                title: 'JUnit XML',
                desc: 'CI/CD compatible test results',
                format: 'xml',
              },
            ].map(template => (
              <Card key={template.title}>
                <CardHeader>
                  <CardTitle className="text-lg">{template.title}</CardTitle>
                  <CardDescription>{template.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!activeProject || runs.length === 0}
                    onClick={() => {
                      if (!activeProject || runs.length === 0) return
                      const lastRun = runs.find(
                        r => r.status === 'passed' || r.status === 'failed'
                      )
                      if (lastRun) {
                        setReportFormat(template.format)
                        handleGenerateReport(lastRun)
                      }
                    }}
                  >
                    Use Template
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Code Quality ── */}
        <TabsContent value="quality" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-0">
                  <CardTitle>Code Quality</CardTitle>
                  <CardDescription className="mt-1">
                    Rule-based insights and optional AI failure analysis for a test run
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Run selector */}
                  <Select
                    value={qualityRunId}
                    onValueChange={v => {
                      setQualityRunId(v)
                      setQualityResult(null)
                    }}
                  >
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Select a run…" />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map(r => (
                        <SelectItem key={r.id} value={r.id}>
                          <span className="font-mono text-xs">#{r.id.slice(0, 12)}</span>
                          <span className="ml-2 text-muted-foreground text-xs">
                            {r.total_tests} tests · {r.status}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* AI toggle */}
                  <div className="flex items-center gap-2">
                    <Switch
                      id="include-ai"
                      checked={includeAI}
                      onCheckedChange={setIncludeAI}
                    />
                    <Label htmlFor="include-ai" className="text-sm whitespace-nowrap">
                      Include AI Analysis
                    </Label>
                  </div>

                  {/* Analyze button */}
                  <Button
                    onClick={handleAnalyzeQuality}
                    disabled={!qualityRunId || loadingQuality || !activeProject}
                  >
                    {loadingQuality ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    {loadingQuality ? 'Analyzing…' : 'Analyze'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!activeProject ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ShieldCheck className="h-16 w-16 text-muted-foreground opacity-30" />
                  <h3 className="mt-4 text-lg font-semibold">No project selected</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Select a project to analyze code quality.
                  </p>
                </div>
              ) : (
                <CodeQualityView result={qualityResult} loading={loadingQuality} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Schedule Dialog */}
      <ScheduleReportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
