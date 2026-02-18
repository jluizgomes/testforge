import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, XCircle, FileSearch } from 'lucide-react'
import { apiClient } from '@/services/api-client'
import { useWebSocket } from '@/hooks/useWebSocket'

interface ScanProgressModalProps {
  open: boolean
  projectId: string
  jobId: string | null
  onComplete: (jobId: string) => void
  onClose: () => void
}

interface ScanState {
  status: 'pending' | 'scanning' | 'generating' | 'completed' | 'failed'
  progress: number
  filesFound: number
  entryPointsFound: number
  testsGenerated: number
  errorMessage?: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Initializing…',
  scanning: 'Scanning project files…',
  generating: 'Generating test suggestions with AI…',
  completed: 'Scan complete!',
  failed: 'Scan failed',
}

export function ScanProgressModal({
  open,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  projectId: _projectId,
  jobId,
  onComplete,
  onClose,
}: ScanProgressModalProps) {
  const [state, setState] = useState<ScanState>({
    status: 'pending',
    progress: 0,
    filesFound: 0,
    entryPointsFound: 0,
    testsGenerated: 0,
  })

  const handleProgress = useCallback((data: Record<string, unknown>) => {
    setState({
      status: (data.status as ScanState['status']) ?? 'pending',
      progress: (data.progress as number) ?? 0,
      filesFound: (data.files_found as number) ?? 0,
      entryPointsFound: (data.entry_points_found as number) ?? 0,
      testsGenerated: (data.tests_generated as number) ?? 0,
      errorMessage: data.error_message as string | undefined,
    })
  }, [])

  const pollFn = useCallback(async () => {
    if (!jobId) throw new Error('no jobId')
    const res = await apiClient.getScanStatus(jobId)
    return res as unknown as Record<string, unknown>
  }, [jobId])

  useWebSocket<Record<string, unknown>>({
    jobType: 'scan',
    jobId,
    enabled: open && !!jobId && state.status !== 'completed' && state.status !== 'failed',
    onMessage: handleProgress,
    pollFn,
  })

  const isDone = state.status === 'completed' || state.status === 'failed'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            AI Project Scan
          </DialogTitle>
          <DialogDescription>
            Analyzing your project to generate intelligent test suggestions
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Status label */}
          <div className="flex items-center gap-2 text-sm font-medium">
            {state.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : state.status === 'failed' ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            {STATUS_LABELS[state.status] ?? state.status}
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <Progress value={state.progress} />
            <p className="text-xs text-right text-muted-foreground">{state.progress}%</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Files Found', value: state.filesFound },
              { label: 'Entry Points', value: state.entryPointsFound },
              { label: 'Tests Generated', value: state.testsGenerated },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-muted p-3">
                <p className="text-xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Phase badges */}
          <div className="flex gap-2 flex-wrap">
            {(['pending', 'scanning', 'generating', 'completed'] as const).map((phase) => {
              const order = ['pending', 'scanning', 'generating', 'completed']
              const current = order.indexOf(state.status)
              const phaseIdx = order.indexOf(phase)
              const done = current > phaseIdx
              const active = current === phaseIdx
              return (
                <Badge
                  key={phase}
                  variant={done ? 'success' : active ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {phase}
                </Badge>
              )
            })}
          </div>

          {/* Error */}
          {state.errorMessage && (
            <p className="text-xs text-destructive bg-destructive/10 rounded p-2">
              {state.errorMessage}
            </p>
          )}

          {/* Actions */}
          {isDone && (
            <div className="flex justify-end gap-2">
              {state.status === 'failed' && (
                <Button variant="outline" onClick={onClose} size="sm">
                  Close
                </Button>
              )}
              {state.status === 'completed' && (
                <>
                  <Button variant="outline" onClick={onClose} size="sm">
                    Close
                  </Button>
                  <Button onClick={() => onComplete(jobId!)} size="sm">
                    View Suggestions
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
