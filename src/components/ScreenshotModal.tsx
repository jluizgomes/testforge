import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

interface ScreenshotModalProps {
  open: boolean
  onClose: () => void
  imageUrl: string
  testName: string
  testStatus?: string
  testLayer?: string
}

export function ScreenshotModal({
  open,
  onClose,
  imageUrl,
  testName,
  testStatus,
  testLayer,
}: ScreenshotModalProps) {
  const [zoom, setZoom] = useState(1)

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 4))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25))
  const handleReset = () => setZoom(1)

  const handleDownload = async () => {
    try {
      const res = await fetch(imageUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `screenshot-${testName.replace(/[^a-zA-Z0-9]/g, '_')}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(imageUrl, '_blank')
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom((z) => Math.min(Math.max(z + delta, 0.25), 4))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setZoom(1)
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <DialogTitle className="text-sm font-medium truncate">
                {testName}
              </DialogTitle>
              {testStatus && (
                <Badge
                  variant={testStatus === 'passed' ? 'success' : 'destructive'}
                  className="text-xs px-1 flex-shrink-0"
                >
                  {testStatus}
                </Badge>
              )}
              {testLayer && (
                <Badge variant="outline" className="text-xs px-1 flex-shrink-0">
                  {testLayer}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 ml-4">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleZoomOut}
                disabled={zoom <= 0.25}
                title="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <button
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-foreground min-w-[3rem] text-center"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleZoomIn}
                disabled={zoom >= 4}
                title="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleReset}
                title="Reset zoom"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleDownload}
              >
                <Download className="mr-1 h-3 w-3" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Image viewport */}
        <div
          className="flex-1 overflow-auto bg-zinc-950/80 flex items-center justify-center min-h-[400px] max-h-[75vh] cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
        >
          <img
            src={imageUrl}
            alt={`Screenshot: ${testName}`}
            className="transition-transform duration-150"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            draggable={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
