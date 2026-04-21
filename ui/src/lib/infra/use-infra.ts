import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { infraFetch } from "./api"
import type {
  DnsDomain,
  Estate,
  Host,
  IpAddress,
  Realm,
  Route,
  Secret,
  Service,
  Tunnel,
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
    queryKey: ["infra", entity, opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<T[]>>(`/${entity}${qs}`)
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  }
}

function detailHook<T>(entity: string, slugOrId: string | undefined) {
  return {
    queryKey: ["infra", entity, slugOrId],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<T>>(`/${entity}/${slugOrId}`)
      return res.data
    },
    enabled: !!slugOrId,
    refetchInterval: POLL_INTERVAL,
  }
}

// ── Estates ─────────────────────────────────────────

export function useEstates(opts?: { type?: string }) {
  return useQuery<Estate[]>(listHook("estates", opts))
}

export function useEstate(slugOrId: string | undefined) {
  return useQuery<Estate | null>(detailHook("estates", slugOrId))
}

// ── Hosts ───────────────────────────────────────────

export function useHosts(opts?: { type?: string; estateId?: string }) {
  return useQuery<Host[]>(listHook("hosts", opts))
}

export function useHost(slugOrId: string | undefined) {
  return useQuery<Host | null>(detailHook("hosts", slugOrId))
}

// ── Realms ──────────────────────────────────────────

export function useRealms(opts?: { type?: string; estateId?: string }) {
  return useQuery<Realm[]>(listHook("realms", opts))
}

export function useRealm(slugOrId: string | undefined) {
  return useQuery<Realm | null>(detailHook("realms", slugOrId))
}

// ── Services ────────────────────────────────────────

export function useServices(opts?: { type?: string }) {
  return useQuery<Service[]>(listHook("services", opts))
}

export function useService(slugOrId: string | undefined) {
  return useQuery<Service | null>(detailHook("services", slugOrId))
}

// ── Routes ──────────────────────────────────────────

export function useRoutes(opts?: { type?: string; realmId?: string }) {
  return useQuery<Route[]>(listHook("routes", opts))
}

export function useRoute(slugOrId: string | undefined) {
  return useQuery<Route | null>(detailHook("routes", slugOrId))
}

// ── DNS Domains ─────────────────────────────────────

export function useDnsDomains(opts?: { type?: string }) {
  return useQuery<DnsDomain[]>(listHook("dns-domains", opts))
}

export function useDnsDomain(slugOrId: string | undefined) {
  return useQuery<DnsDomain | null>(detailHook("dns-domains", slugOrId))
}

// ── Tunnels ─────────────────────────────────────────

export function useTunnels(opts?: { phase?: string }) {
  return useQuery<Tunnel[]>(listHook("tunnels", opts))
}

export function useTunnel(slugOrId: string | undefined) {
  return useQuery<Tunnel | null>(detailHook("tunnels", slugOrId))
}

// ── IP Addresses ────────────────────────────────────

export function useIpAddresses(opts?: {
  subnetId?: string
  status?: string
  assignedToKind?: string
}) {
  return useQuery<IpAddress[]>(listHook("ip-addresses", opts))
}

export function useIpAddress(slugOrId: string | undefined) {
  return useQuery<IpAddress | null>(detailHook("ip-addresses", slugOrId))
}

// ── Secrets ─────────────────────────────────────────

export function useSecrets() {
  return useQuery<Secret[]>(listHook("secrets"))
}

export function useSecret(slugOrId: string | undefined) {
  return useQuery<Secret | null>(detailHook("secrets", slugOrId))
}

// ── Assets (cross-type summary) ─────────────────────

export function useInfraAssets() {
  return useQuery({
    queryKey: ["infra", "assets"],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<unknown[]>>("/assets")
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// ── Actions ─────────────────────────────────────────

export function useInfraAction(
  entityPath: string,
  slugOrId: string,
  action: string
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body?: Record<string, unknown>) => {
      const res = await infraFetch<SuccessResponse<unknown>>(
        `/${entityPath}/${slugOrId}/actions/${action}`,
        { method: "POST", body: body ? JSON.stringify(body) : undefined }
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["infra", entityPath] })
    },
  })
}
