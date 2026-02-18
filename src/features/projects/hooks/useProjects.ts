import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Project, type CreateProjectInput, type TestRun } from '@/services/api-client'

export interface ProjectWithStats {
  project: Project
  lastRun: TestRun | null
  passRate: number | null
  totalRuns: number
  runsLoading: boolean
}

export function useProjects() {
  const { data: projects = [], isLoading, error, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.getProjects(),
    refetchOnMount: 'always',
  })

  return { projects, isLoading, error, refetch }
}

export function useProjectsWithStats(): {
  projectsWithStats: ProjectWithStats[]
  isLoading: boolean
} {
  const { projects, isLoading: projectsLoading } = useProjects()

  const runsQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['test-runs', p.id],
      queryFn: () => apiClient.getTestRuns(p.id),
      staleTime: 30_000,
    })),
  })

  const projectsWithStats: ProjectWithStats[] = projects.map((project, i) => {
    const q = runsQueries[i]
    const runs = q?.data ?? []
    const lastRun = runs[0] ?? null
    const completed = runs.filter(
      (r) => r.status === 'passed' || r.status === 'failed'
    )
    const totalTests = completed.reduce((s, r) => s + r.total_tests, 0)
    const totalPassed = completed.reduce((s, r) => s + r.passed_tests, 0)
    const passRate =
      totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : null
    return {
      project,
      lastRun,
      passRate,
      totalRuns: runs.length,
      runsLoading: q?.isLoading ?? false,
    }
  })

  return {
    projectsWithStats,
    isLoading: projectsLoading,
  }
}

export function useProject(id: string) {
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['projects', id],
    queryFn: () => apiClient.getProject(id),
    enabled: !!id,
  })

  return { project, isLoading, error }
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateProjectInput) => apiClient.createProject(input),
    onSuccess: (newProject: Project) => {
      queryClient.setQueryData<Project[]>(['projects'], (old = []) => [newProject, ...old])
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateProjectInput> }) =>
      apiClient.updateProject(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.id] })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
