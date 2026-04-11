import type {
  DnsDomainSpec,
  EstateSpec,
  HostSpec,
  IpAddressSpec,
  NetworkLinkSpec,
  RealmSpec,
  RouteSpec,
  SecretSpec,
  ServiceSpec,
  TunnelSpec,
} from "@smp/factory-shared/schemas/infra"
import { index, text, uniqueIndex } from "drizzle-orm/pg-core"

import { newId } from "../../lib/id"
import {
  createdAt,
  infraSchema,
  metadataCol,
  reconciliationCols,
  specCol,
  updatedAt,
} from "./helpers"
import { principal } from "./org"

// ─── Estate ──────────────────────────────────────────────
// Ownership hierarchy: cloud accounts, regions, datacenters, VPCs, subnets, racks.

export const estate = infraSchema.table(
  "estate",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("est")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    parentEstateId: text("parent_estate_id").references((): any => estate.id, {
      onDelete: "set null",
    }),
    spec: specCol<EstateSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_estate_slug_unique").on(t.slug),
    index("infra_estate_type_idx").on(t.type),
    index("infra_estate_parent_idx").on(t.parentEstateId),
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
    estateId: text("estate_id").references(() => estate.id, {
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
    index("infra_host_estate_idx").on(t.estateId),
  ]
)

// ─── Realm ────────────────────────────────────────────────
// Active governance — bounded domain of authority where things spawn and are controlled.
// Uses realm_host join table for many-to-many (K8s cluster spans multiple hosts).

export const realm = infraSchema.table(
  "realm",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rlm")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    parentRealmId: text("parent_realm_id").references((): any => realm.id, {
      onDelete: "set null",
    }),
    estateId: text("estate_id").references(() => estate.id, {
      onDelete: "set null",
    }),
    // workbenchId FK added in ops.ts to avoid circular cross-schema import
    workbenchId: text("workbench_id"),
    spec: specCol<RealmSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_realm_slug_unique").on(t.slug),
    index("infra_realm_type_idx").on(t.type),
    index("infra_realm_parent_idx").on(t.parentRealmId),
    index("infra_realm_estate_idx").on(t.estateId),
    index("infra_realm_workbench_idx").on(t.workbenchId),
  ]
)

// ─── Realm-Host join table ────────────────────────────────
// Many-to-many: K8s cluster can span multiple hosts.

export const realmHost = infraSchema.table(
  "realm_host",
  {
    realmId: text("realm_id")
      .notNull()
      .references(() => realm.id, { onDelete: "cascade" }),
    hostId: text("host_id")
      .notNull()
      .references(() => host.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("single"), // single, control-plane, worker
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("infra_realm_host_unique").on(t.realmId, t.hostId),
    index("infra_realm_host_realm_idx").on(t.realmId),
    index("infra_realm_host_host_idx").on(t.hostId),
  ]
)

// ─── Service ──────────────────────────────────────────────
// Anything consumed via protocol/API: managed infra, SaaS, AI/ML, internal services.

export const service = infraSchema.table(
  "service",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("svc")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    estateId: text("estate_id").references(() => estate.id, {
      onDelete: "set null",
    }),
    realmId: text("realm_id").references(() => realm.id, {
      onDelete: "set null",
    }),
    // systemDeploymentId FK added in ops.ts to avoid circular cross-schema import
    systemDeploymentId: text("system_deployment_id"),
    spec: specCol<ServiceSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...reconciliationCols(),
  },
  (t) => [
    uniqueIndex("infra_service_slug_unique").on(t.slug),
    index("infra_service_type_idx").on(t.type),
    index("infra_service_estate_idx").on(t.estateId),
    index("infra_service_realm_idx").on(t.realmId),
    index("infra_service_sd_idx").on(t.systemDeploymentId),
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
    realmId: text("realm_id").references(() => realm.id, {
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
    index("infra_route_realm_idx").on(t.realmId),
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
    subnetId: text("subnet_id").references(() => estate.id, {
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
    viaKind: text("via_kind"),
    viaId: text("via_id"),
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
  ]
)
