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
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { apiClient, type ReportSchedule } from '@/services/api-client'
import { ScheduleReportDialog } from '../components/ScheduleReportDialog'

const recentReports = [
  {
    id: '1',
    name: 'Full E2E Test Report',
    date: '2024-01-15T14:30:00',
    format: 'HTML',
    size: '2.4 MB',
    status: 'passed',
  },
  {
    id: '2',
    name: 'API Integration Report',
    date: '2024-01-15T12:15:00',
    format: 'PDF',
    size: '1.8 MB',
    status: 'failed',
  },
  {
    id: '3',
    name: 'Weekly Summary',
    date: '2024-01-14T18:00:00',
    format: 'PDF',
    size: '3.2 MB',
    status: 'passed',
  },
]

const FORMAT_COLORS: Record<string, string> = {
  html: 'bg-blue-500/10 text-blue-600 border-blue-200',
  pdf: 'bg-red-500/10 text-red-600 border-red-200',
  json: 'bg-amber-500/10 text-amber-600 border-amber-200',
  xml: 'bg-purple-500/10 text-purple-600 border-purple-200',
  markdown: 'bg-slate-500/10 text-slate-600 border-slate-200',
}

export function ReportsPage() {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([])
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
        <Button>
          <FileText className="mr-2 h-4 w-4" />
          Generate Report
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reports Generated</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24</div>
            <p className="text-xs text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Pass Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">91.2%</div>
            <p className="text-xs text-muted-foreground">+2.3% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Test Runs</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">156</div>
            <p className="text-xs text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">4m 32s</div>
            <p className="text-xs text-muted-foreground">Per test run</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="recent">
        <TabsList>
          <TabsTrigger value="recent">Recent Reports</TabsTrigger>
          <TabsTrigger value="scheduled">
            Scheduled
            {schedules.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {schedules.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        {/* ── Recent Reports ── */}
        <TabsContent value="recent" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Reports</CardTitle>
              <CardDescription>
                Download or view your recently generated reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentReports.map(report => (
                  <div
                    key={report.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium">{report.name}</h4>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(report.date)}
                          <span>|</span>
                          {report.format}
                          <span>|</span>
                          {report.size}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge
                        variant={report.status === 'passed' ? 'success' : 'destructive'}
                      >
                        {report.status}
                      </Badge>
                      <Button variant="outline" size="sm">
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
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
                  <h3 className="mt-4 text-lg font-semibold">No scheduled reports</h3>
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
                                FORMAT_COLORS[schedule.format] ?? 'bg-muted text-muted-foreground'
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
                            <span className="font-mono">{schedule.cron_expr}</span>
                            {schedule.next_run_at && (
                              <>
                                <span>·</span>
                                <span>Next: {formatDate(schedule.next_run_at)}</span>
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
                          title={schedule.enabled ? 'Pause schedule' : 'Enable schedule'}
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
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Executive Summary</CardTitle>
                <CardDescription>
                  High-level overview for stakeholders
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Detailed Technical</CardTitle>
                <CardDescription>
                  In-depth analysis for developers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Compliance Report</CardTitle>
                <CardDescription>
                  Audit-ready documentation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full">
                  Use Template
                </Button>
              </CardContent>
            </Card>
          </div>
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
