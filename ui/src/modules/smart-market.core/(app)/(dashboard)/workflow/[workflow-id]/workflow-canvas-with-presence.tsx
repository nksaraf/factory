"use client"

import { useReactFlow } from "@xyflow/react"
import { useEffect, useRef } from "react"
import {
  PresenceCursor,
  PresenceLabel,
  useCursors,
  usePresence,
  usePresenceActions,
  useTextLabels,
} from "~/src/components/presence"

/**
 * Component that renders presence cursors and labels over the workflow canvas
 */
export function WorkflowCanvasWithPresence() {
  const { isConnected, userId } = usePresence()
  const cursors = useCursors()
  const textLabels = useTextLabels()
  const { updateCursor } = usePresenceActions()
  const containerRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, getViewport } = useReactFlow()

  // Track mouse movements on the canvas
  useEffect(() => {
    if (!isConnected || !containerRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      try {
        // Convert screen coordinates to flow coordinates
        const flowPosition = screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        })

        // Update cursor position
        updateCursor(flowPosition.x, flowPosition.y)
      } catch (error) {
        // Silently handle errors (e.g., if ReactFlow is not ready)
        console.debug("[presence] Error updating cursor:", error)
      }
    }

    // const container = containerRef.current
    window.addEventListener("mousemove", handleMouseMove)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
    }
  }, [isConnected, screenToFlowPosition, updateCursor])

  return (
    <>
      {/* Render presence cursors */}
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 z-50"
      >
        {Object.entries(cursors).map(([id, cursor]) => {
          // Only render other users' cursors (not our own)
          if (id === userId) return null

          try {
            // Convert flow coordinates back to screen coordinates for rendering
            const viewport = getViewport()
            const screenX = cursor.x * viewport.zoom + viewport.x
            const screenY = cursor.y * viewport.zoom + viewport.y

            return (
              <PresenceCursor
                key={id}
                cursor={{
                  ...cursor,
                  x: screenX,
                  y: screenY,
                }}
              />
            )
          } catch (error) {
            // Silently handle errors if ReactFlow is not ready
            return null
          }
        })}

        {/* Render text labels */}
        {/* {textLabels.map((label) => {
          try {
            const viewport = getViewport()
            const screenX = label.x * viewport.zoom + viewport.x
            const screenY = label.y * viewport.zoom + viewport.y

            return (
              <PresenceLabel
                key={label.id}
                label={{
                  ...label,
                  x: screenX,
                  y: screenY,
                }}
              />
            )
          } catch (error) {
            return null
          }
        })} */}
      </div>
    </>
  )
}
