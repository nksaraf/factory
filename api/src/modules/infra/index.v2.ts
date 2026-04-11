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
  UpdateTunnelSchema,
} from "@smp/factory-shared/schemas/infra"
import { and, eq, sql } from "drizzle-orm"
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
  tunnel,
} from "../../db/schema/infra-v2"
import { ontologyRoutes } from "../../lib/crud"
import { NotFoundError, ValidationError } from "../../lib/errors"
import {
  countRows,
  paginationMeta,
  parsePagination,
} from "../../lib/pagination"
import { list, ok } from "../../lib/responses"
import { drizzleDbReader, resolveRouteTargets } from "./route-resolver"
import {
  domainMatches,
  drizzleGraphReader,
  traceFrom,
  validateEndpoints,
} from "./trace"
import { createTunnelHandlers } from "./tunnel-broker"

const TraceBodySchema = z.object({
  entityKind: NetworkLinkEndpointKindSchema,
  entityId: z.string().min(1),
  direction: z.enum(["outbound", "inbound"]).default("outbound"),
})

export function infraControllerV2(db: Database) {
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
          createSchema: CreateHostSchema,
          updateSchema: UpdateHostSchema,
          deletable: true,
          hooks: {
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
          createSchema: CreateDnsDomainSchema,
          updateSchema: UpdateDnsDomainSchema,
          deletable: true,
          actions: {
            verify: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as DnsDomainSpec
                const [row] = await db
                  .update(dnsDomain)
                  .set({
                    spec: { ...spec, verified: true, verifiedAt: new Date() },
                    updatedAt: new Date(),
                  })
                  .where(eq(dnsDomain.id, entity.id as string))
                  .returning()
                return row
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
          createSchema: CreateIpAddressSchema,
          updateSchema: UpdateIpAddressSchema,
          deletable: true,
          actions: {
            assign: {
              bodySchema: AssignIpBody,
              handler: async ({ db, entity, body }) => {
                const parsed = body as {
                  assignedToType: string
                  assignedToId: string
                }
                const spec = entity.spec as IpAddressSpec
                const [row] = await db
                  .update(ipAddress)
                  .set({
                    spec: {
                      ...spec,
                      status: "assigned",
                      assignedToType: parsed.assignedToType,
                      assignedToId: parsed.assignedToId,
                    },
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
                    spec: {
                      ...spec,
                      status: "available",
                      assignedToType: undefined,
                      assignedToId: undefined,
                    },
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
          const { subnetId, assignedToType, assignedToId, strategy } =
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
          if (assignedToType) updates.assignedToType = assignedToType
          if (assignedToId) updates.assignedToId = assignedToId

          const [row] = await db
            .update(ipAddress)
            .set({ spec: updates, updatedAt: new Date() })
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
  )
}
