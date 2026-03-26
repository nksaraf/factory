// ui/src/lib/infra/use-infra.ts
import { useQuery } from "@tanstack/react-query"

import { infraFetch } from "./api"
import type {
  Cluster,
  Datacenter,
  Host,
  IpAddress,
  KubeNode,
  Provider,
  ProxmoxCluster,
  Region,
  Subnet,
  VM,
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

// --- Providers ---

export function useProviders(opts?: { status?: string }) {
  return useQuery<Provider[]>({
    queryKey: ["infra", "providers", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Provider[]>>(
        `/providers${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useProvider(id: string | undefined) {
  return useQuery<Provider | null>({
    queryKey: ["infra", "provider", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Provider>>(
        `/providers/${id}`
      )
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Clusters ---

export function useClusters(opts?: { providerId?: string; status?: string }) {
  return useQuery<Cluster[]>({
    queryKey: ["infra", "clusters", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Cluster[]>>(
        `/clusters${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useCluster(id: string | undefined) {
  return useQuery<Cluster | null>({
    queryKey: ["infra", "cluster", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Cluster>>(
        `/clusters/${id}`
      )
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Regions ---

export function useRegions(opts?: { providerId?: string }) {
  return useQuery<Region[]>({
    queryKey: ["infra", "regions", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Region[]>>(
        `/regions${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Datacenters ---

export function useDatacenters(opts?: { regionId?: string }) {
  return useQuery<Datacenter[]>({
    queryKey: ["infra", "datacenters", opts],
    queryFn: async () => {
      // Datacenters don't have a direct list endpoint with filters in the API,
      // we use regions endpoint and filter by regionId
      const res = await infraFetch<SuccessResponse<Datacenter[]>>(
        `/regions/${opts?.regionId}`
      )
      return res.data
    },
    enabled: !!opts?.regionId,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Hosts ---

export function useHosts(opts?: {
  providerId?: string
  datacenterId?: string
  status?: string
  osType?: string
}) {
  return useQuery<Host[]>({
    queryKey: ["infra", "hosts", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Host[]>>(
        `/hosts${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useHost(id: string | undefined) {
  return useQuery<Host | null>({
    queryKey: ["infra", "host", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Host>>(`/hosts/${id}`)
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- VMs ---

export function useVMs(opts?: {
  providerId?: string
  status?: string
  hostId?: string
  clusterId?: string
  datacenterId?: string
  osType?: string
}) {
  return useQuery<VM[]>({
    queryKey: ["infra", "vms", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<VM[]>>(
        `/vms${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useVM(id: string | undefined) {
  return useQuery<VM | null>({
    queryKey: ["infra", "vm", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<VM>>(`/vms/${id}`)
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Kube Nodes ---

export function useKubeNodes(opts?: { clusterId?: string }) {
  return useQuery<KubeNode[]>({
    queryKey: ["infra", "kube-nodes", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<KubeNode[]>>(
        `/kube-nodes${buildQs(opts ?? {})}`
      )
      return res.data
    },
    enabled: !!opts?.clusterId,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Subnets ---

export function useSubnets(opts?: {
  datacenterId?: string
  subnetType?: string
}) {
  return useQuery<Subnet[]>({
    queryKey: ["infra", "subnets", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Subnet[]>>(
        `/subnets${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- IP Addresses ---

export function useIpAddresses(opts?: {
  subnetId?: string
  status?: string
  assignedToType?: string
}) {
  return useQuery<IpAddress[]>({
    queryKey: ["infra", "ips", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<IpAddress[]>>(
        `/ips${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Proxmox Clusters ---

export function useProxmoxClusters(opts?: { providerId?: string }) {
  return useQuery<ProxmoxCluster[]>({
    queryKey: ["infra", "proxmox-clusters", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<ProxmoxCluster[]>>(
        `/proxmox-clusters${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Assets (cross-type) ---

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
