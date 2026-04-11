import { getFactoryClient } from "../client.js"

export type EntityType = "workbench" | "vm" | "host"
export type Transport = "ssh" | "kubectl" | "none"

export interface ResolvedEntity {
  type: EntityType
  id: string
  slug: string
  displayName: string
  status: string
  realmType?: string // container | vm (for workbenches)

  transport: Transport

  // SSH fields
  sshHost?: string
  sshPort?: number
  sshUser?: string
  jumpHost?: string
  jumpUser?: string
  jumpPort?: number
  identityFile?: string

  // kubectl fields
  podName?: string
  namespace?: string
  container?: string
  kubeContext?: string
  kubeconfig?: string // inline kubeconfig YAML fetched from factory

  // Internal — used to resolve kubeconfig lazily
  systemDeploymentId?: string
  clusterEndpoint?: string // IP/hostname of the runtime host (for SSH jump)

  // Display
  context?: string
  resourceSpec?: string
}

export class EntityFinder {
  private apiPromise: ReturnType<typeof getFactoryClient>

  constructor() {
    this.apiPromise = getFactoryClient()
  }

  /**
   * Resolve a single target by slug/name/id.
   * Searches: workbenches → hosts (type=vm) → hosts → /access/resolve fallback
   */
  async resolve(target: string): Promise<ResolvedEntity | null> {
    const api = await this.apiPromise

    // 1. Try workbenches
    try {
      const result = await api.api.v1.factory.fleet.workbenches.get()
      const items = (result?.data?.data ?? []).filter(
        (w) => w.slug === target || w.id === target
      )
      if (items.length === 0) {
        try {
          const byId = await api.api.v1.factory.fleet
            .workbenches({ slugOrId: target })
            .get()
          const wksData = byId?.data?.data ?? byId?.data
          if (wksData && typeof wksData === "object" && "id" in wksData)
            items.push(wksData as Parameters<typeof items.push>[0])
        } catch {
          /* not found by id */
        }
      }
      const match = items[0]
      if (match) {
        const entity = workbenchToEntity(match)
        if (entity?.transport === "kubectl") {
          if (entity.systemDeploymentId) {
            const access = await this.resolveClusterAccess(
              api,
              entity.systemDeploymentId
            )
            entity.kubeconfig = access.kubeconfig
            entity.clusterEndpoint = access.endpoint
          } else if (match.realmId) {
            // No system deployment yet — resolve kubeconfig directly from realm
            const access = await this.resolveRealmAccess(
              api,
              match.realmId as string
            )
            entity.kubeconfig = access.kubeconfig
            entity.clusterEndpoint = access.endpoint
          }
        }
        // Rewrite Docker-internal hostnames (factory reconciler runs in Docker,
        // but the CLI runs on the host where host.docker.internal doesn't resolve)
        if (entity) {
          entity.sshHost = rewriteDockerHost(entity.sshHost)
        }
        // Resolve loopback sshHost via runtime endpoint
        if (entity && isLoopback(entity.sshHost) && match.realmId) {
          const access = await this.resolveRealmAccess(
            api,
            match.realmId as string
          )
          if (access.endpoint && !isLoopback(access.endpoint)) {
            entity.sshHost = access.endpoint
          }
        }
        return entity
      }
    } catch {
      /* endpoint may not exist or error */
    }

    // 2. Try hosts (covers VMs, bare-metal, cloud instances, kube nodes)
    try {
      const result = await api.api.v1.factory.infra.hosts.get()
      const items = (result?.data?.data ?? []).filter(
        (h) => h.slug === target || h.id === target
      )
      if (items.length === 0) {
        try {
          const byId = await api.api.v1.factory.infra
            .hosts({ slugOrId: target })
            .get()
          const hostData = byId?.data?.data ?? byId?.data
          if (hostData && typeof hostData === "object" && "id" in hostData)
            items.push(hostData as Parameters<typeof items.push>[0])
        } catch {
          /* not found */
        }
      }
      const match = items[0]
      if (match) {
        return hostToEntity(match)
      }
    } catch {
      /* endpoint may not exist */
    }

    // 3. Fallback to /access/resolve
    try {
      const result = await api.api.v1.factory.infra.access
        .resolve({ slug: target })
        .get()
      const data = (result?.data?.data ?? result?.data) as unknown as
        | Record<string, unknown>
        | undefined
      if (data) {
        return {
          type: (data.type === "host" ? "host" : "workbench") as EntityType,
          id: (data.id as string | undefined) ?? target,
          slug: (data.slug as string | undefined) ?? target,
          displayName: (data.name as string | undefined) ?? target,
          status: "unknown",
          transport: "ssh",
          sshHost:
            (data.hostname as string | undefined) ??
            (data.host as string | undefined),
          sshPort: (data.port as number | undefined) ?? 22,
          sshUser: (data.user as string | undefined) ?? "root",
          jumpHost: data.jumpHost as string | undefined,
          jumpUser: data.jumpUser as string | undefined,
          jumpPort: data.jumpPort as number | undefined,
          identityFile: data.identityFile as string | undefined,
        }
      }
    } catch {
      /* not found */
    }

    return null
  }

