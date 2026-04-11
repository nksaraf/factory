/**
 * usePresence — React hook for realtime presence awareness.
 *
 * Shows who else is viewing the same page/resource. Connects to the
 * Elysia /presence/ws WebSocket endpoint.
 *
 * Usage:
 *   const { users, isConnected } = usePresence("page:/ops/workloads")
 */
import { useCallback, useEffect, useRef, useState } from "react"

export interface PresenceUser {
  userId: string
  userName?: string
  joinedAt: number
}

interface UsePresenceOptions {
  /** WebSocket URL for the presence endpoint */
  wsUrl: string
  /** Current user ID */
  userId: string
  /** Current user display name */
  userName?: string
  /** Heartbeat interval in ms (default: 15000) */
  heartbeatInterval?: number
}

interface UsePresenceResult {
  /** Other users currently viewing this room (excludes self) */
  users: PresenceUser[]
  /** Whether the WebSocket is connected */
  isConnected: boolean
}

const DEFAULT_HEARTBEAT_MS = 15_000
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_BASE_DELAY_MS = 2_000

export function usePresence(
  room: string,
  options: UsePresenceOptions
): UsePresenceResult {
  const {
    wsUrl,
    userId,
    userName,
    heartbeatInterval = DEFAULT_HEARTBEAT_MS,
  } = options

  const [users, setUsers] = useState<PresenceUser[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectAttempts = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      reconnectAttempts.current = 0

      // Join the room
      ws.send(JSON.stringify({ type: "join", room, userId, userName }))

      // Start heartbeat
      heartbeatRef.current = setInterval(() => {
        ws.send(JSON.stringify({ type: "heartbeat", room, userId }))
      }, heartbeatInterval)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        switch (msg.type) {
          case "presence":
            // Full user list — filter out self
            setUsers(
              (msg.users as PresenceUser[]).filter((u) => u.userId !== userId)
            )
            break

          case "user_joined":
            if (msg.user.userId !== userId) {
              setUsers((prev) => {
                // Deduplicate
                const filtered = prev.filter(
                  (u) => u.userId !== msg.user.userId
                )
                return [...filtered, msg.user]
              })
            }
            break

          case "user_left":
            setUsers((prev) => prev.filter((u) => u.userId !== msg.userId))
            break
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }

      // Reconnect with exponential backoff
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts.current
        reconnectAttempts.current++
        reconnectTimer.current = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [wsUrl, room, userId, userName, heartbeatInterval])

  useEffect(() => {
    connect()

    return () => {
      // Send leave before disconnecting
      send({ type: "leave", room, userId })

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect, room, userId, send])

  return { users, isConnected }
}
