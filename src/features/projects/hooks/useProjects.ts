import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Project, type CreateProjectInput } from '@/services/api-client'

export function useProjects() {
  const { data: projects = [], isLoading, error, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.getProjects(),
    refetchOnMount: 'always',
  })

  return { projects, isLoading, error, refetch }
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
