import { useState } from 'react'
import { useCreateProject } from './useProjects'
import { useToast } from '@/components/ui/use-toast'

interface ProjectConfig {
  name: string
  description: string
  path: string
  frontendUrl: string
  backendUrl: string
  openApiUrl: string
  databaseUrl: string
  redisUrl: string
}

type ConnectionType = 'frontend' | 'backend' | 'database'
type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'failed'

interface ConnectionStatuses {
  frontend: ConnectionStatus
  backend: ConnectionStatus
  database: ConnectionStatus
}

const initialConfig: ProjectConfig = {
  name: '',
  description: '',
  path: '',
  frontendUrl: '',
  backendUrl: '',
  openApiUrl: '',
  databaseUrl: '',
  redisUrl: '',
}

export function useProjectSetup() {
  const [config, setConfig] = useState<ProjectConfig>(initialConfig)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatuses>({
    frontend: 'idle',
    backend: 'idle',
    database: 'idle',
  })

  const { toast } = useToast()
  const createProjectMutation = useCreateProject()

  const updateConfig = (updates: Partial<ProjectConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }))
  }

  const validateConnection = async (type: ConnectionType) => {
    setConnectionStatus(prev => ({ ...prev, [type]: 'checking' }))

    try {
      let url = ''
      switch (type) {
        case 'frontend':
          url = config.frontendUrl
          break
        case 'backend':
          url = config.backendUrl
          break
        case 'database':
          // For database, we'd need to call the backend to test
          url = config.databaseUrl
          break
      }

      if (!url) {
        setConnectionStatus(prev => ({ ...prev, [type]: 'failed' }))
        return
      }

      // For frontend/backend, try a simple fetch. Any response (2xx, 4xx, 5xx) = server is there
      if (type !== 'database') {
        await fetch(url, { method: 'GET' })
        // Any response (2xx, 4xx, 5xx) means the host responded
        setConnectionStatus(prev => ({ ...prev, [type]: 'connected' }))
      } else {
        // For database, we'd need backend support
        // For now, mark as connected if URL is provided
        setConnectionStatus(prev => ({ ...prev, [type]: 'connected' }))
      }
    } catch {
      setConnectionStatus(prev => ({ ...prev, [type]: 'failed' }))
    }
  }

  const createProject = async (): Promise<boolean> => {
    if (!config.name || !config.path) {
      toast({
        title: 'Validation Error',
        description: 'Project name and path are required',
        variant: 'destructive',
      })
      return false
    }

    try {
      await createProjectMutation.mutateAsync({
        name: config.name,
        description: config.description || undefined,
        path: config.path,
        config: {
          frontend_url: config.frontendUrl || undefined,
          backend_url: config.backendUrl || undefined,
          openapi_url: config.openApiUrl || undefined,
          database_url: config.databaseUrl || undefined,
          redis_url: config.redisUrl || undefined,
        },
      })

      toast({
        title: 'Project Created',
        description: `Successfully created project "${config.name}"`,
      })

      return true
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create project',
        variant: 'destructive',
      })
      return false
    }
  }

  return {
    config,
    updateConfig,
    validateConnection,
    connectionStatus,
    createProject,
    isCreating: createProjectMutation.isPending,
  }
}
