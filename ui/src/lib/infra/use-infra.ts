// ui/src/lib/infra/use-infra.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

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

function extractStatus(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null)
    return ((v as Record<string, unknown>).phase as string) ?? "unknown"
  return "unknown"
}

function flattenHost(r: Record<string, unknown>): Host {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  const statusObj = (r.status ?? {}) as Record<string, unknown>
  const lastScan = (statusObj.lastScan ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? spec.hostname ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    hostname: (spec.hostname ?? r.hostname ?? null) as string | null,
    hostType: (r.type ?? "unknown") as string,
    providerId: (r.providerId ?? r.provider_id ?? "") as string,
    datacenterId: (r.datacenterId ?? r.datacenter_id ?? null) as string | null,
    ipAddress: (spec.ipAddress ?? r.ipAddress ?? r.ip_address ?? null) as
      | string
      | null,
    ipmiAddress: (spec.ipmiAddress ?? r.ipmiAddress ?? null) as string | null,
    status: (spec.lifecycle as string) ?? extractStatus(r.status),
    osType: (spec.os ?? r.osType ?? r.os_type ?? "") as string,
    accessMethod: (spec.accessMethod ?? r.accessMethod ?? "") as string,
    cpuCores: (spec.cpu ??
      spec.cpuCores ??
      r.cpuCores ??
      r.cpu_cores ??
      0) as number,
    memoryMb: (spec.memoryMb ?? r.memoryMb ?? r.memory_mb ?? 0) as number,
    diskGb: (spec.diskGb ?? r.diskGb ?? r.disk_gb ?? 0) as number,
    rackLocation: (spec.rackLocation ?? r.rackLocation ?? null) as
      | string
      | null,
    createdAt: (r.createdAt ?? r.created_at ?? "") as string,
  }
}

function flattenProvider(r: Record<string, unknown>): Provider {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    providerType: (spec.providerType ??
      r.providerType ??
      r.type ??
      "") as string,
    url: (spec.url ?? r.url ?? null) as string | null,
    status: extractStatus(r.status),
    providerKind: (spec.providerKind ??
      r.providerKind ??
      r.type ??
      "") as string,
    createdAt: (r.createdAt ?? r.created_at ?? "") as string,
  }
}

function flattenCluster(r: Record<string, unknown>): Cluster {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    providerId: (r.providerId ?? r.provider_id ?? "") as string,
    status: extractStatus(r.status),
    kubeconfigRef: (spec.kubeconfigRef ?? r.kubeconfigRef ?? null) as
      | string
      | null,
    createdAt: (r.createdAt ?? r.created_at ?? "") as string,
  }
}

