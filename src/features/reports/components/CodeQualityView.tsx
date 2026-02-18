import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  Wrench,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import type { CodeQualityResult, CodeQualityInsight } from '@/services/api-client'

interface Props {
  result: CodeQualityResult | null
  loading: boolean
}

const GRADE_COLORS: Record<string, string> = {
  A: 'text-green-600 border-green-500',
  B: 'text-blue-600 border-blue-500',
  C: 'text-yellow-600 border-yellow-500',
  D: 'text-orange-600 border-orange-500',
  F: 'text-red-600 border-red-500',
}

const GRADE_BG: Record<string, string> = {
  A: 'bg-green-50 dark:bg-green-950/30',
  B: 'bg-blue-50 dark:bg-blue-950/30',
  C: 'bg-yellow-50 dark:bg-yellow-950/30',
  D: 'bg-orange-50 dark:bg-orange-950/30',
  F: 'bg-red-50 dark:bg-red-950/30',
}

function InsightCard({ insight }: { insight: CodeQualityInsight }) {
  const isError = insight.severity === 'error'
  const isWarning = insight.severity === 'warning'

  const Icon = isError ? AlertCircle : isWarning ? AlertTriangle : Lightbulb
  const iconClass = isError
    ? 'text-red-500'
    : isWarning
      ? 'text-yellow-500'
      : 'text-blue-500'
  const borderClass = isError
    ? 'border-red-200 dark:border-red-800'
    : isWarning
      ? 'border-yellow-200 dark:border-yellow-800'
      : 'border-blue-200 dark:border-blue-800'

  return (
    <div className={`rounded-lg border p-4 space-y-2 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{insight.title}</span>
            <Badge variant="outline" className="text-[10px] py-0">
              {insight.category}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{insight.description}</p>

          {insight.affected_tests.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {insight.affected_tests.slice(0, 6).map(t => (
                <Badge key={t} variant="secondary" className="text-[11px] font-mono max-w-[200px] truncate">
                  {t}
                </Badge>
              ))}
              {insight.affected_tests.length > 6 && (
                <Badge variant="secondary" className="text-[11px]">
                  +{insight.affected_tests.length - 6} more
                </Badge>
              )}
            </div>
          )}

          <div className="flex items-start gap-1.5 mt-2 text-sm text-muted-foreground">
            <Wrench className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            <span>{insight.fix}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CodeQualityView({ result, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Analyzing code quality…
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <ShieldCheck className="h-14 w-14 opacity-20 mb-4" />
        <p className="text-sm">Select a test run and click <strong>Analyze</strong> to see code quality insights.</p>
      </div>
    )
  }

  const errors = result.insights.filter(i => i.severity === 'error')
  const warnings = result.insights.filter(i => i.severity === 'warning')
  const suggestions = result.insights.filter(i => i.severity === 'suggestion')

  const gradeColor = GRADE_COLORS[result.grade] ?? GRADE_COLORS['F']
  const gradeBg = GRADE_BG[result.grade] ?? GRADE_BG['F']

  return (
    <div className="space-y-6">
      {/* Score + Grade */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={`md:col-span-1 ${gradeBg}`}>
          <CardContent className="pt-6 flex flex-col items-center justify-center gap-2">
            <div className={`text-6xl font-bold tabular-nums ${gradeColor.split(' ')[0]}`}>
              {result.quality_score}
            </div>
            <div
              className={`text-3xl font-bold border-2 rounded-full w-14 h-14 flex items-center justify-center ${gradeColor}`}
            >
              {result.grade}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Quality Score / Grade</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{result.summary}</p>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                <span className="font-medium">{errors.length}</span> error{errors.length !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                <span className="font-medium">{warnings.length}</span> warning{warnings.length !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1">
                <Lightbulb className="h-3.5 w-3.5 text-blue-500" />
                <span className="font-medium">{suggestions.length}</span> suggestion{suggestions.length !== 1 ? 's' : ''}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      {result.insights.length > 0 && (
        <div className="space-y-4">
          {errors.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5 text-red-600">
                <AlertCircle className="h-4 w-4" /> Errors ({errors.length})
              </h3>
              {errors.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5 text-yellow-600">
                <AlertTriangle className="h-4 w-4" /> Warnings ({warnings.length})
              </h3>
              {warnings.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5 text-blue-600">
                <Lightbulb className="h-4 w-4" /> Suggestions ({suggestions.length})
              </h3>
              {suggestions.map((insight, i) => (
                <InsightCard key={i} insight={insight} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error Patterns */}
      {result.patterns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Error Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Pattern</th>
                    <th className="text-center py-2 px-4 font-medium">Count</th>
                    <th className="text-left py-2 pl-4 font-medium">Affected Tests</th>
                  </tr>
                </thead>
                <tbody>
                  {result.patterns.map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{p.pattern}</td>
                      <td className="py-2 px-4 text-center">
                        <Badge variant="secondary">{p.count}</Badge>
                      </td>
                      <td className="py-2 pl-4">
                        <div className="flex flex-wrap gap-1">
                          {p.tests.slice(0, 4).map(t => (
                            <Badge key={t} variant="outline" className="text-[10px] font-mono max-w-[160px] truncate">
                              {t}
                            </Badge>
                          ))}
                          {p.tests.length > 4 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{p.tests.length - 4}
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Failure Analyses */}
      {result.failure_analyses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">AI Failure Analyses</h3>
          {result.failure_analyses.map((fa, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono">{fa.test_name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {fa.root_cause && (
                  <p className="text-sm">
                    <span className="font-medium">Root cause: </span>
                    {fa.root_cause}
                  </p>
                )}
                {fa.suggestions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Suggestions:</p>
                    <ul className="space-y-1">
                      {fa.suggestions.map((s, j) => (
                        <li key={j} className="text-sm text-muted-foreground flex gap-2">
                          <Wrench className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  Confidence:
                  <Badge variant="outline" className="text-[10px]">
                    {Math.round(fa.confidence * 100)}%
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {result.insights.length === 0 && result.patterns.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <ShieldCheck className="h-10 w-10 opacity-30 mb-3" />
          <p className="text-sm">No issues found — excellent code quality!</p>
        </div>
      )}
    </div>
  )
}
