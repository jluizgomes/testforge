import { useState } from 'react'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TestStatus = 'idle' | 'running' | 'passed' | 'failed'

interface TestLayer {
  id: string
  name: string
  icon: React.ElementType
  status: TestStatus
  tests: number
  passed: number
  failed: number
}

const testLayers: TestLayer[] = [
  { id: 'frontend', name: 'Frontend', icon: Monitor, status: 'idle', tests: 24, passed: 0, failed: 0 },
  { id: 'backend', name: 'Backend', icon: Server, status: 'idle', tests: 36, passed: 0, failed: 0 },
  { id: 'database', name: 'Database', icon: Database, status: 'idle', tests: 12, passed: 0, failed: 0 },
  { id: 'infrastructure', name: 'Infrastructure', icon: Wifi, status: 'idle', tests: 8, passed: 0, failed: 0 },
]

const mockLogs = [
  { time: '14:30:01', level: 'info', message: 'Starting test run...' },
  { time: '14:30:02', level: 'info', message: 'Initializing Playwright browser' },
  { time: '14:30:03', level: 'info', message: 'Running frontend tests...' },
  { time: '14:30:05', level: 'success', message: 'Test: Login flow - PASSED' },
  { time: '14:30:08', level: 'success', message: 'Test: Navigation - PASSED' },
  { time: '14:30:12', level: 'error', message: 'Test: Form submission - FAILED' },
  { time: '14:30:12', level: 'error', message: '  Error: Element not found: #submit-btn' },
]

export function TestRunnerPage() {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null)

  const handleStart = () => {
    setIsRunning(true)
    setProgress(0)
    // Simulate progress
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setIsRunning(false)
          return 100
        }
        return prev + 5
      })
    }, 500)
  }

  const handleStop = () => {
    setIsRunning(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Test Runner</h1>
          <p className="text-muted-foreground">
            Execute and monitor your E2E test suite
          </p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Button variant="destructive" onClick={handleStop}>
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button onClick={handleStart}>
              <Play className="mr-2 h-4 w-4" />
              Run All Tests
            </Button>
          )}
          <Button variant="outline" disabled={isRunning}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Rerun Failed
          </Button>
        </div>
      </div>

      {/* Progress */}
      {isRunning && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Running tests...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Layers Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {testLayers.map(layer => (
          <Card
            key={layer.id}
            className={cn(
              'cursor-pointer transition-all hover:shadow-md',
              selectedLayer === layer.id && 'ring-2 ring-primary'
            )}
            onClick={() => setSelectedLayer(layer.id)}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {layer.name}
              </CardTitle>
              <layer.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{layer.tests}</div>
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

      {/* Details Tabs */}
      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Test Logs</CardTitle>
              <CardDescription>Real-time output from test execution</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] rounded-md border bg-muted/50 p-4 font-mono text-sm">
                {mockLogs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      'py-1',
                      log.level === 'error' && 'text-red-500',
                      log.level === 'success' && 'text-green-500',
                      log.level === 'info' && 'text-muted-foreground'
                    )}
                  >
                    <span className="text-muted-foreground">[{log.time}]</span>{' '}
                    {log.message}
                  </div>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="screenshots" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Screenshots</CardTitle>
              <CardDescription>Captured screenshots from test steps</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                No screenshots captured yet
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Network Requests</CardTitle>
              <CardDescription>HTTP requests made during tests</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                No network requests captured yet
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
