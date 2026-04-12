/**
 * Infra controller.
 *
 * Route → table mapping:
 *   /infra/estates       → infra.estate
 *   /infra/hosts         → infra.host
 *   /infra/realms        → infra.realm
 *   /infra/routes        → infra.route
 *   /infra/dns-domains   → infra.dns_domain
 *   /infra/tunnels       → infra.tunnel
 *   /infra/ip-addresses  → infra.ip_address
 *   /infra/secrets       → infra.secret
 *   /infra/network-links → infra.network_link
 */
import {
  AllocateIpBody,
  AssignIpBody,
  CloneHostBody,
  CloseTunnelBody,
  HostLifecycleBody,
  MigrateHostBody,
  ResizeHostBody,
  RestoreHostSnapshotBody,
  RevokeSecretBody,
  ScanHostBody,
  SnapshotHostBody,
  SyncEstateBody,
  UpgradeRealmBody,
} from "@smp/factory-shared/schemas/actions"
import {
  CreateDnsDomainSchema,
  CreateEstateSchema,
  CreateHostSchema,
  CreateIpAddressSchema,
  CreateNetworkLinkSchema,
  CreateRealmSchema,
  CreateRouteSchema,
  CreateSecretSchema,
  CreateServiceSchema,
  CreateTunnelSchema,
  type DnsDomainSpec,
  type EstateSpec,
  type HostSpec,
  type IpAddressSpec,
  NetworkLinkEndpointKindSchema,
  type RealmSpec,
  type RouteSpec,
  type SecretSpec,
  UpdateDnsDomainSchema,
  UpdateEstateSchema,
  UpdateHostSchema,
  UpdateIpAddressSchema,
  UpdateNetworkLinkSchema,
  UpdateRealmSchema,
  UpdateRouteSchema,
  UpdateSecretSchema,
  UpdateServiceSchema,
  UpdateTunnelSchema,
} from "@smp/factory-shared/schemas/infra"
import { and, eq, or, sql } from "drizzle-orm"
import { Elysia } from "elysia"
import { z } from "zod"

import type { Database } from "../../db/connection"
import {
  dnsDomain,
  estate,
  host,
  ipAddress,
  networkLink,
  realm,
  realmHost,
  route,
  secret,
  service,
  tunnel,
} from "../../db/schema/infra"
import { ontologyRoutes } from "../../lib/crud"
import { NotFoundError, ValidationError } from "../../lib/errors"
import {
  countRows,
  paginationMeta,
  parsePagination,
} from "../../lib/pagination"
import { list, ok } from "../../lib/responses"
import {
  assignIp as assignIpAddress,
  ensureIp,
  getEntityIps,
} from "../../services/infra/ipam.service"
import { syncDnsFromEstate } from "../../services/infra/dns-sync.service"
import { verifyDomain } from "./gateway.service"
import { drizzleDbReader, resolveRouteTargets } from "./route-resolver"
import {
  domainMatches,
  drizzleGraphReader,
  traceFrom,
  validateEndpoints,
} from "./trace"
import { createTunnelHandlers } from "./tunnel-broker"

function isRfc1918Ip(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  return false
}

const TraceBodySchema = z.object({
  entityKind: NetworkLinkEndpointKindSchema,
  entityId: z.string().min(1),
  direction: z.enum(["outbound", "inbound"]).default("outbound"),
})

