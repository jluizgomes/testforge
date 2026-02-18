import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  FolderOpen,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  Search,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpDown,
  TrendingUp,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useProjectsWithStats,
  useDeleteProject,
  useUpdateProject,
} from '../hooks/useProjects'
import { useAppStore } from '@/stores/app-store'
import { apiClient } from '@/services/api-client'
import { formatDate } from '@/lib/utils'
import type { Project } from '@/services/api-client'

interface ProjectsListProps {
  onNewProject: () => void
}

type SortField = 'name' | 'updated_at' | 'created_at'
type SortDir = 'asc' | 'desc'

export function ProjectsList({ onNewProject }: ProjectsListProps) {
  const { projectsWithStats, isLoading } = useProjectsWithStats()
  const deleteProject = useDeleteProject()
  const updateProject = useUpdateProject()
  const setCurrentProject = useAppStore((s) => s.setCurrentProject)
  const navigate = useNavigate()

  // Search + sort state
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<Project | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

  // Quick-run state
  const [startingRun, setStartingRun] = useState<string | null>(null)

  const openEdit = (project: Project) => {
    setEditTarget(project)
    setEditName(project.name)
    setEditDescription(project.description ?? '')
  }

  const handleEdit = async () => {
    if (!editTarget) return
    await updateProject.mutateAsync({
      id: editTarget.id,
      data: {
        name: editName.trim() || editTarget.name,
        description: editDescription.trim() || undefined,
      },
    })
    setEditTarget(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteProject.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  const handleQuickRun = async (project: Project) => {
    setStartingRun(project.id)
    try {
      setCurrentProject(project)
      await apiClient.startTestRun(project.id)
      navigate('/test-runner')
    } catch {
      // Navigate anyway so user can see the runner
      navigate('/test-runner')
    } finally {
      setStartingRun(null)
    }
  }

  // Filtered + sorted list
  const filtered = projectsWithStats
    .filter((ps) => {
      const q = search.toLowerCase()
      return (
        ps.project.name.toLowerCase().includes(q) ||
        (ps.project.description ?? '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortBy === 'name') return dir * a.project.name.localeCompare(b.project.name)
      return (
        dir *
        (new Date(a.project[sortBy]).getTime() - new Date(b.project[sortBy]).getTime())
      )
    })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Manage your test projects and configurations
          </p>
        </div>
        <Button onClick={onNewProject}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Search + Sort bar */}
      {(projectsWithStats.length > 0 || search) && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_at">Recently Updated</SelectItem>
              <SelectItem value="created_at">Date Created</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Projects Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 w-32 rounded bg-muted" />
                <div className="h-4 w-48 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-4 w-24 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 && search ? (
        <Card className="flex flex-col items-center justify-center p-12">
          <Search className="h-12 w-12 text-muted-foreground opacity-30" />
          <h3 className="mt-4 text-lg font-semibold">No results for "{search}"</h3>
          <p className="mt-2 text-center text-muted-foreground text-sm">
            Try a different search term.
          </p>
        </Card>
      ) : projectsWithStats.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12">
          <FolderOpen className="h-16 w-16 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No projects yet</h3>
          <p className="mt-2 text-center text-muted-foreground">
            Get started by creating your first project to begin testing.
          </p>
          <Button className="mt-4" onClick={onNewProject}>
            <Plus className="mr-2 h-4 w-4" />
            Create Project
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ project, lastRun, passRate, totalRuns, runsLoading }) => (
            <Card
              key={project.id}
              className="group relative transition-shadow hover:shadow-md"
            >
              {/* Status stripe */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                  !lastRun
                    ? 'bg-muted'
                    : lastRun.status === 'passed'
                      ? 'bg-green-500'
                      : lastRun.status === 'failed'
                        ? 'bg-red-500'
                        : 'bg-yellow-500'
                }`}
              />
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pl-5">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg truncate">
                    <Link
                      to={`/projects/${project.id}`}
                      className="hover:underline"
                    >
                      {project.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="mt-1 line-clamp-1">
                    {project.description || 'No description'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Quick Run button — visible on hover */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Quick Run"
                    disabled={startingRun === project.id}
                    onClick={() => handleQuickRun(project)}
                  >
                    {startingRun === project.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(project)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(project)}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>

              <CardContent className="pl-5 space-y-3">
                {/* Path */}
                <Badge variant="secondary" className="max-w-full truncate font-mono text-xs block">
                  {project.path}
                </Badge>

                {/* Stats row */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  {runsLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : lastRun ? (
                    <>
                      <div className="flex items-center gap-2">
                        {lastRun.status === 'passed' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        ) : lastRun.status === 'failed' ? (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-yellow-500" />
                        )}
                        <span className="capitalize">{lastRun.status}</span>
                        <span className="text-muted-foreground/60">·</span>
                        <span>{totalRuns} run{totalRuns !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        <span className={passRate !== null
                          ? passRate >= 80 ? 'text-green-600' : passRate >= 50 ? 'text-yellow-600' : 'text-red-600'
                          : ''
                        }>
                          {passRate !== null ? `${passRate}%` : '—'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="italic">No runs yet</span>
                      <span>{formatDate(project.updated_at)}</span>
                    </>
                  )}
                </div>
                {lastRun && (
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDate(project.updated_at)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update the project name and description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Project Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={updateProject.isPending}>
              {updateProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>{deleteTarget?.name}</strong>? This action cannot be
              undone. All test runs and data associated with this project will be
              removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteProject.isPending}
            >
              {deleteProject.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete Project'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
