import { useEffect, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/stores/app-store'
import { apiClient, type AppSettings } from '@/services/api-client'

const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: 'openai',
  ai_model: 'gpt-4',
  openai_api_key: '',
  ollama_url: 'http://localhost:11434',
  notifications_desktop: true,
  notifications_sound: false,
  runner_parallel: true,
  runner_auto_retry: false,
  runner_screenshot_on_failure: true,
  rag_auto_index: true,
  rag_include_openapi: true,
}

type ConnStatus = 'idle' | 'checking' | 'ok' | 'error'

interface ConnState {
  status: ConnStatus
  latency?: number
  error?: string
}

export function SettingsPage() {
  const { theme, setTheme } = useAppStore()
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Connection validation
  const [dbUrl, setDbUrl] = useState('')
  const [redisUrl, setRedisUrl] = useState('')
  const [dbConn, setDbConn] = useState<ConnState>({ status: 'idle' })
  const [redisConn, setRedisConn] = useState<ConnState>({ status: 'idle' })

  useEffect(() => {
    apiClient
      .getSettings()
      .then((s) => setSettings(s))
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false))
  }, [])

  const patch = (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await apiClient.updateSettings(settings)
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const validateConn = async (type: 'database' | 'redis', url: string) => {
    const setter = type === 'database' ? setDbConn : setRedisConn
    setter({ status: 'checking' })
    try {
      const res = await apiClient.validateConnection(type, url)
      setter(
        res.connected
          ? { status: 'ok', latency: res.latency_ms }
          : { status: 'error', error: res.error }
      )
    } catch (err: unknown) {
      setter({ status: 'error', error: String(err) })
    }
  }

  const ConnBadge = ({ state }: { state: ConnState }) => {
    if (state.status === 'idle') return null
    if (state.status === 'checking')
      return <Badge variant="secondary">Checking…</Badge>
    if (state.status === 'ok')
      return (
        <Badge className="bg-green-100 text-green-700">
          Connected {state.latency !== undefined ? `· ${state.latency}ms` : ''}
        </Badge>
      )
    return <Badge variant="destructive">{state.error || 'Failed'}</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        Loading settings…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Configure TestForge AI to match your preferences
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </Button>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ai">AI Settings</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>

        {/* ── General ── */}
        <TabsContent value="general" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize the look and feel of the application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="theme">Theme</Label>
                  <p className="text-sm text-muted-foreground">
                    Select your preferred color scheme
                  </p>
                </div>
                <Select
                  value={theme}
                  onValueChange={(v) => setTheme(v as 'light' | 'dark')}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                Configure how you receive notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Desktop Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Show notifications when tests complete
                  </p>
                </div>
                <Switch
                  checked={settings.notifications_desktop}
                  onCheckedChange={(v) => patch('notifications_desktop', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Sound Effects</Label>
                  <p className="text-sm text-muted-foreground">
                    Play sounds for test results
                  </p>
                </div>
                <Switch
                  checked={settings.notifications_sound}
                  onCheckedChange={(v) => patch('notifications_sound', v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Test Runner</CardTitle>
              <CardDescription>
                Configure default test runner settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Parallel Execution</Label>
                  <p className="text-sm text-muted-foreground">
                    Run tests in parallel for faster execution
                  </p>
                </div>
                <Switch
                  checked={settings.runner_parallel}
                  onCheckedChange={(v) => patch('runner_parallel', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-retry Failed Tests</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically retry failed tests once
                  </p>
                </div>
                <Switch
                  checked={settings.runner_auto_retry}
                  onCheckedChange={(v) => patch('runner_auto_retry', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Screenshot on Failure</Label>
                  <p className="text-sm text-muted-foreground">
                    Capture screenshots when tests fail
                  </p>
                </div>
                <Switch
                  checked={settings.runner_screenshot_on_failure}
                  onCheckedChange={(v) => patch('runner_screenshot_on_failure', v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AI Settings ── */}
        <TabsContent value="ai" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Provider</CardTitle>
              <CardDescription>
                Configure the AI model used for test generation and analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={settings.ai_provider}
                  onValueChange={(v) => patch('ai_provider', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="ollama">Ollama (Local)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={settings.ai_model}
                  onValueChange={(v) => patch('ai_model', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4">GPT-4</SelectItem>
                    <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                    <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>OpenAI API Key</Label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={settings.openai_api_key}
                  onChange={(e) => patch('openai_api_key', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stored locally in backend/data/settings.json — never shared externally
                </p>
              </div>
              <div className="space-y-2">
                <Label>Ollama URL</Label>
                <Input
                  placeholder="http://localhost:11434"
                  value={settings.ollama_url}
                  onChange={(e) => patch('ollama_url', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>RAG Configuration</CardTitle>
              <CardDescription>
                Configure retrieval-augmented generation settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-index Codebase</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically index project files for context
                  </p>
                </div>
                <Switch
                  checked={settings.rag_auto_index}
                  onCheckedChange={(v) => patch('rag_auto_index', v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Include OpenAPI Specs</Label>
                  <p className="text-sm text-muted-foreground">
                    Index OpenAPI specifications for API testing
                  </p>
                </div>
                <Switch
                  checked={settings.rag_include_openapi}
                  onCheckedChange={(v) => patch('rag_include_openapi', v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Integrations ── */}
        <TabsContent value="integrations" className="mt-6 space-y-6">
          {/* Connection Validation */}
          <Card>
            <CardHeader>
              <CardTitle>System Connections</CardTitle>
              <CardDescription>
                Test connectivity to your database and Redis instance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Database */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Database URL</Label>
                  <ConnBadge state={dbConn} />
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="postgresql://user:pass@host:5432/db"
                    value={dbUrl}
                    onChange={(e) => setDbUrl(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => validateConn('database', dbUrl)}
                    disabled={!dbUrl || dbConn.status === 'checking'}
                  >
                    Test
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Redis */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Redis URL</Label>
                  <ConnBadge state={redisConn} />
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="redis://host:6379"
                    value={redisUrl}
                    onChange={(e) => setRedisUrl(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => validateConn('redis', redisUrl)}
                    disabled={!redisUrl || redisConn.status === 'checking'}
                  >
                    Test
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Third-party integrations */}
          <Card>
            <CardHeader>
              <CardTitle>Connected Services</CardTitle>
              <CardDescription>
                Manage integrations with external services
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  name: 'GitHub',
                  desc: 'Connect to sync tests with repositories',
                },
                {
                  name: 'Slack',
                  desc: 'Get notifications in Slack channels',
                },
                {
                  name: 'Jira',
                  desc: 'Link test failures to Jira issues',
                },
              ].map((svc) => (
                <div
                  key={svc.name}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <h4 className="font-medium">{svc.name}</h4>
                    <p className="text-sm text-muted-foreground">{svc.desc}</p>
                  </div>
                  <Button variant="outline" disabled>
                    Coming soon
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── About ── */}
        <TabsContent value="about" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>About TestForge AI</CardTitle>
              <CardDescription>
                Application information and version details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                ['Version', '1.0.0'],
                ['Electron', '28.2.0'],
                ['React', '18.2.0'],
                ['Python Backend', '3.11+'],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{value}</span>
                  </div>
                  <Separator className="mt-4" />
                </div>
              ))}
              <div className="pt-2">
                <Button variant="outline" className="w-full">
                  Check for Updates
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