export function infraController(db: Database) {
  return (
    new Elysia({ prefix: "/infra" })

      // ── Estates ─────────────────────────────────────────
      // Covers: providers, regions, datacenters, VPCs, subnets, hypervisors, racks
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "estates",
          singular: "estate",
          table: estate,
          slugColumn: estate.slug,
          idColumn: estate.id,
          prefix: "est",
          kindAlias: "estate",
          slugRefs: {
            parentEstateSlug: {
              fk: "parentEstateId",
              lookupTable: estate,
              lookupSlugCol: estate.slug,
              lookupIdCol: estate.id,
            },
          },
          createSchema: CreateEstateSchema,
          updateSchema: UpdateEstateSchema,
          deletable: true,
          relations: {
            hosts: {
              path: "hosts",
              table: host,
              fk: host.estateId,
            },
            "ip-addresses": {
              path: "ip-addresses",
              table: ipAddress,
              fk: ipAddress.subnetId,
            },
            children: {
              path: "children",
              table: estate,
              fk: estate.parentEstateId,
            },
          },
          actions: {
            sync: {
              bodySchema: SyncEstateBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as { force?: boolean }
                const spec = entity.spec as EstateSpec
                const [row] = await db
                  .update(estate)
                  .set({
                    spec: {
                      ...spec,
                      lastSyncRequestedAt: new Date(),
                      forceSyncRequested: parsed.force ?? false,
                    } as EstateSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(estate.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Hosts ──────────────────────────────────────────────
      // Covers: bare-metal, VMs, LXC, cloud instances,
      //         kube nodes (type='bare-metal' with role='k8s-*' in spec)
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "hosts",
          singular: "host",
          table: host,
          slugColumn: host.slug,
          idColumn: host.id,
          prefix: "host",
          kindAlias: "host",
          slugRefs: {
            estateSlug: {
              fk: "estateId",
              lookupTable: estate,
              lookupSlugCol: estate.slug,
              lookupIdCol: estate.id,
            },
          },
          createSchema: CreateHostSchema,
          updateSchema: UpdateHostSchema,
          deletable: true,
          hooks: {
            afterCreate: async ({ db: hookDb, row }) => {
              const spec = row.spec as HostSpec
              const ips = spec.ips ?? (spec.ipAddress ? [spec.ipAddress] : [])

              for (let i = 0; i < ips.length; i++) {
                const address = ips[i]
                const ip = await ensureIp(hookDb, {
                  address,
                  spec: {
                    scope: isRfc1918Ip(address) ? "private" : "public",
                    role: i === 0 ? "primary" : "secondary",
                  },
                })
                await assignIpAddress(hookDb, ip.ipAddressId, {
                  assignedToKind: "host",
                  assignedToId: row.id,
                })
              }

              return row
            },
            beforeUpdate: async ({ entity, parsed }) => {
              if (parsed.spec) {
                const currentSpec = (entity.spec ?? {}) as Record<
                  string,
                  unknown
                >
                const parsedSpec = parsed.spec as Record<string, unknown>
                return { ...parsed, spec: { ...currentSpec, ...parsedSpec } }
              }
              return parsed
            },
          },
          relations: {
            realms: {
              path: "realms",
              table: realmHost,
              fk: realmHost.hostId,
            },
          },
          actions: {
            // VM lifecycle actions (applicable to hosts with type='vm' or 'cloud-instance')
            start: {
              bodySchema: HostLifecycleBody,
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      lifecycle: "active",
                      lastActionAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            stop: {
              bodySchema: HostLifecycleBody,
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      lifecycle: "offline",
                      lastActionAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            restart: {
              bodySchema: HostLifecycleBody,
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      lifecycle: "active",
                      lastActionAt: new Date(),
                      lastRestartAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            resize: {
              bodySchema: ResizeHostBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as {
                  cpu?: number
                  memoryMb?: number
                  diskGb?: number
                }
                const spec = entity.spec as HostSpec
                const merged: HostSpec = { ...spec }
                if (parsed.cpu !== undefined) merged.cpu = parsed.cpu
                if (parsed.memoryMb !== undefined)
                  merged.memoryMb = parsed.memoryMb
                if (parsed.diskGb !== undefined) merged.diskGb = parsed.diskGb
                const [row] = await db
                  .update(host)
                  .set({ spec: merged, updatedAt: new Date() })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            migrate: {
              bodySchema: MigrateHostBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as {
                  targetEstateId: string
                  reason?: string
                }
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    estateId: parsed.targetEstateId,
                    spec: {
                      ...spec,
                      lastMigratedAt: new Date(),
                      migrationReason: parsed.reason,
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            clone: {
              bodySchema: CloneHostBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as { name: string; slug: string }
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .insert(host)
                  .values({
                    slug: parsed.slug,
                    name: parsed.name,
                    type: entity.type as string,
                    estateId: entity.estateId as string | null,
                    spec: { ...spec, clonedFrom: entity.id } as HostSpec,
                  })
                  .returning()
                return row
              },
            },
            snapshot: {
              bodySchema: SnapshotHostBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as { name?: string; description?: string }
                const spec = entity.spec as HostSpec
                const snapshots = ((spec as Record<string, unknown>)
                  .snapshots ?? []) as Array<Record<string, unknown>>
                snapshots.push({
                  name: parsed.name ?? `snapshot-${Date.now()}`,
                  description: parsed.description,
                  createdAt: new Date(),
                })
                const [row] = await db
                  .update(host)
                  .set({
                    spec: { ...spec, snapshots } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            "restore-snapshot": {
              bodySchema: RestoreHostSnapshotBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as { snapshotId: string }
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      restoringSnapshot: parsed.snapshotId,
                      lastActionAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            // Kube node actions (applicable to hosts with role='k8s-*' in spec)
            pause: {
              bodySchema: HostLifecycleBody,
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      schedulable: false,
                      lastActionAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            resume: {
              bodySchema: HostLifecycleBody,
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      schedulable: true,
                      lastActionAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            evacuate: {
              bodySchema: HostLifecycleBody,
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as HostSpec
                const [row] = await db
                  .update(host)
                  .set({
                    spec: {
                      ...spec,
                      schedulable: false,
                      evacuating: true,
                      lastActionAt: new Date(),
                    } as HostSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(host.id, entity.id as string))
                  .returning()
                return row
              },
            },
            scan: {
              bodySchema: ScanHostBody,
              handler: async ({ db, entity, body }) => {
                const { reconcileHostScan } =
                  await import("../../services/infra/scan-reconciler")
                const parsed = body as {
                  scanResult: import("@smp/factory-shared/schemas/infra").HostScanResult
                }
                return reconcileHostScan(db, entity as any, parsed.scanResult)
              },
            },
          },
        })
      )

      // ── Realms ───────────────────────────────────────────
      // Covers: k8s clusters, namespaces, docker engines,
      //         compose projects, systemd, reverse proxies, VM clusters
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "realms",
          singular: "realm",
          table: realm,
          slugColumn: realm.slug,
          idColumn: realm.id,
          prefix: "rlm",
          kindAlias: "realm",
          slugRefs: {
            estateSlug: {
              fk: "estateId",
              lookupTable: estate,
              lookupSlugCol: estate.slug,
              lookupIdCol: estate.id,
            },
            parentRealmSlug: {
              fk: "parentRealmId",
              lookupTable: realm,
              lookupSlugCol: realm.slug,
              lookupIdCol: realm.id,
            },
          },
          createSchema: CreateRealmSchema,
          updateSchema: UpdateRealmSchema,
          deletable: true,
          relations: {
            routes: {
              path: "routes",
              table: route,
              fk: route.realmId,
            },
            outboundLinks: {
              path: "outbound-links",
              table: networkLink,
              fk: networkLink.sourceId,
            },
            inboundLinks: {
              path: "inbound-links",
              table: networkLink,
              fk: networkLink.targetId,
            },
            children: {
              path: "children",
              table: realm,
              fk: realm.parentRealmId,
            },
          },
          actions: {
            upgrade: {
              bodySchema: UpgradeRealmBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as {
                  targetVersion: string
                  strategy: string
                }
                const spec = entity.spec as RealmSpec
                const [row] = await db
                  .update(realm)
                  .set({
                    spec: {
                      ...spec,
                      targetVersion: parsed.targetVersion,
                      upgradeStrategy: parsed.strategy,
                      upgradeRequestedAt: new Date(),
                      status: "provisioning",
                    } as RealmSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(realm.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Routes ─────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "routes",
          singular: "route",
          table: route,
          slugColumn: route.slug,
          idColumn: route.id,
          prefix: "rte",
          kindAlias: "route",
          slugRefs: {
            realmSlug: {
              fk: "realmId",
              lookupTable: realm,
              lookupSlugCol: realm.slug,
              lookupIdCol: realm.id,
            },
          },
          createSchema: CreateRouteSchema,
          updateSchema: UpdateRouteSchema,
          deletable: true,
          hooks: {
            beforeCreate: async ({ parsed }) => {
              const spec = (parsed.spec ?? {}) as RouteSpec
              const reader = drizzleDbReader(db)
              const resolved = await resolveRouteTargets(
                spec.targets ?? [],
                reader
              )
              return {
                ...parsed,
                status: resolved,
                generation: 1,
                observedGeneration: 1,
              }
            },
            beforeUpdate: async ({ entity, parsed }) => {
              const currentSpec = (entity.spec ?? {}) as RouteSpec
              const parsedSpec = (parsed.spec ?? {}) as Partial<RouteSpec>
              const mergedSpec: RouteSpec = { ...currentSpec, ...parsedSpec }
              const reader = drizzleDbReader(db)
              const resolved = await resolveRouteTargets(
                mergedSpec.targets ?? [],
                reader
              )
              const newGen =
                (((entity as Record<string, unknown>).generation as number) ??
                  0) + 1
              return {
                ...parsed,
                spec: mergedSpec,
                status: resolved,
                generation: newGen,
                observedGeneration: newGen,
              }
            },
          },
        })
      )

      // ── DNS Domains ────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "dns-domains",
          singular: "DNS domain",
          table: dnsDomain,
          slugColumn: dnsDomain.slug,
          idColumn: dnsDomain.id,
          prefix: "dom",
          kindAlias: "dns-domain",
          createSchema: CreateDnsDomainSchema,
          updateSchema: UpdateDnsDomainSchema,
          deletable: true,
          actions: {
            verify: {
              handler: async ({ db, entity }) => {
                return verifyDomain(db, entity.id as string)
              },
            },
          },
        })
      )

      // ── Secrets ────────────────────────────────────────────
      // Covers: managed secrets + SSH keys (type='ssh-key' in spec)
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "secrets",
          singular: "secret",
          table: secret,
          slugColumn: secret.slug,
          idColumn: secret.id,
          prefix: "sec",
          kindAlias: "secret",
          createSchema: CreateSecretSchema,
          updateSchema: UpdateSecretSchema,
          deletable: true,
          actions: {
            revoke: {
              bodySchema: RevokeSecretBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as { reason?: string }
                const spec = entity.spec as SecretSpec
                const [row] = await db
                  .update(secret)
                  .set({
                    spec: {
                      ...spec,
                      revokedAt: new Date(),
                      revokeReason: parsed.reason,
                      status: "revoked",
                    } as SecretSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(secret.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Network Links ─────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "network-links",
          singular: "network link",
          table: networkLink,
          slugColumn: networkLink.slug,
          idColumn: networkLink.id,
          prefix: "nlnk",
          kindAlias: "network-link",
          createSchema: CreateNetworkLinkSchema,
          updateSchema: UpdateNetworkLinkSchema,
          deletable: true,
          hooks: {
            beforeCreate: async ({ db: hookDb, parsed }) => {
              await validateEndpoints(hookDb, parsed)
              return parsed
            },
            beforeUpdate: async ({ db: hookDb, entity, parsed }) => {
              if (
                parsed.sourceId ||
                parsed.targetId ||
                parsed.sourceKind ||
                parsed.targetKind
              ) {
                const merged = { ...entity, ...parsed }
                await validateEndpoints(hookDb, merged)
              }
              return parsed
            },
          },
        })
      )

      // ── Tunnels ────────────────────────────────────────────
      // Covers: developer tunnels
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "tunnels",
          singular: "tunnel",
          table: tunnel,
          slugColumn: tunnel.subdomain,
          idColumn: tunnel.id,
          prefix: "tnl",
          kindAlias: "tunnel",
          createSchema: CreateTunnelSchema,
          updateSchema: UpdateTunnelSchema,
          deletable: true,
          actions: {
            close: {
              bodySchema: CloseTunnelBody,
              handler: async ({ db, entity }) => {
                const [row] = await db
                  .update(tunnel)
                  .set({ phase: "disconnected", updatedAt: new Date() })
                  .where(eq(tunnel.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── IP Addresses ─────────────────────────────────────
      // Covers: IPAM
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "ip-addresses",
          singular: "IP address",
          table: ipAddress,
          slugColumn: ipAddress.address,
          idColumn: ipAddress.id,
          prefix: "ipa",
          kindAlias: "ip-address",
          slugRefs: {
            subnetSlug: {
              fk: "subnetId",
              lookupTable: estate,
              lookupSlugCol: estate.slug,
              lookupIdCol: estate.id,
            },
          },
          createSchema: CreateIpAddressSchema,
          updateSchema: UpdateIpAddressSchema,
          deletable: true,
          actions: {
            assign: {
              bodySchema: AssignIpBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as {
                  assignedToKind: string
                  assignedToId: string
                }
                const spec = entity.spec as IpAddressSpec
                const [row] = await db
                  .update(ipAddress)
                  .set({
                    assignedToKind: parsed.assignedToKind,
                    assignedToId: parsed.assignedToId,
                    spec: { ...spec, status: "assigned" },
                    updatedAt: new Date(),
                  })
                  .where(eq(ipAddress.id, entity.id as string))
                  .returning()
                return row
              },
            },
            release: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as IpAddressSpec
                const [row] = await db
                  .update(ipAddress)
                  .set({
                    assignedToKind: null,
                    assignedToId: null,
                    spec: { ...spec, status: "available" },
                    updatedAt: new Date(),
                  })
                  .where(eq(ipAddress.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Services ─────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "infra",
          entity: "services",
          singular: "service",
          table: service,
          slugColumn: service.slug,
          idColumn: service.id,
          prefix: "svc",
          kindAlias: "service",
          createSchema: CreateServiceSchema,
          updateSchema: UpdateServiceSchema,
          deletable: true,
          slugRefs: {
            estateSlug: {
              fk: "estateId",
              lookupTable: estate,
              lookupSlugCol: estate.slug,
              lookupIdCol: estate.id,
            },
            realmSlug: {
              fk: "realmId",
              lookupTable: realm,
              lookupSlugCol: realm.slug,
              lookupIdCol: realm.id,
            },
          },
        })
      )

      // ── Trace ────────────────────────────────────────────
      .post(
        "/trace",
        async ({ body }) => {
          const parsed = TraceBodySchema.safeParse(body)
          if (!parsed.success) {
            throw new ValidationError(
              "Invalid trace request",
              parsed.error.flatten()
            )
          }
          const { entityKind, entityId, direction } = parsed.data
          const reader = drizzleGraphReader(db)
          const result = await traceFrom(
            reader,
            entityKind,
            entityId,
            direction
          )
          return ok(result)
        },
        {
          detail: {
            tags: ["infra/trace"],
            summary: "Trace network path from entity",
          },
        }
      )

      // ── Domain trace ────────────────────────────────────
      .get(
        "/trace/domain",
        async ({ query }) => {
          const domain = query.domain
          if (!domain) {
            throw new ValidationError("domain query parameter is required")
          }

          // Narrow at SQL level: exact match OR wildcard routes that could match
          // Extract the parent domain suffix for wildcard matching (e.g. "foo.bar.com" → ".bar.com")
          const dotIdx = domain.indexOf(".")
          const parentSuffix = dotIdx >= 0 ? domain.slice(dotIdx) : null

          const candidates = await db
            .select({
              id: route.id,
              slug: route.slug,
              name: route.name,
              domain: route.domain,
              realmId: route.realmId,
              spec: route.spec,
            })
            .from(route)
            .where(
              parentSuffix
                ? sql`${route.domain} = ${domain} OR ${route.domain} = ${"*" + parentSuffix}`
                : eq(route.domain, domain)
            )

          // Final in-memory check for edge cases (multi-level wildcards, etc.)
          const matchingRoutes = candidates.filter((r) =>
            domainMatches(r.domain, domain)
          )

          if (matchingRoutes.length === 0) {
            throw new NotFoundError(`No routes found for domain: ${domain}`)
          }

          // Only include routes that have a realm to trace
          const traceableRoutes = matchingRoutes.filter((r) => r.realmId)

          const reader = drizzleGraphReader(db)
          const traces = await Promise.all(
            traceableRoutes.map(async (r) => {
              const trace = await traceFrom(
                reader,
                "realm",
                r.realmId!,
                "outbound",
                { matchDomain: domain }
              )
              return { route: r, trace }
            })
          )

          return ok({ domain, routes: traceableRoutes, traces })
        },
        {
          detail: {
            tags: ["infra/trace"],
            summary: "Trace network path for a domain",
          },
        }
      )

      // ── IPAM: Allocate next available IP ─────────────────
      .post(
        "/ip-addresses/allocate",
        async ({ body }) => {
          const parsed = AllocateIpBody.safeParse(body)
          if (!parsed.success) {
            throw new ValidationError(
              "Invalid allocate request",
              parsed.error.flatten()
            )
          }
          const { subnetId, assignedToKind, assignedToId, strategy } =
            parsed.data

          // Find next available IP in the subnet
          const available = await db
            .select()
            .from(ipAddress)
            .where(
              and(
                eq(ipAddress.subnetId, subnetId),
                sql`(${ipAddress.spec}->>'status') = 'available'`
              )
            )
            .orderBy(strategy === "random" ? sql`random()` : ipAddress.address)
            .limit(1)

          if (available.length === 0) {
            throw new NotFoundError("No available IP addresses in subnet")
          }

          const ip = available[0]
          const spec = ip.spec
          const updates: IpAddressSpec = { ...spec, status: "assigned" }

          const setValues: Record<string, unknown> = {
            spec: updates,
            updatedAt: new Date(),
          }
          if (assignedToKind) setValues.assignedToKind = assignedToKind
          if (assignedToId) setValues.assignedToId = assignedToId

          const [row] = await db
            .update(ipAddress)
            .set(setValues as any)
            .where(eq(ipAddress.id, ip.id))
            .returning()

          return ok(row)
        },
        {
          detail: {
            tags: ["infra/ip-addresses"],
            summary: "Allocate next available IP from subnet",
          },
        }
      )

      // ── IPAM: Lookup by address ──────────────────────────
      .post(
        "/ip-addresses/lookup",
        async ({ body }) => {
          const { address } = z
            .object({ address: z.string().min(1) })
            .parse(body)
          const [row] = await db
            .select()
            .from(ipAddress)
            .where(eq(ipAddress.address, address))
            .limit(1)
          if (!row) throw new NotFoundError(`IP address '${address}' not found`)
          return ok(row)
        },
        {
          detail: {
            tags: ["infra/ip-addresses"],
            summary: "Lookup IP by address",
          },
        }
      )

      // ── IPAM: Stats ──────────────────────────────────────
      .get(
        "/ip-addresses/stats",
        async ({ query }) => {
          const subnetFilter = query.subnetId
            ? eq(ipAddress.subnetId, query.subnetId as string)
            : undefined

          const [stats] = await db
            .select({
              total: sql<number>`count(*)::int`,
              available: sql<number>`count(*) filter (where (${ipAddress.spec}->>'status') = 'available')::int`,
              assigned: sql<number>`count(*) filter (where (${ipAddress.spec}->>'status') = 'assigned')::int`,
              reserved: sql<number>`count(*) filter (where (${ipAddress.spec}->>'status') = 'reserved')::int`,
            })
            .from(ipAddress)
            .where(subnetFilter)

          return ok(stats)
        },
        {
          detail: {
            tags: ["infra/ip-addresses"],
            summary: "Get IPAM statistics",
          },
        }
      )

      // ── Hosts: Assigned IP entities ───────────────────────
      .get(
        "/hosts/:slugOrId/ip-addresses",
        async ({ params }) => {
          const [targetHost] = await db
            .select({ id: host.id })
            .from(host)
            .where(
              or(eq(host.id, params.slugOrId), eq(host.slug, params.slugOrId))
            )
            .limit(1)
          if (!targetHost) {
            throw new NotFoundError(`Host '${params.slugOrId}' not found`)
          }
          const ips = await getEntityIps(db, "host", targetHost.id)
          return ok(ips)
        },
        {
          detail: {
            tags: ["infra/hosts"],
            summary: "List IP entities assigned to a host",
          },
        }
      )

      // ── DNS: Cloudflare sync ──────────────────────────────
      .post(
        "/dns-sync",
        async ({ body }) => {
          const parsed = z.object({ estateId: z.string().min(1) }).parse(body)
          return ok(await syncDnsFromEstate(db, parsed.estateId))
        },
        {
          detail: {
            tags: ["infra/dns"],
            summary: "Sync Cloudflare zones and records",
          },
        }
      )

      // ── DNS: Reverse lookup — domains pointing to an IP ──
      .get(
        "/dns-domains/by-ip/:address",
        async ({ params }) => {
          // Find the IP entity
          const [ip] = await db
            .select({ id: ipAddress.id })
            .from(ipAddress)
            .where(eq(ipAddress.address, params.address))
            .limit(1)
          if (!ip) {
            throw new NotFoundError(`IP address '${params.address}' not found`)
          }

          // Find network links targeting this IP
          const links = await db
            .select({
              sourceId: networkLink.sourceId,
              spec: networkLink.spec,
            })
            .from(networkLink)
            .where(
              and(
                eq(networkLink.type, "dns-resolution"),
                eq(networkLink.targetKind, "ip-address"),
                eq(networkLink.targetId, ip.id)
              )
            )

          // Fetch the source dns-domain entities
          const domainIds = links.map((l) => l.sourceId).filter(Boolean)
          if (domainIds.length === 0) return ok([])

          const domains = await db
            .select()
            .from(dnsDomain)
            .where(or(...domainIds.map((id) => eq(dnsDomain.id, id!))))

          return ok(domains)
        },
        {
          detail: {
            tags: ["infra/dns"],
            summary: "Find domains that resolve to an IP address",
          },
        }
      )

      // ── DNS: Domains by zone ─────────────────────────────
      .get(
        "/dns-domains/by-zone/:zoneEstateSlugOrId",
        async ({ params }) => {
          // Resolve slug or id to estate id
          const [zoneEstate] = await db
            .select({ id: estate.id })
            .from(estate)
            .where(
              or(
                eq(estate.id, params.zoneEstateSlugOrId),
                eq(estate.slug, params.zoneEstateSlugOrId)
              )
            )
            .limit(1)
          if (!zoneEstate) {
            throw new NotFoundError(
              `Zone estate '${params.zoneEstateSlugOrId}' not found`
            )
          }

          const domains = await db
            .select()
            .from(dnsDomain)
            .where(sql`(${dnsDomain.spec}->>'zoneEstateId') = ${zoneEstate.id}`)

          return ok(domains)
        },
        {
          detail: {
            tags: ["infra/dns"],
            summary: "List domains in a DNS zone",
          },
        }
      )

      // ── DNS: Domains by provider ─────────────────────────
      .get(
        "/dns-domains/by-provider/:provider",
        async ({ params }) => {
          const domains = await db
            .select()
            .from(dnsDomain)
            .where(
              sql`(${dnsDomain.spec}->>'dnsProvider') = ${params.provider}`
            )

          return ok(domains)
        },
        {
          detail: {
            tags: ["infra/dns"],
            summary: "List domains managed by a DNS provider",
          },
        }
      )

      // ── DNS: Domains for a site ──────────────────────────
      .get(
        "/dns-domains/by-site/:siteSlugOrId",
        async ({ params }) => {
          // dnsDomain.siteId is a direct FK — resolve slug first
          const domains = await db
            .select()
            .from(dnsDomain)
            .where(
              or(
                eq(dnsDomain.siteId, params.siteSlugOrId),
                sql`${dnsDomain.siteId} IN (
                  SELECT id FROM ops.site
                  WHERE slug = ${params.siteSlugOrId}
                )`
              )
            )

          return ok(domains)
        },
        {
          detail: {
            tags: ["infra/dns"],
            summary: "List domains assigned to a site",
          },
        }
      )

      // ── DNS: Resolve domain to targets ───────────────────
      .get(
        "/dns-domains/:slugOrId/resolve",
        async ({ params }) => {
          // Find the domain entity
          const [domain] = await db
            .select()
            .from(dnsDomain)
            .where(
              or(
                eq(dnsDomain.id, params.slugOrId),
                eq(dnsDomain.slug, params.slugOrId),
                eq(dnsDomain.fqdn, params.slugOrId)
              )
            )
            .limit(1)
          if (!domain) {
            throw new NotFoundError(`DNS domain '${params.slugOrId}' not found`)
          }

          // Find outbound dns-resolution links
          const links = await db
            .select()
            .from(networkLink)
            .where(
              and(
                eq(networkLink.type, "dns-resolution"),
                eq(networkLink.sourceKind, "dns-domain"),
                eq(networkLink.sourceId, domain.id)
              )
            )

          // Resolve targets
          const targets = await Promise.all(
            links.map(async (link) => {
              if (link.targetKind === "ip-address" && link.targetId) {
                const [ip] = await db
                  .select()
                  .from(ipAddress)
                  .where(eq(ipAddress.id, link.targetId))
                  .limit(1)
                return {
                  type: (link.spec as any)?.recordType ?? "A",
                  target: ip ?? null,
                  targetKind: "ip-address",
                  link,
                }
              }
              if (link.targetKind === "dns-domain" && link.targetId) {
                const [targetDom] = await db
                  .select()
                  .from(dnsDomain)
                  .where(eq(dnsDomain.id, link.targetId))
                  .limit(1)
                return {
                  type: "CNAME",
                  target: targetDom ?? null,
                  targetKind: "dns-domain",
                  externalTarget: (link.spec as any)?.externalTarget,
                  link,
                }
              }
              return {
                type: (link.spec as any)?.recordType ?? "unknown",
                target: null,
                targetKind: link.targetKind,
                link,
              }
            })
          )

          return ok({ domain, targets })
        },
        {
          detail: {
            tags: ["infra/dns"],
            summary: "Resolve a domain to its IP/CNAME targets",
          },
        }
      )

      // ── IPs by entity ────────────────────────────────────
      .get(
        "/ip-addresses/by-entity/:kind/:id",
        async ({ params }) => {
          const ips = await getEntityIps(db, params.kind, params.id)
          return ok(ips)
        },
        {
          detail: {
            tags: ["infra/ip-addresses"],
            summary: "List IPs assigned to an entity",
          },
        }
      )

      // ── Network links by entity ──────────────────────────
      .get(
        "/network-links/by-entity/:kind/:id",
        async ({ params, query }) => {
          const typeFilter = query.type
            ? eq(networkLink.type, query.type as string)
            : undefined
          const dirFilter = query.direction as string | undefined

          let condition
          if (dirFilter === "outbound") {
            condition = and(
              eq(networkLink.sourceKind, params.kind),
              eq(networkLink.sourceId, params.id),
              typeFilter
            )
          } else if (dirFilter === "inbound") {
            condition = and(
              eq(networkLink.targetKind, params.kind),
              eq(networkLink.targetId, params.id),
              typeFilter
            )
          } else {
            condition = and(
              or(
                and(
                  eq(networkLink.sourceKind, params.kind),
                  eq(networkLink.sourceId, params.id)
                ),
                and(
                  eq(networkLink.targetKind, params.kind),
                  eq(networkLink.targetId, params.id)
                )
              ),
              typeFilter
            )
          }

          const links = await db.select().from(networkLink).where(condition)

          return ok(links)
        },
        {
          detail: {
            tags: ["infra/network-links"],
            summary: "List network links for an entity",
          },
        }
      )

      // ── Access: Resolve SSH target ───────────────────────
      .get(
        "/access/resolve/:slug",
        async ({ params }) => {
          const { resolveTarget } =
            await import("../../services/infra/access.service")
          const target = await resolveTarget(db, params.slug)
          if (!target)
            throw new NotFoundError(`SSH target '${params.slug}' not found`)
          return ok(target)
        },
        {
          detail: {
            tags: ["infra/access"],
            summary: "Resolve SSH target by slug",
          },
        }
      )

      // ── Access: List all SSH targets ─────────────────────
      .get(
        "/access/targets",
        async ({ query }) => {
          const { listTargets } =
            await import("../../services/infra/access.service")
          const targets = await listTargets(db)

          const { limit, offset } = parsePagination({
            limit: Number(query.limit) || undefined,
            offset: Number(query.offset) || undefined,
          })
          const total = targets.length
          const page = targets.slice(offset, offset + limit)

          return list(page, paginationMeta(total, { limit, offset }))
        },
        {
          detail: {
            tags: ["infra/access"],
            summary: "List all SSH-connectable targets",
          },
        }
      )

      // ── Assets: Aggregated infrastructure summary ────────
      .get(
        "/assets",
        async () => {
          const [estateCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(estate)
          const [hostCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(host)
          const [realmCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(realm)
          const [routeCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(route)
          const [tunnelCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(tunnel)
          const [ipCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(ipAddress)
          const [secretCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(secret)
          const [linkCount] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(networkLink)

          return ok({
            estates: estateCount.count,
            hosts: hostCount.count,
            realms: realmCount.count,
            routes: routeCount.count,
            tunnels: tunnelCount.count,
            ipAddresses: ipCount.count,
            secrets: secretCount.count,
            networkLinks: linkCount.count,
          })
        },
        {
          detail: {
            tags: ["infra/assets"],
            summary: "Get infrastructure asset summary",
          },
        }
      )

      // ── Tunnel WebSocket broker ──────────────────────────
      .ws(
        "/tunnel-broker",
        (() => {
          const handlers = createTunnelHandlers({ db })
          return {
            open(ws: any) {
              handlers.open(ws.raw as unknown as WebSocket)
            },
            async message(ws: any, data: any) {
              await handlers.message(ws.raw as unknown as WebSocket, data)
            },
            async close(ws: any) {
              await handlers.close(ws.raw as unknown as WebSocket)
            },
          }
        })()
      )

      // ── Inventory ────────────────────────────────────────
      .post(
        "/inventory",
        async ({ body }) => {
          const { InventoryScanBodySchema } =
            await import("@smp/factory-shared/schemas/inventory")
          const parsed = InventoryScanBodySchema.safeParse(body)
          if (!parsed.success)
            throw new ValidationError(
              "Invalid inventory request",
              parsed.error.flatten()
            )
          const { reconcileInventory } =
            await import("../../services/infra/inventory-reconciler")
          const summary = await reconcileInventory(
            db,
            parsed.data.entities as any[],
            parsed.data.dryRun
          )
          return { data: summary, action: "inventory" }
        },
        {
          detail: {
            tags: ["infra/inventory"],
            summary: "Upsert entities from YAML/static declarations",
          },
        }
      )
      .post(
        "/inventory/export",
        async ({ body }) => {
          const kinds = Array.isArray((body as any)?.kinds)
            ? ((body as any).kinds as string[])
            : undefined
          const { exportInventory } =
            await import("../../services/infra/inventory-exporter")
          const exportedKinds = await exportInventory(db, kinds)
          return { data: exportedKinds }
        },
        {
          detail: {
            tags: ["infra/inventory"],
            summary: "Export DB entities as YAML-compatible inventory",
          },
        }
      )
  )
}

import type { OntologyRouteConfig } from "../../lib/crud"

export const infraOntologyConfigs: Pick<
  OntologyRouteConfig<any>,
  | "entity"
  | "singular"
  | "table"
  | "slugColumn"
  | "idColumn"
  | "prefix"
  | "slugRefs"
  | "kindAlias"
  | "createSchema"
>[] = [
  {
    entity: "estates",
    singular: "estate",
    table: estate,
    slugColumn: estate.slug,
    idColumn: estate.id,
    prefix: "est",
    kindAlias: "estate",
    slugRefs: {
      parentEstateSlug: {
        fk: "parentEstateId",
        lookupTable: estate,
        lookupSlugCol: estate.slug,
        lookupIdCol: estate.id,
      },
    },
  },
  {
    entity: "hosts",
    singular: "host",
    table: host,
    slugColumn: host.slug,
    idColumn: host.id,
    prefix: "host",
    kindAlias: "host",
    slugRefs: {
      estateSlug: {
        fk: "estateId",
        lookupTable: estate,
        lookupSlugCol: estate.slug,
        lookupIdCol: estate.id,
      },
    },
  },
  {
    entity: "realms",
    singular: "realm",
    table: realm,
    slugColumn: realm.slug,
    idColumn: realm.id,
    prefix: "rlm",
    kindAlias: "realm",
    slugRefs: {
      estateSlug: {
        fk: "estateId",
        lookupTable: estate,
        lookupSlugCol: estate.slug,
        lookupIdCol: estate.id,
      },
      parentRealmSlug: {
        fk: "parentRealmId",
        lookupTable: realm,
        lookupSlugCol: realm.slug,
        lookupIdCol: realm.id,
      },
    },
  },
  {
    entity: "services",
    singular: "service",
    table: service,
    slugColumn: service.slug,
    idColumn: service.id,
    prefix: "svc",
    kindAlias: "service",
    slugRefs: {
      estateSlug: {
        fk: "estateId",
        lookupTable: estate,
        lookupSlugCol: estate.slug,
        lookupIdCol: estate.id,
      },
      realmSlug: {
        fk: "realmId",
        lookupTable: realm,
        lookupSlugCol: realm.slug,
        lookupIdCol: realm.id,
      },
    },
  },
  {
    entity: "routes",
    singular: "route",
    table: route,
    slugColumn: route.slug,
    idColumn: route.id,
    prefix: "rte",
    kindAlias: "route",
    slugRefs: {
      realmSlug: {
        fk: "realmId",
        lookupTable: realm,
        lookupSlugCol: realm.slug,
        lookupIdCol: realm.id,
      },
    },
  },
  {
    entity: "dns-domains",
    singular: "DNS domain",
    table: dnsDomain,
    slugColumn: dnsDomain.slug,
    idColumn: dnsDomain.id,
    prefix: "dom",
    kindAlias: "dns-domain",
  },
  {
    entity: "secrets",
    singular: "secret",
    table: secret,
    slugColumn: secret.slug,
    idColumn: secret.id,
    prefix: "sec",
    kindAlias: "secret",
  },
  {
    entity: "network-links",
    singular: "network link",
    table: networkLink,
    slugColumn: networkLink.slug,
    idColumn: networkLink.id,
    prefix: "nlnk",
    kindAlias: "network-link",
  },
  {
    entity: "tunnels",
    singular: "tunnel",
    table: tunnel,
    slugColumn: tunnel.subdomain,
    idColumn: tunnel.id,
    prefix: "tnl",
    kindAlias: "tunnel",
  },
  {
    entity: "ip-addresses",
    singular: "IP address",
    table: ipAddress,
    slugColumn: ipAddress.address,
    idColumn: ipAddress.id,
    prefix: "ipa",
    kindAlias: "ip-address",
    slugRefs: {
      subnetSlug: {
        fk: "subnetId",
        lookupTable: estate,
        lookupSlugCol: estate.slug,
        lookupIdCol: estate.id,
      },
    },
  },
]
