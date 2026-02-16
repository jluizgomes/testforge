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
} from 'lucide-react'

// Mock data for demonstration
const stats = {
  totalTests: 156,
  passed: 142,
  failed: 8,
  pending: 6,
  passRate: 91.0,
  avgDuration: '2.3s',
  lastRun: '2 hours ago',
}

const recentRuns = [
  {
    id: '1',
    name: 'Full E2E Suite',
    status: 'passed',
    passed: 48,
    failed: 0,
    duration: '3m 24s',
    timestamp: '2024-01-15 14:30',
  },
  {
    id: '2',
    name: 'API Integration Tests',
    status: 'failed',
    passed: 32,
    failed: 3,
    duration: '1m 12s',
    timestamp: '2024-01-15 12:15',
  },
  {
    id: '3',
    name: 'Database Tests',
    status: 'passed',
    passed: 24,
    failed: 0,
    duration: '45s',
    timestamp: '2024-01-15 10:00',
  },
]

const healthMetrics = [
  { name: 'Frontend', status: 'healthy', latency: '120ms' },
  { name: 'Backend API', status: 'healthy', latency: '45ms' },
  { name: 'Database', status: 'healthy', latency: '12ms' },
  { name: 'Redis', status: 'warning', latency: '250ms' },
]

export function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your test suite and recent activity
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tests</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTests}</div>
            <p className="text-xs text-muted-foreground">
              Last run: {stats.lastRun}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.passRate}%</div>
            <Progress value={stats.passRate} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Passed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{stats.passed}</div>
            <p className="text-xs text-muted-foreground">
              {((stats.passed / stats.totalTests) * 100).toFixed(1)}% of total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
            <p className="text-xs text-muted-foreground">
              {stats.pending} pending
            </p>
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
            <div className="space-y-4">
              {recentRuns.map(run => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{run.name}</span>
                      <Badge
                        variant={run.status === 'passed' ? 'success' : 'destructive'}
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {run.passed} passed, {run.failed} failed
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-sm">
                      <Clock className="h-3 w-3" />
                      {run.duration}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {run.timestamp}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Health Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Real-time status of connected services</CardDescription>
          </CardHeader>
          <CardContent>
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
                          : metric.status === 'warning'
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <span className="font-medium">{metric.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {metric.status === 'warning' && (
                      <AlertTriangle className="h-4 w-4 text-warning" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {metric.latency}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
