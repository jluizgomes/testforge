import { useEffect, useRef, useState, useCallback } from 'react'
import { apiClient } from '@/services/api-client'

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
  /**
   * Optional predicate: given a message, returns true if the job is
   * in a terminal state and polling should stop automatically.
   */
  isTerminal?: (data: T) => boolean
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
  isTerminal,
}: UseWebSocketOptions<T>): UseWebSocketResult {
  const [connected, setConnected] = useState(false)
  const [fallbackPolling, setFallbackPolling] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<number | null>(null)
  const onMessageRef = useRef(onMessage)
  const pollFnRef = useRef(pollFn)
  const isTerminalRef = useRef(isTerminal)

  // Keep refs up to date without triggering reconnect
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])
  useEffect(() => {
    pollFnRef.current = pollFn
  }, [pollFn])
  useEffect(() => {
    isTerminalRef.current = isTerminal
  }, [isTerminal])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setFallbackPolling(false)
  }, [])

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    stopPolling()
    setConnected(false)
  }, [stopPolling])

  const startPolling = useCallback(() => {
    if (pollRef.current) return
    setFallbackPolling(true)

    const poll = async () => {
      try {
        const data = await pollFnRef.current()
        onMessageRef.current(data)
        // Stop polling automatically on terminal state
        if (isTerminalRef.current?.(data)) {
          stopPolling()
        }
      } catch {
        // Ignore transient polling errors
      }
    }

    // Immediate first poll
    poll()
    pollRef.current = window.setInterval(poll, pollIntervalMs)
  }, [pollIntervalMs, stopPolling])

  useEffect(() => {
    if (!enabled || !jobId) {
      cleanup()
      return
    }

    // Build WS URL from backend URL (use apiClient to get same 8000→8001 redirect in dev)
    const baseUrl = apiClient.getBaseUrl() || 'http://localhost:8001'
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
