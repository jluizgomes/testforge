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
import {
  CheckCircle2,
  XCircle,
  FileCode2,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient, type GeneratedTestItem } from '@/services/api-client'

const MonacoEditor = lazy(() =>
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

export function TestSuggestionsView({ projectId }: TestSuggestionsViewProps) {
  const [tests, setTests] = useState<GeneratedTestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<GeneratedTestItem | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .getGeneratedTests(projectId)
      .then((items) => {
        setTests(items)
        if (items.length > 0) setSelected(items[0])
      })
      .finally(() => setLoading(false))
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

  return (
    <div className="grid gap-4 lg:grid-cols-5 h-[600px]">
      {/* ── Left: list ── */}
      <Card className="lg:col-span-2 flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Suggestions
          </CardTitle>
          <CardDescription>
            {accepted.length} accepted · {pending.length} pending
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            {tests.map((test) => (
              <button
                key={test.id}
                className={cn(
                  'w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors flex items-start gap-3',
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
                      {test.test_type}
                    </Badge>
                    {test.entry_point && (
                      <span className="text-xs text-muted-foreground truncate">
                        {test.entry_point.split('/').pop()}
                      </span>
                    )}
                  </div>
                </div>
              </button>
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
                language={selected.test_type === 'api' ? 'python' : 'typescript'}
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
  )
}
