import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'

interface UseWebSocketOptions<T> {
  /** Type of job: 'scan' | 'run' */
  jobType: string
  /** Job/run ID to subscribe to */
  jobId: string | null
  /** Whether the hook is active */
  enabled: boolean
  /** Called on each WS message */
  onMessage: (data: T) => void
  /** Polling fallback function (called when WS fails) */
  pollFn: () => Promise<T>
  /** Polling interval in ms (default 2000) */
  pollIntervalMs?: number
}

interface UseWebSocketResult {
  connected: boolean
  fallbackPolling: boolean
}

export function useWebSocket<T>({
  jobType,
  jobId,
  enabled,
  onMessage,
  pollFn,
  pollIntervalMs = 2000,
}: UseWebSocketOptions<T>): UseWebSocketResult {
  const [connected, setConnected] = useState(false)
  const [fallbackPolling, setFallbackPolling] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<number | null>(null)
  const onMessageRef = useRef(onMessage)
  const pollFnRef = useRef(pollFn)

  // Keep refs up to date without triggering reconnect
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])
  useEffect(() => {
    pollFnRef.current = pollFn
  }, [pollFn])

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setConnected(false)
    setFallbackPolling(false)
  }, [])

  const startPolling = useCallback(() => {
    if (pollRef.current) return
    setFallbackPolling(true)

    const poll = async () => {
      try {
        const data = await pollFnRef.current()
        onMessageRef.current(data)
      } catch {
        // Ignore transient polling errors
      }
    }

    // Immediate first poll
    poll()
    pollRef.current = window.setInterval(poll, pollIntervalMs)
  }, [pollIntervalMs])

  useEffect(() => {
    if (!enabled || !jobId) {
      cleanup()
      return
    }

    // Build WS URL from backend URL
    const baseUrl = useAppStore.getState().backendUrl || 'http://localhost:8000'
    const wsUrl = baseUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')

    try {
      const ws = new WebSocket(`${wsUrl}/ws/progress/${jobType}/${jobId}`)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setFallbackPolling(false)
        // Clear any polling that might have started
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as T
          onMessageRef.current(data)
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onerror = () => {
        // Fall back to polling
        ws.close()
        wsRef.current = null
        setConnected(false)
        startPolling()
      }

      ws.onclose = () => {
        wsRef.current = null
        setConnected(false)
        // Only start polling if still enabled (not a clean shutdown)
        if (enabled && jobId) {
          startPolling()
        }
      }
    } catch {
      // WebSocket constructor failed — fall back to polling
      startPolling()
    }

    return cleanup
  }, [enabled, jobId, jobType, cleanup, startPolling])

  return { connected, fallbackPolling }
}
