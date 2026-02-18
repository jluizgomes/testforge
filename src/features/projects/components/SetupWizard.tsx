import { useState, useRef } from 'react'
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
import { Progress } from '@/components/ui/progress'
import {
  FolderOpen,
  Globe,
  Database,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { useProjectSetup } from '../hooks/useProjectSetup'

interface SetupWizardProps {
  onClose: () => void
}

const steps = [
  { id: 1, name: 'Project Info', icon: FolderOpen },
  { id: 2, name: 'Frontend', icon: Globe },
  { id: 3, name: 'Backend', icon: Server },
  { id: 4, name: 'Database', icon: Database },
  { id: 5, name: 'Review', icon: CheckCircle2 },
]

export function SetupWizard({ onClose }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [isScanning, setIsScanning] = useState(false)
  const [scanSummary, setScanSummary] = useState<string | null>(null)
  const discoveredStructureRef = useRef<Record<string, unknown> | null>(null)

  const { toast } = useToast()
  const {
    config,
    updateConfig,
    validateConnection,
    connectionStatus,
    createProject,
    isCreating,
  } = useProjectSetup()

  const progress = (currentStep / steps.length) * 100

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleCreate = async () => {
    const success = await createProject()
    if (success) {
      onClose()
    }
  }

  const triggerProjectScan = async (projectPath: string) => {
    if (!window.electronAPI) return
    setIsScanning(true)
    setScanSummary(null)
    try {
      const structure = await window.electronAPI.file.scanProject(projectPath)
      discoveredStructureRef.current = structure
      const total = (structure as { total_files?: number }).total_files ?? 0
      const eps = ((structure as { entry_points?: unknown[] }).entry_points ?? []).length
      setScanSummary(`Found ${total} files · ${eps} entry points`)
    } catch {
      setScanSummary('Scan unavailable — backend will scan on create')
    } finally {
      setIsScanning(false)
    }
  }

  const selectProjectPath = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.file?.openProject) {
      toast({
        title: 'Browse unavailable',
        description: 'Open the app with Electron to choose a folder (e.g. npm run electron:dev).',
        variant: 'destructive',
      })
      return
    }
    try {
      const projectPath = await window.electronAPI.file.openProject()
      if (projectPath) {
        updateConfig({ path: projectPath })
        triggerProjectScan(projectPath)
      }
    } catch (err) {
      toast({
        title: 'Could not open folder',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">New Project Setup</h1>
          <p className="text-muted-foreground">
            Configure your test project step by step
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          {steps.map(step => (
            <div
              key={step.id}
              className={`flex items-center gap-1 ${
                step.id <= currentStep
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <step.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{step.name}</span>
            </div>
          ))}
        </div>
        <Progress value={progress} />
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle>
            {steps[currentStep - 1].name}
          </CardTitle>
          <CardDescription>
            {currentStep === 1 && 'Enter basic information about your project'}
            {currentStep === 2 && 'Configure frontend testing settings'}
            {currentStep === 3 && 'Configure backend API settings'}
            {currentStep === 4 && 'Configure database connection'}
            {currentStep === 5 && 'Review your configuration'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: Project Info */}
          {currentStep === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  value={config.name}
                  onChange={e => updateConfig({ name: e.target.value })}
                  placeholder="My Project"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  value={config.description}
                  onChange={e => updateConfig({ description: e.target.value })}
                  placeholder="A brief description of your project"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="path">Project Path</Label>
                <div className="flex gap-2">
                  <Input
                    id="path"
                    value={config.path}
                    onChange={e => {
                      updateConfig({ path: e.target.value })
                      if (e.target.value.length > 3) triggerProjectScan(e.target.value)
                    }}
                    placeholder="/path/to/project"
                  />
                  <Button type="button" variant="outline" onClick={selectProjectPath}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Browse
                  </Button>
                </div>
                {/* Scanning feedback */}
                {isScanning && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Scanning project files…
                  </div>
                )}
                {!isScanning && scanSummary && (
                  <div className="flex items-center gap-1.5 text-xs text-green-600">
                    <CheckCircle2 className="h-3 w-3" />
                    {scanSummary}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step 2: Frontend */}
          {currentStep === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="frontendUrl">Frontend URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="frontendUrl"
                    value={config.frontendUrl}
                    onChange={e => updateConfig({ frontendUrl: e.target.value })}
                    placeholder="http://jluizgomes.local:3000"
                  />
                  <Button
                    variant="outline"
                    onClick={() => validateConnection('frontend')}
                    disabled={connectionStatus.frontend === 'checking'}
                  >
                    {connectionStatus.frontend === 'checking' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : connectionStatus.frontend === 'connected' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : connectionStatus.frontend === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Backend */}
          {currentStep === 3 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="backendUrl">Backend API URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="backendUrl"
                    value={config.backendUrl}
                    onChange={e => updateConfig({ backendUrl: e.target.value })}
                    placeholder="http://jluizgomes.local:8000"
                  />
                  <Button
                    variant="outline"
                    onClick={() => validateConnection('backend')}
                    disabled={connectionStatus.backend === 'checking'}
                  >
                    {connectionStatus.backend === 'checking' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : connectionStatus.backend === 'connected' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : connectionStatus.backend === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openApiUrl">OpenAPI Spec URL (optional)</Label>
                <Input
                  id="openApiUrl"
                  value={config.openApiUrl}
                  onChange={e => updateConfig({ openApiUrl: e.target.value })}
                  placeholder="http://jluizgomes.local:8000/openapi.json"
                />
              </div>
            </>
          )}

          {/* Step 4: Database */}
          {currentStep === 4 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="databaseUrl">Database URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="databaseUrl"
                    value={config.databaseUrl}
                    onChange={e => updateConfig({ databaseUrl: e.target.value })}
                    placeholder="postgresql://user:pass@jluizgomes.local:5432/db"
                  />
                  <Button
                    variant="outline"
                    onClick={() => validateConnection('database')}
                    disabled={connectionStatus.database === 'checking'}
                  >
                    {connectionStatus.database === 'checking' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : connectionStatus.database === 'connected' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : connectionStatus.database === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="redisUrl">Redis URL (optional)</Label>
                <Input
                  id="redisUrl"
                  value={config.redisUrl}
                  onChange={e => updateConfig({ redisUrl: e.target.value })}
                  placeholder="redis://jluizgomes.local:6379"
                />
              </div>
            </>
          )}

          {/* Step 5: Review */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <h4 className="font-medium">Project Info</h4>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Name:</dt>
                    <dd>{config.name || '-'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Path:</dt>
                    <dd className="truncate max-w-[200px]">{config.path || '-'}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border p-4">
                <h4 className="font-medium">Connections</h4>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Frontend:</dt>
                    <dd>{config.frontendUrl || 'Not configured'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Backend:</dt>
                    <dd>{config.backendUrl || 'Not configured'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Database:</dt>
                    <dd>{config.databaseUrl ? 'Configured' : 'Not configured'}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 1}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        {currentStep < steps.length ? (
          <Button onClick={handleNext}>
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Create Project
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
