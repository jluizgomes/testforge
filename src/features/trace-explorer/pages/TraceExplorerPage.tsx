import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Search, Clock, AlertCircle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SpanData {
  id: string
  name: string
  service: string
  duration: number
  status: 'ok' | 'error'
  startOffset: number
  children?: SpanData[]
}

// Mock trace data
const mockTrace: SpanData = {
  id: '1',
  name: 'Test: User Login Flow',
  service: 'e2e-test',
  duration: 2340,
  status: 'ok',
  startOffset: 0,
  children: [
    {
      id: '2',
      name: 'Navigate to /login',
      service: 'playwright',
      duration: 450,
      status: 'ok',
      startOffset: 0,
    },
    {
      id: '3',
      name: 'POST /api/auth/login',
      service: 'backend',
      duration: 180,
      status: 'ok',
      startOffset: 500,
      children: [
        {
          id: '4',
          name: 'SELECT users WHERE email = ?',
          service: 'database',
          duration: 45,
          status: 'ok',
          startOffset: 520,
        },
        {
          id: '5',
          name: 'Redis GET session:*',
          service: 'redis',
          duration: 12,
          status: 'ok',
          startOffset: 580,
        },
      ],
    },
    {
      id: '6',
      name: 'Navigate to /dashboard',
      service: 'playwright',
      duration: 380,
      status: 'ok',
      startOffset: 700,
    },
    {
      id: '7',
      name: 'GET /api/user/profile',
      service: 'backend',
      duration: 95,
      status: 'ok',
      startOffset: 1100,
    },
  ],
}

const mockTraces = [
  { id: '1', name: 'User Login Flow', duration: 2340, status: 'ok', timestamp: '14:30:05' },
  { id: '2', name: 'Dashboard Load', duration: 1850, status: 'ok', timestamp: '14:30:08' },
  { id: '3', name: 'Form Submission', duration: 3200, status: 'error', timestamp: '14:30:12' },
  { id: '4', name: 'API Health Check', duration: 120, status: 'ok', timestamp: '14:30:15' },
]

export function TraceExplorerPage() {
  const [selectedTrace, setSelectedTrace] = useState<string | null>('1')
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null)

  const totalDuration = mockTrace.duration
  const getWidthPercent = (duration: number) => (duration / totalDuration) * 100
  const getLeftPercent = (offset: number) => (offset / totalDuration) * 100

  const renderSpan = (span: SpanData, depth = 0) => {
    const width = getWidthPercent(span.duration)
    const left = getLeftPercent(span.startOffset)

    return (
      <div key={span.id} className="mb-2">
        <div
          className={cn(
            'group flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-accent',
            selectedSpan?.id === span.id && 'bg-accent'
          )}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => setSelectedSpan(span)}
        >
          <div className="w-32 truncate text-sm font-medium">{span.name}</div>
          <Badge variant="outline" className="text-xs">
            {span.service}
          </Badge>
          <div className="flex-1">
            <div className="relative h-6 rounded bg-muted">
              <div
                className={cn(
                  'absolute h-full rounded',
                  span.status === 'ok' ? 'bg-green-500/70' : 'bg-red-500/70'
                )}
                style={{
                  width: `${width}%`,
                  left: `${left}%`,
                }}
              />
            </div>
          </div>
          <span className="w-16 text-right text-xs text-muted-foreground">
            {span.duration}ms
          </span>
        </div>
        {span.children?.map(child => renderSpan(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Trace Explorer</h1>
        <p className="text-muted-foreground">
          Visualize and analyze distributed traces across your test suite
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Trace List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Traces</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search traces..." className="pl-8" />
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {mockTraces.map(trace => (
                  <div
                    key={trace.id}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent',
                      selectedTrace === trace.id && 'border-primary bg-accent'
                    )}
                    onClick={() => setSelectedTrace(trace.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{trace.name}</span>
                      {trace.status === 'ok' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {trace.duration}ms
                      <span>|</span>
                      {trace.timestamp}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Trace Detail */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Waterfall View</CardTitle>
            <CardDescription>
              Timeline visualization of spans in the selected trace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="waterfall">
              <TabsList>
                <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
                <TabsTrigger value="flamegraph">Flame Graph</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="waterfall" className="mt-4">
                {/* Timeline header */}
                <div className="mb-4 flex items-center border-b pb-2">
                  <div className="w-32 text-sm font-medium text-muted-foreground">
                    Operation
                  </div>
                  <div className="ml-24 flex-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0ms</span>
                      <span>{Math.round(totalDuration / 4)}ms</span>
                      <span>{Math.round(totalDuration / 2)}ms</span>
                      <span>{Math.round((totalDuration * 3) / 4)}ms</span>
                      <span>{totalDuration}ms</span>
                    </div>
                  </div>
                  <div className="w-16" />
                </div>

                {/* Spans */}
                <ScrollArea className="h-[400px]">
                  {renderSpan(mockTrace)}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="flamegraph" className="mt-4">
                <div className="flex h-[400px] items-center justify-center text-muted-foreground">
                  Flame graph visualization coming soon
                </div>
              </TabsContent>

              <TabsContent value="json" className="mt-4">
                <ScrollArea className="h-[400px] rounded-md border bg-muted/50 p-4">
                  <pre className="text-sm">
                    {JSON.stringify(mockTrace, null, 2)}
                  </pre>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Span Details */}
      {selectedSpan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Span Details: {selectedSpan.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Service
                </label>
                <p className="mt-1">{selectedSpan.service}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Duration
                </label>
                <p className="mt-1">{selectedSpan.duration}ms</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <p className="mt-1">
                  <Badge variant={selectedSpan.status === 'ok' ? 'success' : 'destructive'}>
                    {selectedSpan.status}
                  </Badge>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Span ID
                </label>
                <p className="mt-1 font-mono text-sm">{selectedSpan.id}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
