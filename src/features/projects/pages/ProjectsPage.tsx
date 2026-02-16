import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ProjectsList } from '../components/ProjectsList'
import { ProjectDetail } from '../components/ProjectDetail'
import { SetupWizard } from '../components/SetupWizard'

export function ProjectsPage() {
  const [showWizard, setShowWizard] = useState(false)

  return (
    <Routes>
      <Route
        index
        element={
          showWizard ? (
            <SetupWizard onClose={() => setShowWizard(false)} />
          ) : (
            <ProjectsList onNewProject={() => setShowWizard(true)} />
          )
        }
      />
      <Route path=":projectId" element={<ProjectDetail />} />
    </Routes>
  )
}
