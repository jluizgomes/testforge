import { useState, Suspense, lazy } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  X,
  Copy,
  Download,
  Sparkles,
  FileCode,
  Loader2,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/services/api-client'
import { useAppStore } from '@/stores/app-store'

// Lazy-load Monaco to avoid crashing if not installed yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MonacoEditor = lazy((): Promise<any> =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })).catch(() => ({
    default: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
      <textarea
        className="w-full h-full bg-zinc-950 text-zinc-300 p-4 font-mono text-sm resize-none outline-none"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        spellCheck={false}
      />
    ),
  }))
)

// ── Types ──────────────────────────────────────────────────────────────────

type Language = 'typescript' | 'javascript' | 'python'

interface Tab {
  id: string
  name: string
  language: Language
  content: string
  isDirty: boolean
}

// ── Templates ─────────────────────────────────────────────────────────────

const TEMPLATES: Record<Language, string> = {
  typescript: `import { test, expect } from '@playwright/test'

test.describe('My Test Suite', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page).toHaveTitle(/Home/)
  })

  test('should display the navigation', async ({ page }) => {
    await page.goto('http://localhost:3000')
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })
})
`,
  javascript: `const { test, expect } = require('@playwright/test')

test.describe('My Test Suite', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page).toHaveTitle(/Home/)
  })
})
`,
  python: `import pytest
from playwright.sync_api import Page, expect

def test_home_page(page: Page):
    page.goto('http://localhost:3000')
    expect(page).to_have_title(re.compile('Home'))

def test_navigation(page: Page):
    page.goto('http://localhost:3000')
    nav = page.locator('nav')
    expect(nav).to_be_visible()
`,
}

const LANG_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
}

// ── Component ──────────────────────────────────────────────────────────────

let tabCounter = 1

function makeTab(language: Language = 'typescript'): Tab {
  return {
    id: `tab-${Date.now()}-${tabCounter++}`,
    name: `test-${tabCounter - 1}.${language === 'python' ? 'py' : 'ts'}`,
    language,
    content: TEMPLATES[language],
    isDirty: false,
  }
}

export function TestEditorPage() {
  const currentProject = useAppStore(s => s.currentProject)

  const [tabs, setTabs] = useState<Tab[]>([makeTab('typescript')])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]

  // ── Tab actions ───────────────────────────────────────────────────────────

  const addTab = () => {
    const tab = makeTab('typescript')
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }

  const closeTab = (id: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        const fresh = makeTab('typescript')
        setActiveTabId(fresh.id)
        return [fresh]
      }
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1].id)
      }
      return next
    })
  }

  const updateContent = (content: string) => {
    setTabs(prev =>
      prev.map(t =>
        t.id === activeTabId ? { ...t, content, isDirty: true } : t
      )
    )
  }

  const updateLanguage = (language: Language) => {
    setTabs(prev =>
      prev.map(t => {
        if (t.id !== activeTabId) return t
        const ext = language === 'python' ? 'py' : 'ts'
        const name = t.name.replace(/\.(ts|js|py)$/, `.${ext}`)
        return { ...t, language, name }
      })
    )
  }

  // ── AI generation ─────────────────────────────────────────────────────────

  const handleGenerateTests = async () => {
    if (!currentProject) return
    setIsGenerating(true)
    try {
      const res = await apiClient.generateTests(
        currentProject.id,
        `Generate ${LANG_LABELS[activeTab.language]} tests for project: ${currentProject.name}`
      )
      if (res.tests?.[0]) {
        updateContent(res.tests[0])
      }
    } catch {
      // ignore
    } finally {
      setIsGenerating(false)
    }
  }

  // ── Copy ──────────────────────────────────────────────────────────────────

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeTab.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = () => {
    const blob = new Blob([activeTab.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeTab.name
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Test Editor</h1>
          <p className="text-muted-foreground">
            Write, generate, and manage test files
          </p>
        </div>
        {currentProject && (
          <Badge variant="secondary" className="text-sm">
            {currentProject.name}
          </Badge>
        )}
      </div>

      {/* Editor card */}
      <Card className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <CardHeader className="flex-row items-center justify-between gap-4 border-b pb-3 pt-3">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Editor</CardTitle>
          </div>

          <div className="flex items-center gap-2">
            {/* Language selector */}
            <Select
              value={activeTab.language}
              onValueChange={(v) => updateLanguage(v as Language)}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
              </SelectContent>
            </Select>

            {/* AI Generate */}
            <Button
              variant="outline"
              size="sm"
              disabled={isGenerating || !currentProject}
              onClick={handleGenerateTests}
              title={!currentProject ? 'Select a project first' : 'Generate tests with AI'}
            >
              {isGenerating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generate
            </Button>

            {/* Copy */}
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>

            {/* Download */}
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
          {/* Tab bar */}
          <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1">
            <ScrollArea className="flex-1">
              <div className="flex items-center gap-1">
                {tabs.map(tab => (
                  <div
                    key={tab.id}
                    className={cn(
                      'group flex cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs transition-colors',
                      tab.id === activeTabId
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/50'
                    )}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span className="max-w-[120px] truncate">{tab.name}</span>
                    {tab.isDirty && (
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    )}
                    {tabs.length > 1 && (
                      <button
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(tab.id)
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* New tab button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={addTab}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Monaco editor */}
          <div className="flex-1 overflow-hidden">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading editor…
                </div>
              }
            >
              <MonacoEditor
                height="100%"
                language={
                  activeTab.language === 'typescript'
                    ? 'typescript'
                    : activeTab.language === 'javascript'
                      ? 'javascript'
                      : 'python'
                }
                theme="vs-dark"
                value={activeTab.content}
                onChange={(val: string | undefined) => updateContent(val ?? '')}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  tabSize: 2,
                  automaticLayout: true,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </Suspense>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