  /**
   * Resolve cluster access for a system deployment by following:
   * systemDeploymentId → realmId → realm.spec.kubeconfigRef + endpoint
   */
  private async resolveClusterAccess(
    api: Awaited<ReturnType<typeof getFactoryClient>>,
    systemDeploymentId: string
  ): Promise<{ kubeconfig?: string; endpoint?: string }> {
    try {
      // 1. Get system deployment → realmId
      const sdResult = await api.api.v1.factory.fleet["system-deployments"]({
        slugOrId: systemDeploymentId,
      }).get()
      const sdRaw = sdResult?.data?.data ?? sdResult?.data
      const sd = (sdRaw && typeof sdRaw === "object" ? sdRaw : {}) as Record<
        string,
        unknown
      >
      const realmId = sd.realmId as string | undefined
      if (!realmId) return {}

      // 2. Get realm → spec.kubeconfigRef and endpoint
      const rtResult = await api.api.v1.factory.infra
        .realms({ slugOrId: realmId })
        .get()
      const rtRaw = rtResult?.data?.data ?? rtResult?.data
      const rt = (rtRaw && typeof rtRaw === "object" ? rtRaw : {}) as Record<
        string,
        unknown
      >
      const spec = (
        rt.spec && typeof rt.spec === "object" ? rt.spec : {}
      ) as Record<string, unknown>
      const kubeconfigRef = spec.kubeconfigRef as string | undefined
      const endpoint = (spec.endpoint ?? rt.endpoint) as string | undefined

      if (!kubeconfigRef) return { endpoint }

      // Only inline YAML kubeconfigs are usable from the CLI.
      if (kubeconfigRef.startsWith("vault:")) return { endpoint }

      return { kubeconfig: kubeconfigRef, endpoint }
    } catch {
      return {}
    }
  }

  /**
   * Resolve cluster access directly from a realmId (skipping system deployment lookup).
   */
  private async resolveRealmAccess(
    api: Awaited<ReturnType<typeof getFactoryClient>>,
    realmId: string
  ): Promise<{ kubeconfig?: string; endpoint?: string }> {
    try {
      const rtResult = await api.api.v1.factory.infra
        .realms({ slugOrId: realmId })
        .get()
      const rtRaw = rtResult?.data?.data ?? rtResult?.data
      const rt = (rtRaw && typeof rtRaw === "object" ? rtRaw : {}) as Record<
        string,
        unknown
      >
      const spec = (
        rt.spec && typeof rt.spec === "object" ? rt.spec : {}
      ) as Record<string, unknown>
      const kubeconfigRef = spec.kubeconfigRef as string | undefined
      const endpoint = (spec.endpoint ?? rt.endpoint) as string | undefined

      if (!kubeconfigRef) return { endpoint }
      if (kubeconfigRef.startsWith("vault:")) return { endpoint }

      return { kubeconfig: kubeconfigRef, endpoint }
    } catch {
      return {}
    }
  }

