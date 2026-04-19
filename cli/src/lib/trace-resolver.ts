import { getFactoryRestClient } from "../client.js"
import { EntityFinder, type ResolvedEntity } from "./entity-finder.js"

export type TraceNode = {
  entity: Record<string, unknown>
  link?: { id?: string; type: string; spec: Record<string, unknown> }
  weight?: number
  implicit?: boolean
  children: TraceNode[]
}

type RequestContext = {
  protocol: string
  port: number
  domain?: string
  path?: string
}

export interface ResolvedTarget {
  entitySlug: string
  entityType: string
  spec: Record<string, unknown>
  hostSlug?: string
  hostEntity?: ResolvedEntity
  composeProject?: string
  serviceName?: string
  targetPort?: number
  domain?: string
  path?: string
  traceRoot?: TraceNode
  request?: RequestContext
}

const HOST_TYPES = new Set(["bare-metal", "vm", "lxc", "cloud-instance"])
const TERMINAL_TYPES = new Set([
  "component",
  "component-deployment",
  "container",
  "service",
])

function findTerminal(
  node: TraceNode,
  ancestors: TraceNode[] = []
): { node: TraceNode; ancestors: TraceNode[] } {
  // Prefer a terminal-type leaf
  if (
    TERMINAL_TYPES.has(String(node.entity.type ?? "")) &&
    node.children.length === 0
  ) {
    return { node, ancestors }
  }
  for (const child of node.children) {
    const result = findTerminal(child, [...ancestors, node])
    if (TERMINAL_TYPES.has(String(result.node.entity.type ?? ""))) {
      return result
    }
  }
  // No terminal type found — return the deepest leaf
  if (node.children.length === 0) {
    return { node, ancestors }
  }
  return findTerminal(node.children[0], [...ancestors, node])
}

function findHostAncestor(ancestors: TraceNode[]): TraceNode | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (HOST_TYPES.has(String(ancestors[i].entity.type ?? ""))) {
      return ancestors[i]
    }
  }
  return undefined
}

export async function resolveUrl(url: string): Promise<ResolvedTarget> {
  const rest = await getFactoryRestClient()

  const postResult = await rest.request<{
    data: { request: RequestContext; root: TraceNode }
  }>("POST", "/api/v1/factory/infra/trace/request", { url })

  const root = postResult.data.root
  const request = postResult.data.request
  const terminal = findTerminal(root)
  const entity = terminal.node.entity
  const spec = (entity.spec ?? {}) as Record<string, unknown>
  const slug = String(entity.slug ?? entity.id ?? "?")

  const hostNode = findHostAncestor(terminal.ancestors)
  let hostEntity: ResolvedEntity | undefined
  let hostSlug: string | undefined
  if (hostNode) {
    hostSlug = String(hostNode.entity.slug ?? hostNode.entity.id)
    const finder = new EntityFinder()
    try {
      hostEntity = (await finder.resolve(hostSlug)) ?? undefined
    } catch {}

    // If the host has no jump host configured, check if there's a parent host
    // in the trace tree that can serve as a bastion (e.g. lepton-59 for VMs
    // on private subnets behind it).
    if (hostEntity && !hostEntity.jumpHost) {
      const parentHost = findHostAncestor(
        terminal.ancestors.filter((a) => a !== hostNode)
      )
      if (parentHost) {
        const parentSlug = String(
          parentHost.entity.slug ?? parentHost.entity.id
        )
        try {
          const parentEntity = await finder.resolve(parentSlug)
          if (parentEntity?.sshHost) {
            hostEntity.jumpHost = parentEntity.sshHost
            hostEntity.jumpUser = parentEntity.sshUser
            hostEntity.jumpPort = parentEntity.sshPort
          }
        } catch {}
      }
    }
  }

  const composeProject =
    (spec.composeProject as string | undefined) ??
    (spec.systemDeployment as string | undefined)
  const serviceName =
    (spec.composeService as string | undefined) ??
    (spec.targetService as string | undefined) ??
    (spec.serviceName as string | undefined)

  return {
    entitySlug: slug,
    entityType: String(entity.type ?? "unknown"),
    spec,
    hostSlug,
    hostEntity,
    composeProject,
    serviceName,
    targetPort:
      (spec.targetPort as number | undefined) ??
      (terminal.node.link?.spec?.egressPort as number | undefined),
    domain: request.domain,
    path: request.path,
    traceRoot: root,
    request,
  }
}
