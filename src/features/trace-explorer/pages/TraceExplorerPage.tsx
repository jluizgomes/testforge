import { useState, useEffect } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Clock, AlertCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api-client'
import type { Trace, Span, TestRun } from '@/services/api-client'
import { useProjects } from '@/features/projects/hooks/useProjects'
import { useAppStore } from '@/stores/app-store'

// ── Span tree ────────────────────────────────────────────────────────────────

interface SpanNode {
  id: string
  name: string
  service: string
  duration: number
  status: 'ok' | 'error'
  startOffset: number
  children?: SpanNode[]
}

function buildSpanTree(spans: Span[]): SpanNode | null {
  if (!spans.length) return null

  const traceStartMs = Math.min(
    ...spans.map(s => new Date(s.start_time).getTime())
  )

  function toNode(span: Span): SpanNode {
    const startMs = new Date(span.start_time).getTime()
    const children = spans
      .filter(s => s.parent_span_id === span.span_id)
      .map(toNode)
    return {
      id: span.id,
      name: span.operation,
      service: span.service,
      duration: span.duration_ms,
      status: span.status === 'ok' ? 'ok' : 'error',
      startOffset: startMs - traceStartMs,
      children: children.length > 0 ? children : undefined,
    }
  }

  // Find root spans (no parent or parent not in this trace)
  const spanIds = new Set(spans.map(s => s.span_id))
  const roots = spans.filter(
    s => !s.parent_span_id || !spanIds.has(s.parent_span_id)
  )

  if (roots.length === 1) return toNode(roots[0])

  // Multiple roots: wrap in a synthetic root
  const synthetic: SpanNode = {
    id: 'root',
    name: 'Trace',
    service: 'trace',
    duration: Math.max(...spans.map(s => s.duration_ms)),
    status: spans.some(s => s.status !== 'ok') ? 'error' : 'ok',
    startOffset: 0,
    children: roots.map(toNode),
  }
  return synthetic
}

// ── Flame Graph ──────────────────────────────────────────────────────────────

interface FlatNode {
  node: SpanNode
  depth: number
}

function flattenNodes(node: SpanNode, depth = 0): FlatNode[] {
  const result: FlatNode[] = [{ node, depth }]
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenNodes(child, depth + 1))
    }
  }
  return result
}

const SERVICE_COLORS: Record<string, string> = {
  playwright: '#8b5cf6',
  backend: '#22c55e',
  database: '#f59e0b',
  redis: '#ef4444',
  'e2e-test': '#3b82f6',
  trace: '#64748b',
}

function getServiceColor(service: string): string {
  return SERVICE_COLORS[service] ?? '#3b82f6'
}

interface FlameGraphProps {
  root: SpanNode
  selectedId?: string
  onSelect?: (node: SpanNode) => void
}

function FlameGraph({ root, selectedId, onSelect }: FlameGraphProps) {
  const [tooltip, setTooltip] = useState<{
    node: SpanNode
    x: number
    y: number
  } | null>(null)

  const flat = flattenNodes(root)
  const maxDepth = Math.max(...flat.map(f => f.depth))
  const totalDuration = root.duration

  const ROW_H = 26
  const ROW_GAP = 3
  const PADDING = 4
  const totalHeight = (maxDepth + 1) * (ROW_H + ROW_GAP) + PADDING * 2

  const pctLeft = (offset: number) =>
    totalDuration > 0 ? (offset / totalDuration) * 100 : 0
  const pctWidth = (duration: number) =>
    totalDuration > 0
      ? Math.max((duration / totalDuration) * 100, 0.3)
      : 100

  return (
    <div className="select-none">
      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(SERVICE_COLORS)
          .filter(([s]) => flat.some(f => f.node.service === s))
          .map(([svc, color]) => (
            <div
              key={svc}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <div
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: color }}
              />
              {svc}
            </div>
          ))}
      </div>

      {/* Ruler */}
      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
        <span>0ms</span>
        <span>{Math.round(totalDuration * 0.25)}ms</span>
        <span>{Math.round(totalDuration * 0.5)}ms</span>
        <span>{Math.round(totalDuration * 0.75)}ms</span>
        <span>{totalDuration}ms</span>
      </div>

      {/* Canvas */}
      <div
        className="relative rounded border bg-muted/20"
        style={{ height: `${totalHeight}px` }}
        onMouseLeave={() => setTooltip(null)}
      >
        {flat.map(({ node, depth }) => {
          const left = pctLeft(node.startOffset)
          const width = pctWidth(node.duration)
          const top = PADDING + depth * (ROW_H + ROW_GAP)
          const color =
            node.status === 'error' ? '#ef4444' : getServiceColor(node.service)
          const isSelected = selectedId === node.id

          return (
            <div
              key={node.id}
              className={cn(
                'absolute flex cursor-pointer items-center overflow-hidden rounded-sm px-1 transition-all hover:brightness-110',
                isSelected && 'ring-2 ring-white ring-offset-1'
              )}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: `${top}px`,
                height: `${ROW_H}px`,
                backgroundColor: color,
                minWidth: '4px',
              }}
              onClick={() => onSelect?.(node)}
              onMouseEnter={e => {
                const container = e.currentTarget.closest(
                  '.relative'
                ) as HTMLElement
                const rect = container.getBoundingClientRect()
                setTooltip({ node, x: e.clientX - rect.left, y: top })
              }}
            >
              {width > 6 && (
                <span className="truncate text-[10px] font-medium leading-none text-white drop-shadow">
                  {node.name}
                </span>
              )}
            </div>
          )
        })}

        {tooltip &&
          (() => {
            const belowY = tooltip.y + ROW_H + 6
            const useBelow = belowY + 72 < totalHeight
            return (
              <div
                className="pointer-events-none absolute z-20 min-w-[160px] rounded-md border bg-popover px-3 py-2 text-xs shadow-lg"
                style={{
                  left: Math.min(tooltip.x + 12, 65) + '%',
                  top: useBelow
                    ? `${belowY}px`
                    : `${tooltip.y - 72}px`,
                }}
              >
                <p className="font-semibold leading-tight">
                  {tooltip.node.name}
                </p>
                <p className="text-muted-foreground">{tooltip.node.service}</p>
                <div className="mt-1.5 flex justify-between gap-4">
                  <span>{tooltip.node.duration}ms</span>
                  <span
                    className={
                      tooltip.node.status === 'ok'
                        ? 'text-green-500'
                        : 'text-red-500'
                    }
                  >
                    {tooltip.node.status}
                  </span>
                </div>
              </div>
            )
          })()}
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Click a span to see details below
      </p>
    </div>
  )
}

