import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background text-foreground">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
            {this.state.error.message}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.href = '/'
            }}
          >
            Reload app
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
