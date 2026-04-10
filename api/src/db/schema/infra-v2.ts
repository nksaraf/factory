import type {
  DnsDomainSpec,
  HostSpec,
  IpAddressSpec,
  NetworkLinkSpec,
  RouteSpec,
  RuntimeSpec,
  SecretSpec,
  SubstrateSpec,
  TunnelSpec,
} from "@smp/factory-shared/schemas/infra"
import { sql } from "drizzle-orm"
import { check, index, text, uniqueIndex } from "drizzle-orm/pg-core"

import { newId } from "../../lib/id"
import {
  createdAt,
  infraSchema,
  metadataCol,
  reconciliationCols,
  specCol,
  updatedAt,
} from "./helpers"
import { principal } from "./org-v2"

// ─── Substrate ──────────────────────────────────────────────
// Represents physical/logical infrastructure layers:
// cloud accounts, regions, datacenters, VPCs, subnets, hypervisors, racks.

export const substrate = infraSchema.table(
  "substrate",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("subs")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    // Self-referential FK — Drizzle requires callback return type to be loosened
    // because the table variable isn't fully defined yet at reference time.
    parentSubstrateId: text("parent_substrate_id").references(
      (): any => substrate.id,
      { onDelete: "set null" }
    ),
    spec: specCol<SubstrateSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_substrate_slug_unique").on(t.slug),
    index("infra_substrate_type_idx").on(t.type),
    index("infra_substrate_parent_idx").on(t.parentSubstrateId),
    check(
      "infra_substrate_type_valid",
      sql`${t.type} IN ('cloud-account', 'region', 'datacenter', 'vpc', 'subnet', 'hypervisor', 'rack')`
    ),
  ]
)

// ─── Host ───────────────────────────────────────────────────
// Physical or virtual machines that run workloads.

export const host = infraSchema.table(
  "host",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("host")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    substrateId: text("substrate_id").references(() => substrate.id, {
      onDelete: "set null",
    }),
    spec: specCol<HostSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_host_slug_unique").on(t.slug),
    index("infra_host_type_idx").on(t.type),
    index("infra_host_substrate_idx").on(t.substrateId),
    check(
      "infra_host_type_valid",
      sql`${t.type} IN ('bare-metal', 'vm', 'lxc', 'cloud-instance')`
    ),
  ]
)

// ─── Runtime ────────────────────────────────────────────────
// Execution environments where components actually run.

export const runtime = infraSchema.table(
  "runtime",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rt")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    // Self-referential FK — see substrate comment above.
    parentRuntimeId: text("parent_runtime_id").references(
      (): any => runtime.id,
      { onDelete: "set null" }
    ),
    hostId: text("host_id").references(() => host.id, {
      onDelete: "set null",
    }),
    spec: specCol<RuntimeSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_runtime_slug_unique").on(t.slug),
    index("infra_runtime_type_idx").on(t.type),
    index("infra_runtime_parent_idx").on(t.parentRuntimeId),
    index("infra_runtime_host_idx").on(t.hostId),
    check(
      "infra_runtime_type_valid",
      sql`${t.type} IN ('k8s-cluster', 'k8s-namespace', 'docker-engine', 'compose-project', 'systemd', 'reverse-proxy', 'iis', 'windows-service', 'process')`
    ),
  ]
)

// ─── Route ──────────────────────────────────────────────────
// Network routes that expose services to traffic.

export const route = infraSchema.table(
  "route",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rte")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    domain: text("domain").notNull(),
    runtimeId: text("runtime_id").references(() => runtime.id, {
      onDelete: "set null",
    }),
    spec: specCol<RouteSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_route_slug_unique").on(t.slug),
    index("infra_route_type_idx").on(t.type),
    index("infra_route_domain_idx").on(t.domain),
    index("infra_route_runtime_idx").on(t.runtimeId),
    check(
      "infra_route_type_valid",
      sql`${t.type} IN ('ingress', 'workspace', 'preview', 'tunnel', 'custom-domain')`
    ),
  ]
)

// ─── DNS Domain ─────────────────────────────────────────────
// DNS domain records associated with sites.

export const dnsDomain = infraSchema.table(
  "dns_domain",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("dom")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    fqdn: text("fqdn").notNull(),
    /** FK → ops.site (cross-schema) */
    siteId: text("site_id"),
    spec: specCol<DnsDomainSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("infra_dns_domain_fqdn_unique").on(t.fqdn),
    uniqueIndex("infra_dns_domain_slug_unique").on(t.slug),
    index("infra_dns_domain_type_idx").on(t.type),
    index("infra_dns_domain_site_idx").on(t.siteId),
    check(
      "infra_dns_domain_type_valid",
      sql`${t.type} IN ('primary', 'alias', 'custom', 'wildcard')`
    ),
  ]
)

// ─── Tunnel ─────────────────────────────────────────────────
// Developer tunnels that bridge local services to routes.

export const tunnel = infraSchema.table(
  "tunnel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tnl")),
    type: text("type").notNull(),
    routeId: text("route_id")
      .notNull()
      .references(() => route.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id),
    subdomain: text("subdomain").notNull(),
    phase: text("phase").notNull().default("connecting"),
    spec: specCol<TunnelSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_tunnel_subdomain_unique").on(t.subdomain),
    index("infra_tunnel_type_idx").on(t.type),
    index("infra_tunnel_route_idx").on(t.routeId),
    index("infra_tunnel_principal_idx").on(t.principalId),
    index("infra_tunnel_phase_idx").on(t.phase),
    check("infra_tunnel_type_valid", sql`${t.type} IN ('http', 'tcp')`),
    check(
      "infra_tunnel_phase_valid",
      sql`${t.phase} IN ('connecting', 'connected', 'disconnected', 'error')`
    ),
  ]
)

// ─── IP Address ─────────────────────────────────────────────
// Tracked IP addresses within subnets.

export const ipAddress = infraSchema.table(
  "ip_address",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("ipa")),
    address: text("address").notNull(),
    subnetId: text("subnet_id").references(() => substrate.id, {
      onDelete: "set null",
    }),
    spec: specCol<IpAddressSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("infra_ip_address_unique").on(t.address),
    index("infra_ip_address_subnet_idx").on(t.subnetId),
  ]
)

// ─── Secret ─────────────────────────────────────────────────
// Managed secrets referenced by infrastructure resources.

export const secret = infraSchema.table(
  "secret",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("sec")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    spec: specCol<SecretSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("infra_secret_slug_unique").on(t.slug)]
)

// ─── Network Link ────────────────────────────────────────
// Directed edges in the infrastructure graph modeling traffic flow.

export const networkLink = infraSchema.table(
  "network_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("nlnk")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    spec: specCol<NetworkLinkSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_network_link_slug_unique").on(t.slug),
    index("infra_network_link_type_idx").on(t.type),
    index("infra_network_link_source_idx").on(t.sourceKind, t.sourceId),
    index("infra_network_link_target_idx").on(t.targetKind, t.targetId),
    index("infra_network_link_edge_idx").on(t.sourceId, t.targetId),
    check(
      "infra_network_link_type_valid",
      sql`${t.type} IN ('proxy', 'direct', 'tunnel', 'nat', 'firewall', 'mesh', 'peering')`
    ),
    check(
      "infra_network_link_endpoint_kind_valid",
      sql`${t.sourceKind} IN ('substrate', 'host', 'runtime') AND ${t.targetKind} IN ('substrate', 'host', 'runtime')`
    ),
  ]
)
