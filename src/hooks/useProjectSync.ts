import { useState, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, type WorkspaceSyncStatus } from '@/services/api-client'
import { useAppStore } from '@/stores/app-store'

export type SyncStep = 'idle' | 'scanning' | 'compressing' | 'uploading' | 'done' | 'error'

export interface SyncProgress {
  step: SyncStep
  current: number   // files scanned / total
  lastFile: string  // most recently scanned file path
  files: string[]   // full list after completion
  error?: string
}

interface UseProjectSyncReturn {
  status: WorkspaceSyncStatus | null
  isSyncing: boolean
  isWatching: boolean
  progress: SyncProgress
  sync: () => Promise<void>
  unsync: () => Promise<void>
}

const IDLE: SyncProgress = { step: 'idle', current: 0, lastFile: '', files: [] }

export function useProjectSync(
  projectId: string | null,
  projectPath: string | null
): UseProjectSyncReturn {
  const [isSyncing, setIsSyncing] = useState(false)
  const [isWatching, setIsWatching] = useState(false)
  const [progress, setProgress] = useState<SyncProgress>(IDLE)
  const filesRef = useRef<string[]>([])
  const queryClient = useQueryClient()
  const backendUrl = useAppStore.getState().backendUrl || 'http://localhost:8000'

  const { data: status = null } = useQuery({
    queryKey: ['workspace-status', projectId],
    queryFn: () => apiClient.getWorkspaceStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: 30_000,
    retry: false,
  })

  const sync = useCallback(async () => {
    if (!projectId || !projectPath || !window.electronAPI) return

    filesRef.current = []
    setIsSyncing(true)
    setProgress({ step: 'scanning', current: 0, lastFile: '', files: [] })

    // Listen to real-time progress events from the main process
    window.electronAPI.file.onSyncProgress(({ step, current, file }) => {
      if (step === 'scanning') {
        if (file) filesRef.current.push(file)
        setProgress((p) => ({
          ...p,
          step: 'scanning',
          current,
          lastFile: file ?? p.lastFile,
        }))
      } else if (step === 'compressing') {
        setProgress((p) => ({ ...p, step: 'compressing', current }))
      } else if (step === 'uploading') {
        setProgress((p) => ({ ...p, step: 'uploading', current }))
      }
    })

    try {
      const result = await window.electronAPI.file.syncProject(
        projectPath,
        projectId,
        backendUrl
      )

      if (result.success) {
        setIsWatching(true)
        setProgress({
          step: 'done',
          current: result.file_count ?? filesRef.current.length,
          lastFile: '',
          files: result.files ?? filesRef.current,
        })
      } else {
        setProgress({
          step: 'error',
          current: filesRef.current.length,
          lastFile: '',
          files: filesRef.current,
          error: result.error,
        })
      }

      await queryClient.invalidateQueries({ queryKey: ['workspace-status', projectId] })
    } finally {
      window.electronAPI.file.offSyncProgress()
      setIsSyncing(false)
    }
  }, [projectId, projectPath, backendUrl, queryClient])

  const unsync = useCallback(async () => {
    if (!projectId) return
    if (window.electronAPI) {
      await window.electronAPI.file.unwatchProject(projectId)
    }
    setIsWatching(false)
    setProgress(IDLE)
    try {
      await apiClient.clearWorkspace(projectId)
      await queryClient.invalidateQueries({ queryKey: ['workspace-status', projectId] })
    } catch {
      // best-effort
    }
  }, [projectId, queryClient])

  return { status, isSyncing, isWatching, progress, sync, unsync }
}
