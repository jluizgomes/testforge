import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  TrendingUp,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { formatDate, formatDuration } from '@/lib/utils'
import { apiClient } from '@/services/api-client'
import type { TestRun, HealthData } from '@/services/api-client'
import { useProjects } from '@/features/projects/hooks/useProjects'
import { useAppStore } from '@/stores/app-store'

export function Dashboard() {
  const { projects } = useProjects()
  const currentProject = useAppStore(s => s.currentProject)
  const [runs, setRuns] = useState<TestRun[]>([])
  const [health, setHealth] = useState<HealthData | null>(null)
  const [runsLoading, setRunsLoading] = useState(false)
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState(false)

  // Prefer currentProject from store, fall back to first available project
  const activeProject = currentProject ?? projects[0] ?? null

  useEffect(() => {
    setHealthLoading(true)
    setHealthError(false)
    apiClient
      .healthCheck()
      .then(setHealth)
      .catch(() => setHealthError(true))
      .finally(() => setHealthLoading(false))
  }, [])

  useEffect(() => {
    if (!activeProject?.id) return
    setRunsLoading(true)
    apiClient
      .getTestRuns(activeProject.id)
      .then(r => setRuns(r.slice(0, 10)))
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false))
  }, [activeProject?.id])

  // Aggregate stats from completed runs
  const completedRuns = runs.filter(
    r => r.status === 'passed' || r.status === 'failed'
  )
  const totalTests = completedRuns.reduce((sum, r) => sum + r.total_tests, 0)
  const totalPassed = completedRuns.reduce((sum, r) => sum + r.passed_tests, 0)
  const totalFailed = completedRuns.reduce((sum, r) => sum + r.failed_tests, 0)
  const passRate =
    totalTests > 0
      ? Math.round((totalPassed / totalTests) * 100 * 10) / 10
      : 0
  const avgDurationMs =
    completedRuns.length > 0
      ? Math.round(
          completedRuns.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) /
            completedRuns.length
        )
      : null

  const healthMetrics = [
    {
      name: 'TestForge API',
      status: healthError ? 'unhealthy' : health ? 'healthy' : 'unknown',
      latency: null,
    },
    {
      name: 'Database',
      status: health?.services.database?.status ?? 'unknown',
      latency: health?.services.database?.latency_ms,
    },
    {
      name: 'Redis',
      status: health?.services.redis?.status ?? 'unknown',
      latency: health?.services.redis?.latency_ms,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your test suite and recent activity
          </p>
        </div>
        {activeProject && (
          <Badge variant="secondary" className="text-sm">
            {activeProject.name}
          </Badge>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {totalTests > 0 ? totalTests : '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {completedRuns.length} completed run
                  {completedRuns.length !== 1 ? 's' : ''}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {totalTests > 0 ? `${passRate}%` : '—'}
                </div>
                {totalTests > 0 && (
                  <Progress value={passRate} className="mt-2" />
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Passed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold text-success">
                  {totalPassed > 0 ? totalPassed : '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalTests > 0
                    ? `${((totalPassed / totalTests) * 100).toFixed(1)}% of total`
                    : 'No runs yet'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="text-2xl font-bold text-destructive">
                  {totalFailed > 0 ? totalFailed : '—'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {avgDurationMs
                    ? `Avg: ${formatDuration(avgDurationMs)}`
                    : 'No runs yet'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Test Runs</CardTitle>
            <CardDescription>Latest test execution results</CardDescription>
          </CardHeader>
          <CardContent>
            {!activeProject ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="h-10 w-10 text-muted-foreground opacity-30" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Create or select a project to see recent runs
                </p>
              </div>
            ) : runsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="h-10 w-10 text-muted-foreground opacity-30" />
                <p className="mt-2 text-sm font-medium">No test runs yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start a run from the Test Runner page
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {runs.slice(0, 5).map(run => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium font-mono">
                          #{run.id.slice(0, 8)}
                        </span>
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
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {run.total_tests} tests · {run.passed_tests} passed ·{' '}
                        {run.failed_tests} failed
                      </p>
                    </div>
                    <div className="text-right">
                      {run.duration_ms != null && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDuration(run.duration_ms)}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {formatDate(run.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Health Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>
              Real-time status of connected services
            </CardDescription>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking services…
              </div>
            ) : (
              <div className="space-y-4">
                {healthMetrics.map(metric => (
                  <div
                    key={metric.name}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-3 w-3 rounded-full ${
                          metric.status === 'healthy'
                            ? 'bg-green-500'
                            : metric.status === 'unhealthy'
                              ? 'bg-red-500'
                              : 'bg-gray-400'
                        }`}
                      />
                      <span className="font-medium">{metric.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {metric.status === 'unhealthy' && (
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {metric.latency != null
                          ? `${metric.latency}ms`
                          : metric.status === 'healthy'
                            ? 'online'
                            : metric.status === 'unhealthy'
                              ? 'offline'
                              : 'unknown'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