  /**
   * List all SSHable entities for interactive picker.
   */
  async list(): Promise<ResolvedEntity[]> {
    const api = await this.apiPromise
    const entities: ResolvedEntity[] = []

    // Fetch in parallel: workbenches + hosts
    const [workbenches, hosts] = await Promise.allSettled([
      api.api.v1.factory.fleet.workbenches
        .get()
        .then((r) => r?.data?.data ?? []),
      api.api.v1.factory.infra.hosts.get().then((r) => r?.data?.data ?? []),
    ])

    if (workbenches.status === "fulfilled") {
      for (const wks of workbenches.value) {
        const entity = workbenchToEntity(wks)
        if (entity) entities.push(entity)
      }
    }

    if (hosts.status === "fulfilled") {
      for (const host of hosts.value) {
        const entity = hostToEntity(host)
        if (entity) entities.push(entity)
      }
    }

    return entities
  }
}

function workbenchToEntity(
  wks: Record<string, unknown>
): ResolvedEntity | null {
  if (!wks) return null
  const spec = (wks.spec ?? {}) as Record<string, unknown>
  const realmType = (spec.realmType ?? "container") as string
  const isContainer = realmType === "container"

  // Prefer SSH when the reconciler has written sshHost (containers expose sshd on port 22).
  // Fall back to kubectl for containers that don't have SSH yet (e.g. still provisioning).
  const hasSsh = !!(spec.sshHost || spec.ipAddress)
  const transport: Transport = isContainer && !hasSsh ? "kubectl" : "ssh"

  return {
    type: "workbench",
    id: wks.id as string,
    slug: (wks.slug ?? wks.id) as string,
    displayName: (wks.name ?? wks.slug ?? wks.id) as string,
    status: (spec.lifecycle ?? spec.healthStatus ?? "unknown") as string,
    realmType,
    transport,
    // SSH fields (populated for VMs always, and containers once reconciler writes sshHost)
    sshHost: (spec.sshHost ?? spec.ipAddress) as string | undefined,
    sshPort: (spec.sshPort as number | undefined) ?? 22,
    sshUser: "root",
    // kubectl fallback (container workbenches without SSH)
    podName: isContainer
      ? ((spec.podName as string | undefined) ?? `workbench-${wks.slug}`)
      : undefined,
    namespace: isContainer ? `workbench-${wks.slug}` : undefined,
    container: isContainer ? "workbench" : undefined,
    systemDeploymentId: wks.systemDeploymentId as string | undefined,
  }
}

function isLoopback(host: string | undefined): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0"
}

/** Rewrite Docker-internal hostnames to localhost for CLI running on the host. */
function rewriteDockerHost(host: string | undefined): string | undefined {
  if (host === "host.docker.internal") return "localhost"
  return host
}

function hostToEntity(host: Record<string, unknown>): ResolvedEntity | null {
  if (!host) return null
  const spec = (host.spec ?? {}) as Record<string, unknown>
  return {
    type: (host.type === "vm" || host.type === "cloud-instance"
      ? "vm"
      : "host") as EntityType,
    id: host.id as string,
    slug: (host.slug ?? host.id) as string,
    displayName: (host.name ?? host.slug ?? host.id) as string,
    status: (spec.lifecycle ?? "unknown") as string,
    transport: "ssh",
    sshHost: (spec.ipAddress ?? spec.hostname) as string | undefined,
    sshPort: (spec.sshPort as number | undefined) ?? 22,
    sshUser: (spec.accessUser as string | undefined) ?? "root",
    jumpHost: spec.jumpHost as string | undefined,
    jumpUser: spec.jumpUser as string | undefined,
    jumpPort: spec.jumpPort as number | undefined,
    identityFile: spec.identityFile as string | undefined,
  }
}
