import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { opsFetch } from "./api"
import type {
  ComponentDeployment,
  Intervention,
  OpsDatabase,
  Rollout,
  Site,
  SystemDeployment,
  Workbench,
} from "./types"

interface SuccessResponse<T> {
  success: boolean
  data: T
}

const POLL_INTERVAL = 60_000

function buildQs(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `?${s}` : ""
}

function listHook<T>(
  entity: string,
  opts?: Record<string, string | undefined>
) {
  const qs = buildQs({ ...opts, limit: "500" })
  return {
    queryKey: ["ops", entity, opts],
    queryFn: async () => {
      const res = await opsFetch<SuccessResponse<T[]>>(`/${entity}${qs}`)
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  }
}

function detailHook<T>(entity: string, slugOrId: string | undefined) {
  return {
    queryKey: ["ops", entity, slugOrId],
    queryFn: async () => {
      const res = await opsFetch<SuccessResponse<T>>(`/${entity}/${slugOrId}`)
      return res.data
    },
    enabled: !!slugOrId,
    refetchInterval: POLL_INTERVAL,
  }
}

// ── Sites ──────────────────────────────────────────

export function useOpsSites(opts?: { type?: string }) {
  return useQuery<Site[]>(listHook("sites", opts))
}

export function useOpsSite(slugOrId: string | undefined) {
  return useQuery<Site | null>(detailHook("sites", slugOrId))
}

// ── System Deployments ─────────────────────────────

export function useSystemDeployments(opts?: {
  type?: string
  siteId?: string
}) {
  return useQuery<SystemDeployment[]>(listHook("system-deployments", opts))
}

export function useSystemDeployment(slugOrId: string | undefined) {
  return useQuery<SystemDeployment | null>(
    detailHook("system-deployments", slugOrId)
  )
}

// ── Component Deployments ──────────────────────────

export function useComponentDeployments(opts?: {
  systemDeploymentId?: string
}) {
  return useQuery<ComponentDeployment[]>(
    listHook("component-deployments", opts)
  )
}

export function useComponentDeployment(id: string | undefined) {
  return useQuery<ComponentDeployment | null>(
    detailHook("component-deployments", id)
  )
}

// ── Workbenches ────────────────────────────────────

export function useWorkbenches(opts?: { type?: string; siteId?: string }) {
  return useQuery<Workbench[]>(listHook("workbenches", opts))
}

export function useWorkbench(slugOrId: string | undefined) {
  return useQuery<Workbench | null>(detailHook("workbenches", slugOrId))
}

// ── Rollouts ───────────────────────────────────────

export function useRollouts(opts?: { systemDeploymentId?: string }) {
  return useQuery<Rollout[]>(listHook("rollouts", opts))
}

export function useRollout(id: string | undefined) {
  return useQuery<Rollout | null>(detailHook("rollouts", id))
}

// ── Interventions ──────────────────────────────────

export function useInterventions(opts?: {
  systemDeploymentId?: string
  type?: string
}) {
  return useQuery<Intervention[]>(listHook("interventions", opts))
}

export function useIntervention(id: string | undefined) {
  return useQuery<Intervention | null>(detailHook("interventions", id))
}

// ── Databases ──────────────────────────────────────

export function useDatabases(opts?: { systemDeploymentId?: string }) {
  return useQuery<OpsDatabase[]>(listHook("databases", opts))
}

export function useDatabase(slugOrId: string | undefined) {
  return useQuery<OpsDatabase | null>(detailHook("databases", slugOrId))
}

// ── Actions ────────────────────────────────────────

export function useOpsAction(
  entityPath: string,
  slugOrId: string,
  action: string
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body?: Record<string, unknown>) => {
      const res = await opsFetch<SuccessResponse<unknown>>(
        `/${entityPath}/${slugOrId}/actions/${action}`,
        { method: "POST", body: body ? JSON.stringify(body) : undefined }
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops", entityPath] })
    },
  })
}
