import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/stores/app-store'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, authChecked, checkAuth } = useAppStore()
  const location = useLocation()

  useEffect(() => {
    if (!authChecked) {
      checkAuth()
    }
  }, [authChecked, checkAuth])

  if (!authChecked) {
    // Show a minimal loading state while checking auth
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
