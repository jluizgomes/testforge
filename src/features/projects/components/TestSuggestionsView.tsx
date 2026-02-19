import { useState, useEffect, Suspense, lazy } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import {
  CheckCircle2,
  XCircle,
  FileCode2,
  Sparkles,
  Loader2,
  Trash2,
  Download,
  Server,
  Monitor,
  Database,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient, type GeneratedTestItem } from '@/services/api-client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MonacoEditor = lazy((): Promise<any> =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })).catch(() => ({
    default: ({ value }: { value?: string }) => (
      <pre className="text-xs bg-zinc-950 text-zinc-300 p-4 rounded-md overflow-auto h-full whitespace-pre-wrap">
        {value}
      </pre>
    ),
  }))
)

interface TestSuggestionsViewProps {
  projectId: string
}

interface ScanStats {
  entry_points_by_type: Record<string, number>
  tests_by_type: Record<string, number>
  total_resources: number
  total_tests: number
}

const CATEGORY_META = [
  { key: 'backend', label: 'Backend', icon: Server, color: 'text-blue-500', bg: 'bg-blue-500' },
  { key: 'frontend', label: 'Frontend', icon: Monitor, color: 'text-green-500', bg: 'bg-green-500' },
  { key: 'database', label: 'Database', icon: Database, color: 'text-amber-500', bg: 'bg-amber-500' },
] as const

