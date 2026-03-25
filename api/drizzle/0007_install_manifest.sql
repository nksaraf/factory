-- 0007_install_manifest.sql
-- Install manifest tracking: Factory tracks install state of all Sites

CREATE TABLE "factory_fleet"."install_manifest" (
  "install_manifest_id" text PRIMARY KEY NOT NULL,
  "site_id" text NOT NULL,
  "manifest_version" integer NOT NULL DEFAULT 1,
  "role" text NOT NULL DEFAULT 'site',
  "dx_version" text NOT NULL,
  "install_mode" text NOT NULL DEFAULT 'connected',
  "k3s_version" text NOT NULL,
  "helm_chart_version" text NOT NULL,
  "site_name" text NOT NULL,
  "domain" text NOT NULL,
  "enabled_planes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "nodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "upgrades" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "raw_manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reported_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "install_manifest_role_valid" CHECK ("role" IN ('site', 'factory')),
  CONSTRAINT "install_manifest_mode_valid" CHECK ("install_mode" IN ('connected', 'offline'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."install_manifest"
  ADD CONSTRAINT "install_manifest_site_id_site_site_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "install_manifest_site_id_unique" ON "factory_fleet"."install_manifest" ("site_id");--> statement-breakpoint
CREATE INDEX "install_manifest_role_idx" ON "factory_fleet"."install_manifest" ("role");--> statement-breakpoint

-- Release bundle tracking: records of offline bundles produced by the Factory
CREATE TABLE "factory_fleet"."release_bundle" (
  "release_bundle_id" text PRIMARY KEY NOT NULL,
  "release_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'site',
  "arch" text NOT NULL DEFAULT 'amd64',
  "dx_version" text NOT NULL,
  "k3s_version" text NOT NULL,
  "helm_chart_version" text NOT NULL,
  "image_count" integer NOT NULL DEFAULT 0,
  "size_bytes" bigint,
  "checksum_sha256" text,
  "storage_path" text,
  "status" text NOT NULL DEFAULT 'building',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  CONSTRAINT "release_bundle_role_valid" CHECK ("role" IN ('site', 'factory')),
  CONSTRAINT "release_bundle_arch_valid" CHECK ("arch" IN ('amd64', 'arm64')),
  CONSTRAINT "release_bundle_status_valid" CHECK ("status" IN ('building', 'ready', 'failed', 'expired'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."release_bundle"
  ADD CONSTRAINT "release_bundle_release_id_release_release_id_fk"
    FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "release_bundle_release_idx" ON "factory_fleet"."release_bundle" ("release_id");--> statement-breakpoint
CREATE INDEX "release_bundle_status_idx" ON "factory_fleet"."release_bundle" ("status");
