import { useParams } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Play, Settings, FileText, Activity } from 'lucide-react'
import { useProject } from '../hooks/useProjects'

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { project, isLoading } = useProject(projectId!)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-lg font-semibold">Project not found</h2>
        <p className="text-muted-foreground">
          The project you're looking for doesn't exist.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground">
            {project.description || 'No description'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline">{project.path}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Settings className="mr-2 h-4 w-4" />
            Configure
          </Button>
          <Button>
            <Play className="mr-2 h-4 w-4" />
            Run Tests
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="mr-2 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="tests">
            <FileText className="mr-2 h-4 w-4" />
            Tests
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="mr-2 h-4 w-4" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Frontend Tests</CardTitle>
                <CardDescription>Playwright E2E tests</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">0</p>
                <p className="text-sm text-muted-foreground">tests configured</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Backend Tests</CardTitle>
                <CardDescription>API integration tests</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">0</p>
                <p className="text-sm text-muted-foreground">endpoints tested</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Database Tests</CardTitle>
                <CardDescription>Schema and query tests</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">0</p>
                <p className="text-sm text-muted-foreground">queries validated</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tests" className="mt-6">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-16 w-16 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No tests yet</h3>
              <p className="mt-2 text-center text-muted-foreground">
                Use the AI Assistant to generate tests or create them manually.
              </p>
              <Button className="mt-4">Generate Tests with AI</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Project Configuration</CardTitle>
              <CardDescription>
                Configure URLs and connection settings for this project
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Frontend URL</label>
                  <p className="text-muted-foreground">
                    {project.config?.frontendUrl || 'Not configured'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Backend URL</label>
                  <p className="text-muted-foreground">
                    {project.config?.backendUrl || 'Not configured'}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Database URL</label>
                  <p className="text-muted-foreground">
                    {project.config?.databaseUrl || 'Not configured'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