export function TestSuggestionsView({ projectId }: TestSuggestionsViewProps) {
  const [tests, setTests] = useState<GeneratedTestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GeneratedTestItem | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [bulkLoading, setBulkLoading] = useState<'accept' | 'reject' | null>(null)
  const [scanStats, setScanStats] = useState<ScanStats | null>(null)

  useEffect(() => {
    apiClient
      .getGeneratedTests(projectId)
      .then((items) => {
        setTests(items)
        if (items.length > 0) setSelected(items[0])
      })
      .finally(() => setLoading(false))

    apiClient.getScanStats(projectId).then(setScanStats).catch(() => {/* ignore */})
  }, [projectId])

  const handleAccept = async (test: GeneratedTestItem, accepted: boolean) => {
    setAccepting(test.id)
    try {
      const updated = await apiClient.acceptGeneratedTest(test.id, accepted)
      setTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      if (selected?.id === test.id) setSelected(updated)
    } finally {
      setAccepting(null)
    }
  }

  const handleDelete = async (test: GeneratedTestItem) => {
    setDeleting(test.id)
    try {
      await apiClient.deleteGeneratedTest(test.id)
      setTests((prev) => {
        const remaining = prev.filter((t) => t.id !== test.id)
        // Select next test if we deleted the selected one
        if (selected?.id === test.id) {
          const idx = prev.findIndex((t) => t.id === test.id)
          const next = remaining[Math.min(idx, remaining.length - 1)] ?? null
          setSelected(next)
        }
        return remaining
      })
    } finally {
      setDeleting(null)
    }
  }

  const handleAcceptAll = async () => {
    setBulkLoading('accept')
    try {
      const pending = tests.filter((t) => !t.accepted)
      const results = await Promise.allSettled(
        pending.map((t) => apiClient.acceptGeneratedTest(t.id, true))
      )
      const updated = results
        .filter((r): r is PromiseFulfilledResult<GeneratedTestItem> => r.status === 'fulfilled')
        .map((r) => r.value)
      setTests((prev) =>
        prev.map((t) => {
          const u = updated.find((u) => u.id === t.id)
          return u ?? t
        })
      )
      if (selected) {
        const u = updated.find((u) => u.id === selected.id)
        if (u) setSelected(u)
      }
    } finally {
      setBulkLoading(null)
    }
  }

  const handleRejectAll = async () => {
    setBulkLoading('reject')
    try {
      const accepted = tests.filter((t) => t.accepted)
      const results = await Promise.allSettled(
        accepted.map((t) => apiClient.acceptGeneratedTest(t.id, false))
      )
      const updated = results
        .filter((r): r is PromiseFulfilledResult<GeneratedTestItem> => r.status === 'fulfilled')
        .map((r) => r.value)
      setTests((prev) =>
        prev.map((t) => {
          const u = updated.find((u) => u.id === t.id)
          return u ?? t
        })
      )
      if (selected) {
        const u = updated.find((u) => u.id === selected.id)
        if (u) setSelected(u)
      }
    } finally {
      setBulkLoading(null)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await apiClient.exportAcceptedTests(projectId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tests-${projectId.slice(0, 8)}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading suggestions…
      </div>
    )
  }

  if (tests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Sparkles className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No test suggestions yet</p>
        <p className="text-xs">Click "Scan for Tests" to analyze your project with AI</p>
      </div>
    )
  }

  const accepted = tests.filter((t) => t.accepted)
  const pending = tests.filter((t) => !t.accepted)

  const hasStats = scanStats && scanStats.total_resources > 0

  return (
    <div className="space-y-4">
      {/* ── Resource Coverage Summary ── */}
      {hasStats && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Resource Coverage</CardTitle>
            <CardDescription>
              {scanStats.total_tests} tests generated for {scanStats.total_resources} resources found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              {CATEGORY_META.map(({ key, label, icon: Icon, color }) => {
                const resources = scanStats.entry_points_by_type[key] ?? 0
                const testsCount = scanStats.tests_by_type[key] ?? 0
                if (resources === 0 && testsCount === 0) return null
                const pct = resources > 0 ? Math.round((testsCount / resources) * 100) : 0
                return (
                  <div key={key} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${color}`} />
                        <span className="text-sm font-medium">{label}</span>
                      </div>
                      <span className="text-sm font-bold">{testsCount}/{resources}</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {pct}% coverage · {resources} resources · {testsCount} tests
                    </p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

    <div className="grid gap-4 lg:grid-cols-5 h-[600px]">
      {/* ── Left: list ── */}
      <Card className="lg:col-span-2 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI Suggestions
              </CardTitle>
              <CardDescription>
                {accepted.length} accepted · {pending.length} pending
              </CardDescription>
            </div>
            {accepted.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={handleExport}
              >
                {exporting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                )}
                Export ZIP
              </Button>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-red-500 border-red-200 hover:bg-red-50"
              disabled={accepted.length === 0 || bulkLoading !== null}
              onClick={handleRejectAll}
            >
              {bulkLoading === 'reject' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              Reject All
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={pending.length === 0 || bulkLoading !== null}
              onClick={handleAcceptAll}
            >
              {bulkLoading === 'accept' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Accept All
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            {tests.map((test) => (
              <div
                key={test.id}
                className={cn(
                  'group w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors flex items-start gap-3 cursor-pointer',
                  selected?.id === test.id && 'bg-muted'
                )}
                onClick={() => setSelected(test)}
              >
                <span className="mt-0.5 flex-shrink-0">
                  {test.accepted ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <FileCode2 className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{test.test_name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge variant="secondary" className="text-xs px-1">
                      {test.test_type === 'api' ? 'Backend' : test.test_type === 'database' ? 'Database' : 'Frontend'}
                    </Badge>
                    {test.test_language && (
                      <Badge variant="outline" className="text-[10px] px-1">
                        {test.test_language}
                      </Badge>
                    )}
                    {test.entry_point && (
                      <span className="text-xs text-muted-foreground truncate">
                        {test.entry_point.split('/').pop()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(test)
                  }}
                  disabled={deleting === test.id}
                  title="Delete suggestion"
                >
                  {deleting === test.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── Right: editor + actions ── */}
      <Card className="lg:col-span-3 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">
                {selected ? selected.test_name : 'Select a suggestion'}
              </CardTitle>
              {selected?.entry_point && (
                <CardDescription className="font-mono text-xs">
                  {selected.entry_point}
                </CardDescription>
              )}
            </div>
            {selected && (
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={deleting === selected.id}
                  onClick={() => handleDelete(selected)}
                >
                  {deleting === selected.id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                  )}
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-500 border-red-200 hover:bg-red-50"
                  disabled={!selected.accepted || accepting === selected.id}
                  onClick={() => selected && handleAccept(selected, false)}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={selected.accepted || accepting === selected.id}
                  onClick={() => selected && handleAccept(selected, true)}
                >
                  {accepting === selected.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {selected.accepted ? 'Accepted' : 'Accept'}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden rounded-b-lg border-t">
          {selected ? (
            <Suspense
              fallback={
                <pre className="text-xs bg-zinc-950 text-zinc-300 p-4 h-full overflow-auto whitespace-pre-wrap">
                  {selected.test_code}
                </pre>
              }
            >
              <MonacoEditor
                height="100%"
                language={
                  selected.test_language === 'go' ? 'go' :
                  selected.test_language === 'typescript' ? 'typescript' :
                  selected.test_language === 'javascript' ? 'javascript' :
                  selected.test_type === 'e2e' ? 'typescript' : 'python'
                }
                theme="vs-dark"
                value={selected.test_code}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineHeight: 19,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a suggestion to preview the code
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  )
}