function flattenVM(r: Record<string, unknown>): VM {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? spec.hostname ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    providerId: (r.providerId ?? r.provider_id ?? "") as string,
    datacenterId: (r.datacenterId ?? r.datacenter_id ?? null) as string | null,
    hostId: (r.hostId ?? r.host_id ?? null) as string | null,
    clusterId: (r.clusterId ?? r.cluster_id ?? null) as string | null,
    proxmoxClusterId: (r.proxmoxClusterId ?? r.proxmox_cluster_id ?? null) as
      | string
      | null,
    proxmoxVmid: (spec.proxmoxVmid ?? r.proxmoxVmid ?? null) as number | null,
    vmType: (spec.vmType ?? r.vmType ?? r.type ?? "") as string,
    status: extractStatus(r.status),
    osType: (spec.os ?? r.osType ?? r.os_type ?? "") as string,
    accessMethod: (spec.accessMethod ?? r.accessMethod ?? "") as string,
    accessUser: (spec.accessUser ?? r.accessUser ?? null) as string | null,
    cpu: (spec.cpu ?? r.cpu ?? 0) as number,
    memoryMb: (spec.memoryMb ?? r.memoryMb ?? r.memory_mb ?? 0) as number,
    diskGb: (spec.diskGb ?? r.diskGb ?? r.disk_gb ?? 0) as number,
    ipAddress: (spec.ipAddress ?? r.ipAddress ?? r.ip_address ?? null) as
      | string
      | null,
    createdAt: (r.createdAt ?? r.created_at ?? "") as string,
  }
}

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
      const res = await infraFetch<SuccessResponse<Record<string, unknown>[]>>(
        `/providers${buildQs(opts ?? {})}`
      )
      return res.data.map(flattenProvider)
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useProvider(id: string | undefined) {
  return useQuery<Provider | null>({
    queryKey: ["infra", "provider", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Record<string, unknown>>>(
        `/providers/${id}`
      )
      return flattenProvider(res.data)
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
      const res = await infraFetch<SuccessResponse<Record<string, unknown>[]>>(
        `/clusters${buildQs(opts ?? {})}`
      )
      return res.data.map(flattenCluster)
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useCluster(id: string | undefined) {
  return useQuery<Cluster | null>({
    queryKey: ["infra", "cluster", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Record<string, unknown>>>(
        `/clusters/${id}`
      )
      return flattenCluster(res.data)
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
      const qs = buildQs({ ...opts, limit: "500" })
      const res = await infraFetch<SuccessResponse<Record<string, unknown>[]>>(
        `/hosts${qs}`
      )
      return res.data.map(flattenHost)
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useHost(id: string | undefined) {
  return useQuery<Host | null>({
    queryKey: ["infra", "host", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Record<string, unknown>>>(
        `/hosts/${id}`
      )
      return flattenHost(res.data)
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
      const res = await infraFetch<SuccessResponse<Record<string, unknown>[]>>(
        `/vms${buildQs(opts ?? {})}`
      )
      return res.data.map(flattenVM)
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useVM(id: string | undefined) {
  return useQuery<VM | null>({
    queryKey: ["infra", "vm", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Record<string, unknown>>>(
        `/vms/${id}`
      )
      return flattenVM(res.data)
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
  assignedToKind?: string
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

// --- Estates ---

export interface Estate {
  id: string
  name: string
  slug: string
  type: string
  status: string
  spec: Record<string, unknown>
  createdAt: string
}

function flattenEstate(r: Record<string, unknown>): Estate {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    type: (r.type ?? "unknown") as string,
    status: (spec.lifecycle as string) ?? extractStatus(r.status),
    spec: spec,
    createdAt: (r.createdAt ?? r.created_at ?? "") as string,
  }
}

export function useEstates() {
  return useQuery<Estate[]>({
    queryKey: ["infra", "estates"],
    queryFn: async () => {
      const res =
        await infraFetch<SuccessResponse<Record<string, unknown>[]>>(
          "/estates?limit=500"
        )
      return res.data.map(flattenEstate)
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Realms ---

export interface Realm {
  id: string
  name: string
  slug: string
  type: string
  hostId: string | null
  hostName: string | null
  status: string
  spec: Record<string, unknown>
  serviceCount: number
  createdAt: string
}

function flattenRealm(r: Record<string, unknown>): Realm {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  const statusObj = (r.status ?? {}) as Record<string, unknown>
  const lastScan = (statusObj.lastScan ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    type: (r.type ?? "unknown") as string,
    hostId: (r.hostId ?? r.host_id ?? null) as string | null,
    hostName: null,
    status: (spec.status as string) ?? extractStatus(r.status),
    spec: spec,
    serviceCount: (lastScan.serviceCount as number) ?? 0,
    createdAt: (r.createdAt ?? r.created_at ?? "") as string,
  }
}

export function useRealms() {
  return useQuery<Realm[]>({
    queryKey: ["infra", "realms"],
    queryFn: async () => {
      const res =
        await infraFetch<SuccessResponse<Record<string, unknown>[]>>(
          "/realms?limit=500"
        )
      return res.data.map(flattenRealm)
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

export interface OntologyHost {
  id: string
  slug: string
  name: string
  type: string
  estateId: string | null
  spec: Record<string, unknown>
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export function useHostRaw(slugOrId: string | undefined) {
  return useQuery<OntologyHost | null>({
    queryKey: ["infra", "host-raw", slugOrId],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<OntologyHost>>(
        `/hosts/${slugOrId}`
      )
      return res.data
    },
    enabled: !!slugOrId,
    refetchInterval: POLL_INTERVAL,
  })
}

// ── Ontology hooks (new entities) ───────────────────

import type { DnsDomain, Route, Secret, Service, Tunnel } from "./types"

function ontologyList<T>(
  entity: string,
  opts?: Record<string, string | undefined>
) {
  const qs = buildQs({ ...opts, limit: "500" })
  return useQuery<T[]>({
    queryKey: ["infra", entity, opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<T[]>>(`/${entity}${qs}`)
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

function ontologyDetail<T>(entity: string, slugOrId: string | undefined) {
  return useQuery<T | null>({
    queryKey: ["infra", entity, slugOrId],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<T>>(`/${entity}/${slugOrId}`)
      return res.data
    },
    enabled: !!slugOrId,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useServices(opts?: { type?: string }) {
  return ontologyList<Service>("services", opts)
}

export function useService(slugOrId: string | undefined) {
  return ontologyDetail<Service>("services", slugOrId)
}

export function useRoutes(opts?: { type?: string; realmId?: string }) {
  return ontologyList<Route>("routes", opts)
}

export function useRoute(slugOrId: string | undefined) {
  return ontologyDetail<Route>("routes", slugOrId)
}

export function useDnsDomains(opts?: { type?: string }) {
  return ontologyList<DnsDomain>("dns-domains", opts)
}

export function useDnsDomain(slugOrId: string | undefined) {
  return ontologyDetail<DnsDomain>("dns-domains", slugOrId)
}

export function useTunnels(opts?: { phase?: string }) {
  return ontologyList<Tunnel>("tunnels", opts)
}

export function useTunnel(slugOrId: string | undefined) {
  return ontologyDetail<Tunnel>("tunnels", slugOrId)
}

export function useSecrets() {
  return ontologyList<Secret>("secrets")
}

export function useSecret(slugOrId: string | undefined) {
  return ontologyDetail<Secret>("secrets", slugOrId)
}

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
