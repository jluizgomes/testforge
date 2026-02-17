import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Calendar, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  apiClient,
  type Project,
  type ReportSchedule,
  type CreateScheduleInput,
} from '@/services/api-client'

interface ScheduleReportDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (schedule: ReportSchedule) => void
  defaultProjectId?: string
}

const CRON_PRESETS = [
  { label: 'Every day at 9am', value: '0 9 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: '1st of month', value: '0 9 1 * *' },
]

const FORMAT_OPTIONS = [
  { label: 'HTML', value: 'html' },
  { label: 'PDF', value: 'pdf' },
  { label: 'JSON', value: 'json' },
  { label: 'JUnit XML', value: 'xml' },
  { label: 'Markdown', value: 'markdown' },
]

function describeCron(expr: string): string {
  const preset = CRON_PRESETS.find(p => p.value === expr)
  if (preset) return preset.label
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return 'Custom cron expression'
  return `Custom schedule: ${expr}`
}

export function ScheduleReportDialog({
  open,
  onClose,
  onCreated,
  defaultProjectId,
}: ScheduleReportDialogProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [name, setName] = useState('')
  const [format, setFormat] = useState('html')
  const [cronExpr, setCronExpr] = useState('0 9 * * 1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      apiClient.getProjects().then(setProjects).catch(() => {})
      if (defaultProjectId) setProjectId(defaultProjectId)
    }
  }, [open, defaultProjectId])

  const handleSubmit = async () => {
    if (!projectId || !name.trim() || !cronExpr.trim()) return
    setSaving(true)
    setError(null)
    try {
      const input: CreateScheduleInput = {
        project_id: projectId,
        name: name.trim(),
        cron_expr: cronExpr.trim(),
        format,
      }
      const schedule = await apiClient.createSchedule(input)
      onCreated(schedule)
      onClose()
      setName('')
      setCronExpr('0 9 * * 1')
      setFormat('html')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = Boolean(projectId && name.trim() && cronExpr.trim())

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Schedule Report
          </DialogTitle>
          <DialogDescription>
            Automatically generate reports on a recurring schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Project */}
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Schedule Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Weekly E2E Report"
            />
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <Label>Report Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map(f => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cron */}
          <div className="space-y-1.5">
            <Label>Schedule</Label>
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent',
                    cronExpr === p.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground'
                  )}
                  onClick={() => setCronExpr(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              value={cronExpr}
              onChange={e => setCronExpr(e.target.value)}
              placeholder="0 9 * * 1"
              className="mt-1.5 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{describeCron(cronExpr)}</p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !canSubmit}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              'Create Schedule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
