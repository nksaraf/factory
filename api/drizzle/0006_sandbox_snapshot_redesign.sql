-- 0006_sandbox_snapshot_redesign.sql
-- Replaces the old sandbox_snapshot table (from 0003) with the new schema
-- that links to sandbox (not deployment_target) and captures full snapshot metadata.

-- Drop old sandbox_snapshot table (no production data exists)
DROP TABLE IF EXISTS "factory_fleet"."sandbox_snapshot";--> statement-breakpoint

-- Create new sandbox_snapshot table
CREATE TABLE "factory_fleet"."sandbox_snapshot" (
	"sandbox_snapshot_id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"runtime_type" text NOT NULL,
	"volume_snapshot_name" text,
	"image_ref" text,
	"proxmox_snapshot_name" text,
	"vm_id" text,
	"snapshot_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"size_bytes" text,
	"status" text NOT NULL DEFAULT 'creating',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_status_valid" CHECK ("factory_fleet"."sandbox_snapshot"."status" IN ('creating', 'ready', 'failed', 'deleted')),
	CONSTRAINT "snapshot_runtime_valid" CHECK ("factory_fleet"."sandbox_snapshot"."runtime_type" IN ('container', 'vm'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_sandbox_id_sandbox_sandbox_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "factory_fleet"."sandbox"("sandbox_id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "sandbox_snapshot_sandbox_idx" ON "factory_fleet"."sandbox_snapshot" USING btree ("sandbox_id");
