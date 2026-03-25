-- 0005_gateway_tables.sql
-- Gateway management: route, domain, and tunnel tables for unified routing

-- Route table: every routable endpoint in the system
CREATE TABLE "factory_fleet"."route" (
  "route_id" text PRIMARY KEY NOT NULL,
  "site_id" text,
  "deployment_target_id" text,
  "cluster_id" text,
  "kind" text NOT NULL,
  "domain" text NOT NULL,
  "path_prefix" text,
  "target_service" text NOT NULL,
  "target_port" integer,
  "protocol" text NOT NULL DEFAULT 'http',
  "tls_mode" text NOT NULL DEFAULT 'auto',
  "tls_cert_ref" text,
  "status" text NOT NULL DEFAULT 'pending',
  "priority" integer NOT NULL DEFAULT 100,
  "middlewares" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "route_kind_valid" CHECK ("kind" IN ('ingress', 'sandbox', 'preview', 'tunnel', 'custom_domain')),
  CONSTRAINT "route_protocol_valid" CHECK ("protocol" IN ('http', 'grpc', 'tcp')),
  CONSTRAINT "route_tls_mode_valid" CHECK ("tls_mode" IN ('auto', 'custom', 'none')),
  CONSTRAINT "route_status_valid" CHECK ("status" IN ('pending', 'active', 'error', 'expired'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."route"
  ADD CONSTRAINT "route_site_id_site_site_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "factory_fleet"."route"
  ADD CONSTRAINT "route_deployment_target_id_deployment_target_deployment_target_id_fk"
    FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "factory_fleet"."route"
  ADD CONSTRAINT "route_cluster_id_cluster_cluster_id_fk"
    FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "route_domain_path_unique" ON "factory_fleet"."route" ("domain", "path_prefix");--> statement-breakpoint
CREATE INDEX "route_site_idx" ON "factory_fleet"."route" ("site_id");--> statement-breakpoint
CREATE INDEX "route_deployment_target_idx" ON "factory_fleet"."route" ("deployment_target_id");--> statement-breakpoint
CREATE INDEX "route_kind_status_idx" ON "factory_fleet"."route" ("kind", "status");--> statement-breakpoint

-- Domain table: custom domain ownership and DNS verification
CREATE TABLE "factory_fleet"."domain" (
  "domain_id" text PRIMARY KEY NOT NULL,
  "site_id" text,
  "fqdn" text NOT NULL,
  "kind" text NOT NULL,
  "dns_verified" boolean NOT NULL DEFAULT false,
  "verification_token" text,
  "tls_cert_ref" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "domain_kind_valid" CHECK ("kind" IN ('primary', 'alias', 'custom', 'wildcard')),
  CONSTRAINT "domain_status_valid" CHECK ("status" IN ('pending', 'verified', 'active', 'error'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."domain"
  ADD CONSTRAINT "domain_site_id_site_site_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_fqdn_unique" ON "factory_fleet"."domain" ("fqdn");--> statement-breakpoint
CREATE INDEX "domain_site_idx" ON "factory_fleet"."domain" ("site_id");--> statement-breakpoint

-- Tunnel table: active tunnel connections
CREATE TABLE "factory_fleet"."tunnel" (
  "tunnel_id" text PRIMARY KEY NOT NULL,
  "route_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "subdomain" text NOT NULL,
  "local_addr" text NOT NULL,
  "broker_node_id" text,
  "status" text NOT NULL DEFAULT 'connecting',
  "connected_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_heartbeat_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  CONSTRAINT "tunnel_status_valid" CHECK ("status" IN ('connecting', 'active', 'disconnected'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."tunnel"
  ADD CONSTRAINT "tunnel_route_id_route_route_id_fk"
    FOREIGN KEY ("route_id") REFERENCES "factory_fleet"."route"("route_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "tunnel_subdomain_unique" ON "factory_fleet"."tunnel" ("subdomain");--> statement-breakpoint
CREATE INDEX "tunnel_route_idx" ON "factory_fleet"."tunnel" ("route_id");--> statement-breakpoint
CREATE INDEX "tunnel_principal_idx" ON "factory_fleet"."tunnel" ("principal_id");
