import type { HostSpec } from "@smp/factory-shared/schemas/infra"
import { and, eq, isNull, or } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { host, realm } from "../../db/schema/infra"
import { workbench } from "../../db/schema/ops"
import { getEntityIps } from "./ipam.service"

/**
 * Unified SSH target resolved from a slug.
 * Searched across workspaces, VMs, and hosts.
 */
export interface SshTarget {
  kind: "workbench" | "host"
  id: string
  slug: string
  name: string
  host: string
  port: number
  user: string
  status: string
  jumpHost?: string
  jumpUser?: string
  jumpPort?: number
  identityFile?: string
}

/**
 * Resolve a slug to an SSH-connectable target.
 * Search order: workbenches → VMs → hosts.
 * Accepts either a slug or an ID.
 */
export async function resolveTarget(
  db: Database,
  slug: string
): Promise<SshTarget | null> {
  // 1. Workbenches (lifecycle + SSH config live in spec JSONB)
  const wsRows = await db
    .select()
    .from(workbench)
    .where(
      and(
        or(eq(workbench.slug, slug), eq(workbench.id, slug)),
        isNull(workbench.systemTo),
        isNull(workbench.validTo)
      )
    )
  const wsRow = wsRows[0]
  const wsSpec = wsRow?.spec
  if (wsRow && wsSpec?.sshHost && wsSpec?.sshPort) {
    let sshHost = wsSpec.sshHost
    if (isLoopback(sshHost) && wsRow.realmId) {
      const [rt] = await db
        .select()
        .from(realm)
        .where(eq(realm.id, wsRow.realmId))
      sshHost =
        rt?.spec?.endpoint ??
        endpointFromKubeconfig(rt?.spec?.kubeconfigRef) ??
        sshHost
    }
    return {
      kind: "workbench",
      id: wsRow.id,
      slug: wsRow.slug,
      name: wsRow.name,
      host: sshHost,
      port: wsSpec.sshPort,
      user: "root",
      status: wsSpec.lifecycle ?? "unknown",
    }
  }

  // 2. Hosts (SSH config lives in spec JSONB)
  const hostRows = await db
    .select()
    .from(host)
    .where(or(eq(host.slug, slug), eq(host.id, slug)))
  const hostRow = hostRows[0]
  const hostSpec = hostRow?.spec as HostSpec | undefined
  const hostIp = await resolveHostIp(db, hostRow?.id, hostSpec)
  if (hostRow && hostIp) {
    return {
      kind: "host",
      id: hostRow.id,
      slug: hostRow.slug,
      name: hostRow.name,
      host: hostIp,
      port: hostSpec?.sshPort ?? 22,
      user: hostSpec?.accessUser ?? "root",
      status: hostSpec?.lifecycle ?? "active",
      jumpHost: hostSpec?.jumpHost,
      jumpUser: hostSpec?.jumpUser,
      jumpPort: hostSpec?.jumpPort,
      identityFile: hostSpec?.identityFile,
    }
  }

  return null
}

/**
 * List all SSH-connectable targets for SSH config generation.
 */
export async function listTargets(db: Database): Promise<SshTarget[]> {
  const targets: SshTarget[] = []

  // Workbenches with SSH access (lifecycle + SSH config in spec JSONB)
  const wsRows = await db
    .select()
    .from(workbench)
    .where(and(isNull(workbench.systemTo), isNull(workbench.validTo)))

  // Pre-fetch realms to resolve localhost sshHost → actual realm endpoint
  const realmIds = [
    ...new Set(wsRows.map((r) => r.realmId).filter(Boolean)),
  ] as string[]
  const realmById = new Map<string, string>()
  if (realmIds.length > 0) {
    const realms = await db
      .select()
      .from(realm)
      .where(or(...realmIds.map((id) => eq(realm.id, id)))!)
    for (const rt of realms) {
      const endpoint =
        rt.spec?.endpoint ?? endpointFromKubeconfig(rt.spec?.kubeconfigRef)
      if (endpoint) realmById.set(rt.id, endpoint)
    }
  }

  for (const row of wsRows) {
    const spec = row.spec
    if (spec.sshHost && spec.sshPort && spec.lifecycle === "active") {
      let sshHost = spec.sshHost
      // Resolve localhost/loopback to the realm's actual endpoint
      if (isLoopback(sshHost) && row.realmId) {
        sshHost = realmById.get(row.realmId) ?? sshHost
      }
      if (isLoopback(sshHost)) continue // skip unresolvable localhost targets
      targets.push({
        kind: "workbench",
        id: row.id,
        slug: row.slug,
        name: row.name,
        host: sshHost,
        port: spec.sshPort,
        user: "root",
        status: spec.lifecycle,
      })
    }
  }

  // Hosts — read SSH config from spec JSONB
  const allHosts = await db.select().from(host)
  for (const hostRow of allHosts) {
    const spec = hostRow.spec as HostSpec | undefined
    const ip = await resolveHostIp(db, hostRow.id, spec)
    const accessMethod = spec?.accessMethod ?? "ssh"
    const lifecycle = spec?.lifecycle ?? "active"
    if (ip && accessMethod === "ssh" && lifecycle === "active") {
      targets.push({
        kind: "host",
        id: hostRow.id,
        slug: hostRow.slug,
        name: hostRow.name,
        host: ip,
        port: spec?.sshPort ?? 22,
        user: spec?.accessUser ?? "root",
        status: lifecycle,
        jumpHost: spec?.jumpHost,
        jumpUser: spec?.jumpUser,
        jumpPort: spec?.jumpPort,
        identityFile: spec?.identityFile,
      })
    }
  }

  return targets
}

// ── Helpers ──────────────────────────────────────────────────

async function resolveHostIp(
  db: Database,
  hostId: string | undefined,
  spec: HostSpec | undefined
): Promise<string | undefined> {
  if (hostId) {
    const ips = await getEntityIps(db, "host", hostId)
    const primaryIp = ips.find((ip) => ip.spec.primary)?.address
    if (primaryIp) return primaryIp
    if (ips[0]?.address) return ips[0].address
  }
  return spec?.ipAddress ?? spec?.hostname
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0"
}

function endpointFromKubeconfig(kubeconfig: string | undefined): string | null {
  if (!kubeconfig) return null
  const match = kubeconfig.match(/server:\s*https?:\/\/([^:/\s]+)/)
  if (!match) return null
  const h = match[1]
  if (isLoopback(h) || h === "host.docker.internal") return null
  return h
}