// ── Span waterfall row ────────────────────────────────────────────────────────

function SpanRow({
  node,
  depth,
  totalDuration,
  selectedId,
  onSelect,
}: {
  node: SpanNode
  depth: number
  totalDuration: number
  selectedId: string | null
  onSelect: (n: SpanNode) => void
}) {
  const width =
    totalDuration > 0
      ? Math.max((node.duration / totalDuration) * 100, 0.5)
      : 100
  const left =
    totalDuration > 0 ? (node.startOffset / totalDuration) * 100 : 0

  return (
    <>
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-accent',
          selectedId === node.id && 'bg-accent'
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        <div className="w-32 truncate text-sm font-medium">{node.name}</div>
        <Badge variant="outline" className="text-xs shrink-0">
          {node.service}
        </Badge>
        <div className="flex-1">
          <div className="relative h-6 rounded bg-muted">
            <div
              className={cn(
                'absolute h-full rounded',
                node.status === 'ok' ? 'bg-green-500/70' : 'bg-red-500/70'
              )}
              style={{ width: `${width}%`, left: `${left}%` }}
            />
          </div>
        </div>
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
          {node.duration}ms
        </span>
      </div>
      {node.children?.map(child => (
        <SpanRow
          key={child.id}
          node={child}
          depth={depth + 1}
          totalDuration={totalDuration}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TraceExplorerPage() {
  const { projects } = useProjects()
  const currentProject = useAppStore(s => s.currentProject)

  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    currentProject?.id ?? ''
  )
  const [runs, setRuns] = useState<TestRun[]>([])
  const ALL_RUNS_VALUE = '__all__'
  const [selectedRunId, setSelectedRunId] = useState<string>(ALL_RUNS_VALUE)
  const [traces, setTraces] = useState<Trace[]>([])
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null)
  const [selectedSpan, setSelectedSpan] = useState<SpanNode | null>(null)
  const [search, setSearch] = useState('')

  const [runsLoading, setRunsLoading] = useState(false)
  const [tracesLoading, setTracesLoading] = useState(false)
  const [traceLoading, setTraceLoading] = useState(false)

  // Sync project selector with store current project
  useEffect(() => {
    if (currentProject?.id && !selectedProjectId) {
      setSelectedProjectId(currentProject.id)
    }
  }, [currentProject?.id, selectedProjectId])

  // Load runs when project changes
  useEffect(() => {
    if (!selectedProjectId) return
    setRunsLoading(true)
    setRuns([])
    setSelectedRunId('')
    apiClient
      .getTestRuns(selectedProjectId)
      .then(r => setRuns(r.slice(0, 20)))
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false))
  }, [selectedProjectId])

  // Load traces when run changes (or project changes without run filter)
  useEffect(() => {
    setTracesLoading(true)
    setTraces([])
    setSelectedTrace(null)
    setSelectedSpan(null)
    apiClient
      .getTraces(selectedRunId && selectedRunId !== ALL_RUNS_VALUE ? selectedRunId : undefined)
      .then(setTraces)
      .catch(() => setTraces([]))
      .finally(() => setTracesLoading(false))
  }, [selectedRunId])

  // Load full trace with spans when selected
  const handleSelectTrace = async (trace: Trace) => {
    setSelectedTrace(trace)
    setSelectedSpan(null)
    if (!trace.spans) {
      setTraceLoading(true)
      try {
        const full = await apiClient.getTrace(trace.id)
        setSelectedTrace(full)
      } catch {
        // keep partial trace
      } finally {
        setTraceLoading(false)
      }
    }
  }

  const filteredTraces = traces.filter(
    t =>
      !search ||
      t.root_operation.toLowerCase().includes(search.toLowerCase()) ||
      t.root_service.toLowerCase().includes(search.toLowerCase())
  )

  const spanTree =
    selectedTrace?.spans ? buildSpanTree(selectedTrace.spans) : null
  const totalDuration = spanTree?.duration ?? selectedTrace?.duration_ms ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Trace Explorer</h1>
          <p className="text-muted-foreground">
            Visualize and analyze distributed traces across your test suite
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTracesLoading(true)
            apiClient
              .getTraces(selectedRunId && selectedRunId !== ALL_RUNS_VALUE ? selectedRunId : undefined)
              .then(setTraces)
              .catch(() => {})
              .finally(() => setTracesLoading(false))
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={selectedProjectId} onValueChange={v => { setSelectedProjectId(v); setSelectedRunId(ALL_RUNS_VALUE) }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedRunId || ALL_RUNS_VALUE}
          onValueChange={setSelectedRunId}
          disabled={!selectedProjectId || runsLoading}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={runsLoading ? 'Loading…' : 'All runs'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_RUNS_VALUE}>All runs</SelectItem>
            {runs.map(r => (
              <SelectItem key={r.id} value={r.id}>
                #{r.id.slice(0, 8)} — {r.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Trace List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Traces</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search traces…"
                className="pl-8"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {tracesLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : filteredTraces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {traces.length === 0
                      ? 'No traces found. Run tests to generate traces.'
                      : 'No traces match the search.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTraces.map(trace => (
                    <div
                      key={trace.id}
                      className={cn(
                        'cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent',
                        selectedTrace?.id === trace.id &&
                          'border-primary bg-accent'
                      )}
                      onClick={() => handleSelectTrace(trace)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm font-medium max-w-[130px]">
                          {trace.root_operation}
                        </span>
                        {trace.status === 'ok' ? (
                          <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {trace.duration_ms != null
                          ? `${trace.duration_ms}ms`
                          : '—'}
                        <span>·</span>
                        <span>{trace.root_service}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Trace Detail */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">
              {selectedTrace
                ? selectedTrace.root_operation
                : 'Waterfall View'}
            </CardTitle>
            <CardDescription>
              Timeline visualization of spans in the selected trace
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedTrace ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="h-10 w-10 opacity-30" />
                <p className="mt-2 text-sm">
                  Select a trace from the list to view details
                </p>
              </div>
            ) : traceLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading spans…
              </div>
            ) : (
              <Tabs defaultValue="waterfall">
                <TabsList>
                  <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
                  <TabsTrigger value="flamegraph">Flame Graph</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>

                <TabsContent value="waterfall" className="mt-4">
                  {spanTree ? (
                    <>
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
                      <ScrollArea className="h-[400px]">
                        <SpanRow
                          node={spanTree}
                          depth={0}
                          totalDuration={totalDuration}
                          selectedId={selectedSpan?.id ?? null}
                          onSelect={setSelectedSpan}
                        />
                      </ScrollArea>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No span data available for this trace
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="flamegraph" className="mt-4">
                  {spanTree ? (
                    <FlameGraph
                      root={spanTree}
                      selectedId={selectedSpan?.id}
                      onSelect={setSelectedSpan}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No span data available for this trace
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="json" className="mt-4">
                  <ScrollArea className="h-[400px] rounded-md border bg-muted/50 p-4">
                    <pre className="text-sm">
                      {JSON.stringify(selectedTrace, null, 2)}
                    </pre>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Span Details */}
      {selectedSpan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Span Details: {selectedSpan.name}
            </CardTitle>
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
                  Start Offset
                </label>
                <p className="mt-1">{selectedSpan.startOffset}ms</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <p className="mt-1">
                  <Badge
                    variant={
                      selectedSpan.status === 'ok' ? 'success' : 'destructive'
                    }
                  >
                    {selectedSpan.status}
                  </Badge>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
