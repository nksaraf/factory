import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { factoryFleet } from "./fleet";
import { fleetSite, deploymentTarget } from "./fleet";
import { cluster } from "./infra";

export const route = factoryFleet.table(
  "route",
  {
    routeId: text("route_id")
      .primaryKey()
      .$defaultFn(() => newId("rte")),
    siteId: text("site_id").references(() => fleetSite.siteId, {
      onDelete: "set null",
    }),
    deploymentTargetId: text("deployment_target_id").references(
      () => deploymentTarget.deploymentTargetId,
      { onDelete: "cascade" }
    ),
    clusterId: text("cluster_id").references(() => cluster.clusterId, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    domain: text("domain").notNull(),
    pathPrefix: text("path_prefix"),
    targetService: text("target_service").notNull(),
    targetPort: integer("target_port"),
    protocol: text("protocol").notNull().default("http"),
    tlsMode: text("tls_mode").notNull().default("auto"),
    tlsCertRef: text("tls_cert_ref"),
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(100),
    middlewares: jsonb("middlewares").notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("route_domain_path_unique").on(t.domain, t.pathPrefix),
    index("route_site_idx").on(t.siteId),
    index("route_deployment_target_idx").on(t.deploymentTargetId),
    index("route_kind_status_idx").on(t.kind, t.status),
    check(
      "route_kind_valid",
      sql`${t.kind} IN ('ingress', 'sandbox', 'preview', 'tunnel', 'custom_domain')`
    ),
    check(
      "route_protocol_valid",
      sql`${t.protocol} IN ('http', 'grpc', 'tcp')`
    ),
    check(
      "route_tls_mode_valid",
      sql`${t.tlsMode} IN ('auto', 'custom', 'none')`
    ),
    check(
      "route_status_valid",
      sql`${t.status} IN ('pending', 'active', 'error', 'expired')`
    ),
  ]
);

export const domain = factoryFleet.table(
  "domain",
  {
    domainId: text("domain_id")
      .primaryKey()
      .$defaultFn(() => newId("dom")),
    siteId: text("site_id").references(() => fleetSite.siteId, {
      onDelete: "set null",
    }),
    fqdn: text("fqdn").notNull(),
    kind: text("kind").notNull(),
    dnsVerified: boolean("dns_verified").notNull().default(false),
    verificationToken: text("verification_token"),
    tlsCertRef: text("tls_cert_ref"),
    status: text("status").notNull().default("pending"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("domain_fqdn_unique").on(t.fqdn),
    index("domain_site_idx").on(t.siteId),
    check(
      "domain_kind_valid",
      sql`${t.kind} IN ('primary', 'alias', 'custom', 'wildcard')`
    ),
    check(
      "domain_status_valid",
      sql`${t.status} IN ('pending', 'verified', 'active', 'error')`
    ),
  ]
);

export const tunnel = factoryFleet.table(
  "tunnel",
  {
    tunnelId: text("tunnel_id")
      .primaryKey()
      .$defaultFn(() => newId("tnl")),
    routeId: text("route_id")
      .notNull()
      .references(() => route.routeId, { onDelete: "cascade" }),
    principalId: text("principal_id").notNull(),
    subdomain: text("subdomain").notNull(),
    localAddr: text("local_addr").notNull(),
    mode: text("mode").notNull().default("http"),
    tcpPort: integer("tcp_port"),
    brokerNodeId: text("broker_node_id"),
    status: text("status").notNull().default("connecting"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tunnel_subdomain_unique").on(t.subdomain),
    index("tunnel_route_idx").on(t.routeId),
    index("tunnel_principal_idx").on(t.principalId),
    check(
      "tunnel_status_valid",
      sql`${t.status} IN ('connecting', 'active', 'disconnected')`
    ),
    check(
      "tunnel_mode_valid",
      sql`${t.mode} IN ('http', 'tcp')`
    ),
  ]
);
