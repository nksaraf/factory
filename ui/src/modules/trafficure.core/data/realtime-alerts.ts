import { Client } from "@stomp/stompjs"
import { useEffect, useRef, useState } from "react"

import { useCurrentOrganization } from "@rio.js/auth-ui/hooks/use-current-organization"
import { useQueryClient } from "@rio.js/client"
import { useRio } from "@rio.js/client"

/**
 * Hook to set up real-time alerts connection using STOMP over WebSocket
 * This subscribes to /topic/alerts and invalidates the React Query cache
 * when new alerts are received
 */
export function useRealtimeAlerts() {
  const rio = useRio()
  const queryClient = useQueryClient()
  const clientRef = useRef<Client | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const { data: activeOrganization } = useCurrentOrganization()

  useEffect(() => {
    // Get WebSocket URL from environment
    const wsUrl = rio.env.PUBLIC_WEBSOCKET_URL || ""

    // Only set up connection if URL is configured
    if (!wsUrl) {
      console.warn(
        "WebSocket URL not configured. Real-time alerts will not work."
      )
      return
    }

    let reconnectAttempts = 0
    const maxReconnectAttempts = 10
    const reconnectDelay = 5000 // 5 seconds

    const connect = () => {
      try {
        // Create STOMP client
        const client = new Client({
          brokerURL: "wss://api.traffic.management.rio.software/ws",
          reconnectDelay: reconnectDelay,
          heartbeatIncoming: 4000,
          heartbeatOutgoing: 4000,
          onConnect: () => {
            console.log("Connected to STOMP WebSocket for real-time alerts")
            setIsConnected(true)
            reconnectAttempts = 0

            // Subscribe to /topic/alerts
            const subscription = client.subscribe(
              `/topic/${activeOrganization?.id}/alerts`,
              (message) => {
                try {
                  const data = JSON.parse(message.body)
                  console.log("Received alert update:", data)

                  // Invalidate the alerts query to trigger a refetch
                  queryClient.invalidateQueries({
                    queryKey: ["alerts", "active"],
                  })
                } catch (error) {
                  // If not JSON, treat as plain text
                  console.log("Received message:", message.body)
                  // Still invalidate to refresh alerts
                  queryClient.invalidateQueries({
                    queryKey: ["alerts", "active"],
                  })
                }
              }
            )

            console.log("Subscribed to /topic/alerts")
          },
          onStompError: (frame) => {
            console.error("STOMP error:", frame)
            setIsConnected(false)
          },
          onWebSocketError: (error) => {
            console.error("WebSocket error:", error)
            setIsConnected(false)
          },
          onDisconnect: () => {
            console.log("STOMP WebSocket connection closed")
            setIsConnected(false)

            // Attempt to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
              reconnectAttempts++
              console.log(
                `Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`
              )
              reconnectTimeoutRef.current = setTimeout(() => {
                connect()
              }, reconnectDelay)
            } else {
              console.error(
                "Max reconnection attempts reached. Stopping reconnection."
              )
            }
          },
        })

        // Activate the client
        client.activate()
        clientRef.current = client
      } catch (error) {
        console.error("Failed to create STOMP WebSocket connection:", error)
        setIsConnected(false)
      }
    }

    // Initial connection
    connect()

    // Cleanup function
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (clientRef.current) {
        clientRef.current.deactivate()
        clientRef.current = null
      }
      setIsConnected(false)
    }
  }, [rio, queryClient])

  return {
    isConnected,
  }
}
