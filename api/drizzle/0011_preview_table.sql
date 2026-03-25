-- 0011_preview_table.sql
-- Add preview deployment target kind and preview table

ALTER TABLE "factory_fleet"."deployment_target"
  DROP CONSTRAINT IF EXISTS "deployment_target_kind_valid";--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target"
  ADD CONSTRAINT "deployment_target_kind_valid"
    CHECK ("kind" IN ('production', 'staging', 'sandbox', 'dev', 'preview'));--> statement-breakpoint

CREATE TABLE "factory_fleet"."preview" (
  "preview_id" text PRIMARY KEY NOT NULL,
  "deployment_target_id" text NOT NULL,
  "site_id" text,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "source_branch" text NOT NULL,
  "commit_sha" text NOT NULL,
  "repo" text NOT NULL,
  "pr_number" integer,
  "owner_id" text NOT NULL,
  "auth_mode" text NOT NULL DEFAULT 'team',
  "runtime_class" text NOT NULL DEFAULT 'hot',
  "status" text NOT NULL DEFAULT 'building',
  "status_message" text,
  "last_accessed_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "preview_auth_mode_valid" CHECK ("auth_mode" IN ('public', 'team', 'private')),
  CONSTRAINT "preview_runtime_class_valid" CHECK ("runtime_class" IN ('hot', 'warm', 'cold')),
  CONSTRAINT "preview_status_valid" CHECK ("status" IN ('building', 'deploying', 'active', 'inactive', 'expired', 'failed'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."preview"
  ADD CONSTRAINT "preview_deployment_target_id_deployment_target_deployment_target_id_fk"
    FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "factory_fleet"."preview"
  ADD CONSTRAINT "preview_site_id_site_site_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "preview_slug_unique" ON "factory_fleet"."preview" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_deployment_target_unique" ON "factory_fleet"."preview" ("deployment_target_id");--> statement-breakpoint
CREATE INDEX "preview_site_idx" ON "factory_fleet"."preview" ("site_id");--> statement-breakpoint
CREATE INDEX "preview_status_idx" ON "factory_fleet"."preview" ("status");--> statement-breakpoint
CREATE INDEX "preview_branch_idx" ON "factory_fleet"."preview" ("source_branch");
