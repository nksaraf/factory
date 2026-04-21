import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
  BillableMetric,
  Customer,
  EntitlementBundle,
  Plan,
  Subscription,
} from "./types"
import { commerceFetch } from "./api"

interface SuccessResponse<T> {
  data: T
  meta?: { total: number; limit: number; offset: number }
}

function useCommerceList<T>(entity: string, opts?: Record<string, string>) {
  const qs = opts
    ? "?" +
      Object.entries(opts)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&")
    : ""
  return useQuery<T[]>({
    queryKey: ["commerce", entity, opts],
    queryFn: async () => {
      const res = await commerceFetch<SuccessResponse<T[]>>(`/${entity}${qs}`)
      return res.data
    },
    refetchInterval: 60_000,
  })
}

function useCommerceOne<T>(entity: string, slugOrId: string | undefined) {
  return useQuery<T | null>({
    queryKey: ["commerce", entity, slugOrId],
    queryFn: async () => {
      if (!slugOrId) return null
      const res = await commerceFetch<SuccessResponse<T>>(
        `/${entity}/${slugOrId}`
      )
      return res.data
    },
    enabled: !!slugOrId,
  })
}

function useCommerceRelation<T>(
  entity: string,
  slugOrId: string | undefined,
  relation: string
) {
  return useQuery<T[]>({
    queryKey: ["commerce", entity, slugOrId, relation],
    queryFn: async () => {
      if (!slugOrId) return []
      const res = await commerceFetch<SuccessResponse<T[]>>(
        `/${entity}/${slugOrId}/${relation}`
      )
      return res.data
    },
    enabled: !!slugOrId,
  })
}

export function useCustomers() {
  return useCommerceList<Customer>("customers")
}

export function useCustomer(slug: string | undefined) {
  return useCommerceOne<Customer>("customers", slug)
}

export function usePlans() {
  return useCommerceList<Plan>("plans")
}

export function usePlan(slug: string | undefined) {
  return useCommerceOne<Plan>("plans", slug)
}

export function useSubscriptions(opts?: { customerId?: string }) {
  return useCommerceList<Subscription>(
    "subscriptions",
    opts?.customerId ? { customerId: opts.customerId } : undefined
  )
}

export function useSubscription(id: string | undefined) {
  return useCommerceOne<Subscription>("subscriptions", id)
}

export function useCustomerSubscriptions(customerId: string | undefined) {
  return useCommerceRelation<Subscription>(
    "customers",
    customerId,
    "subscriptions"
  )
}

export function useCustomerBundles(customerId: string | undefined) {
  return useCommerceRelation<EntitlementBundle>(
    "customers",
    customerId,
    "bundles"
  )
}

export function useBillableMetrics() {
  return useCommerceList<BillableMetric>("billable-metrics")
}

export function useCommerceAction(
  entity: string,
  slugOrId: string,
  action: string
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body?: Record<string, unknown>) => {
      const res = await commerceFetch<{ data: unknown; action: string }>(
        `/${entity}/${slugOrId}/${action}`,
        { method: "POST", body: JSON.stringify(body ?? {}) }
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commerce", entity] })
    },
  })
}
