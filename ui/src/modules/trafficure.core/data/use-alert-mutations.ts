import { useMutation, useQueryClient } from "@tanstack/react-query"
import { use } from "react"

import { AuthUIContext } from "@rio.js/auth-ui/lib/auth-ui-context"
import { env } from "@rio.js/env"

export interface AlertFeedback {
  type: "dismiss" | "good"
  feedbackText?: string
  timestamp: string
  userId?: string
}

export interface AlertMetadata {
  feedbacks?: AlertFeedback[]
  primaryFeedback?: AlertFeedback
}

/**
 * Hook to dismiss an alert by updating the metadata column
 */
export function useDismissAlert() {
  const {
    hooks: { useActiveOrganization, useSession },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      alertId,
      feedbackText,
    }: {
      alertId: number
      feedbackText?: string
    }) => {
      if (!activeOrganization?.id) {
        throw new Error("No active organization")
      }

      const userId = session?.user?.id

      // Build the URL for the PostgREST endpoint
      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/alert`
      )
      url.searchParams.set("alert_id", `eq.${alertId}`)

      // Fetch current alert to get existing metadata
      const getResponse = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
        method: "GET",
      })

      if (!getResponse.ok) {
        throw new Error("Failed to fetch alert")
      }

      const existingAlerts = await getResponse.json()
      if (!existingAlerts || existingAlerts.length === 0) {
        throw new Error("Alert not found")
      }

      const existingAlert = existingAlerts[0]
      const existingMetadata: AlertMetadata = existingAlert.metadata || {}
      const existingFeedbacks = existingMetadata.feedbacks || []

      // Create new feedback entry
      const newFeedback: AlertFeedback = {
        type: "dismiss",
        feedbackText: feedbackText || undefined,
        timestamp: new Date().toISOString(),
        userId,
      }

      // Append new feedback to the list
      const updatedFeedbacks = [...existingFeedbacks, newFeedback]

      // Update metadata with new feedback list and set as primary
      const updatedMetadata: AlertMetadata = {
        feedbacks: updatedFeedbacks,
        primaryFeedback: newFeedback,
      }

      // PATCH the alert with updated metadata
      const patchUrl = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/alert`
      )
      patchUrl.searchParams.set("alert_id", `eq.${alertId}`)

      const patchResponse = await fetch(patchUrl.toString(), {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation",
        },
        method: "PATCH",
        body: JSON.stringify({
          metadata: updatedMetadata,
        }),
      })

      if (!patchResponse.ok) {
        throw new Error("Failed to dismiss alert")
      }

      return patchResponse.json()
    },
    onSuccess: () => {
      // Invalidate alerts query to refresh the list
      if (activeOrganization?.id) {
        queryClient.invalidateQueries({
          queryKey: [activeOrganization.id, "alerts", "active"],
        })
      }
      queryClient.invalidateQueries({ queryKey: ["alerts", "active"] })
    },
  })
}

/**
 * Hook to mark an alert as good by updating the metadata column
 */
export function useMarkGoodAlert() {
  const {
    hooks: { useActiveOrganization, useSession },
  } = use(AuthUIContext)
  const { data: activeOrganization } = useActiveOrganization()
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      alertId,
      feedbackText,
    }: {
      alertId: number
      feedbackText?: string
    }) => {
      if (!activeOrganization?.id) {
        throw new Error("No active organization")
      }

      const userId = session?.user?.id

      // Build the URL for the PostgREST endpoint
      const url = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/alert`
      )
      url.searchParams.set("alert_id", `eq.${alertId}`)

      // Fetch current alert to get existing metadata
      const getResponse = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
        method: "GET",
      })

      if (!getResponse.ok) {
        throw new Error("Failed to fetch alert")
      }

      const existingAlerts = await getResponse.json()
      if (!existingAlerts || existingAlerts.length === 0) {
        throw new Error("Alert not found")
      }

      const existingAlert = existingAlerts[0]
      const existingMetadata: AlertMetadata = existingAlert.metadata || {}
      const existingFeedbacks = existingMetadata.feedbacks || []

      // Create new feedback entry
      const newFeedback: AlertFeedback = {
        type: "good",
        feedbackText: feedbackText || undefined,
        timestamp: new Date().toISOString(),
        userId,
      }

      // Append new feedback to the list
      const updatedFeedbacks = [...existingFeedbacks, newFeedback]

      // Update metadata with new feedback list and set as primary
      const updatedMetadata: AlertMetadata = {
        feedbacks: updatedFeedbacks,
        primaryFeedback: newFeedback,
      }

      // PATCH the alert with updated metadata
      const patchUrl = new URL(
        `${env.PUBLIC_TRAFFICURE_API_BASE_URL}/api/internal/crud/alert`
      )
      patchUrl.searchParams.set("alert_id", `eq.${alertId}`)

      const patchResponse = await fetch(patchUrl.toString(), {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation",
        },
        method: "PATCH",
        body: JSON.stringify({
          metadata: updatedMetadata,
        }),
      })

      if (!patchResponse.ok) {
        throw new Error("Failed to mark alert as good")
      }

      return patchResponse.json()
    },
    onSuccess: () => {
      // Invalidate alerts query to refresh the list
      if (activeOrganization?.id) {
        queryClient.invalidateQueries({
          queryKey: [activeOrganization.id, "alerts", "active"],
        })
      }
      queryClient.invalidateQueries({ queryKey: ["alerts", "active"] })
    },
  })
}
